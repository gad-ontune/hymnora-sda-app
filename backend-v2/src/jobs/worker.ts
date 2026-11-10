/**
 * The background worker.
 *
 * Run separately from the API (`npm run worker`) so that a slow ingest poll can
 * never make a reader's request wait, and so the two can be scaled differently
 * on a small box. It holds the same SQLite file, which is fine because every
 * write here is a short transaction and WAL gives the two processes concurrent
 * readers.
 *
 * Five jobs:
 *   - youtube.poll   the whitelist ingest, the expensive one
 *   - verse.daily    the morning/evening verse, in each reader's own timezone
 *   - streak.nudge   only for readers with a streak worth protecting
 *   - live.alerts    re-checked often, because "starting soon" is a moving target
 *   - push.housekeeping  retire dead devices, trim the delivery log
 */

import { env, pushConfigured, youtubeConfigured } from "../config/env.ts";
import { Scheduler, type JobState } from "../lib/scheduler.ts";
import { runIngest, reclassifyPending } from "../modules/youtube/ingest.ts";
import { recentVerdicts, type IngestSummary } from "../modules/youtube/ingest.ts";
import { remainingQuota, unitsSpentToday } from "../modules/youtube/client.ts";
import { CHANNEL_WHITELIST } from "../modules/youtube/whitelist.ts";
import { validateWhitelistShape } from "../modules/youtube/whitelist-check.ts";
import { fireLiveAlerts, sendDailyVerse, sendStreakNudge } from "../modules/push/reminders.ts";
import { pruneDeliveries } from "../modules/push/service.ts";
import { runMigrations } from "../db/migrate.ts";
import { count } from "../db/client.ts";

export const worker = new Scheduler();

let lastIngest: IngestSummary | null = null;

function log(message: string, extra?: unknown): void {
  const stamp = new Date().toISOString();
  // eslint-disable-next-line no-console
  console.log(`[worker ${stamp}] ${message}`, extra ?? "");
}

/**
 * Whitelist problems are fatal at boot on purpose.
 *
 * A malformed channel id is the kind of mistake that otherwise shows up three
 * days later as "the music page is empty" with nothing in the logs. Failing
 * here, with the id printed, is the difference between a five-second fix and an
 * afternoon.
 */
export function assertWhitelistIsSane(): void {
  const problems = validateWhitelistShape(CHANNEL_WHITELIST);
  if (problems.length === 0) return;
  log(`✗ The channel whitelist has ${problems.length} problem(s):`);
  for (const problem of problems) {
    log(`  - ${problem.title} (${problem.channelId}): ${problem.problem}`);
  }
  throw new Error("Refusing to start the worker with an invalid channel whitelist");
}

export function registerJobs(scheduler: Scheduler = worker): Scheduler {
  // ── YouTube ingest ──────────────────────────────────────────────────────
  scheduler.add({
    name: "youtube.poll",
    // Run on start as well as on the interval, so a worker that boots after a
    // deploy picks up new uploads immediately instead of waiting out the first
    // interval.
    runOnStart: true,
    intervalMs: env.youtubePollIntervalMs,
    handler: async () => {
      if (!youtubeConfigured()) {
        log("youtube.poll: skipped — YOUTUBE_API_KEY is not set");
        return null;
      }
      const before = remainingQuota();
      const summary = await runIngest();
      lastIngest = summary;
      const line =
        `polled ${summary.channelsPolled}/${summary.channelsPolled + summary.channelsSkipped} channels, ` +
        `${summary.videosSeen} uploads seen, ${summary.classified.music} music / ` +
        `${summary.classified.sermon} sermon / ${summary.classified.skipped} skipped, ` +
        `+${summary.routed.tracks} tracks, +${summary.routed.sermons} sermons, ` +
        `${summary.quotaUnitsSpent} units (${before} left today)`;
      if (summary.errors.length > 0) log(`youtube.poll: ${line}`, summary.errors);
      else log(`youtube.poll: ${line}`);
      return summary;
    },
  });

  scheduler.add({
    name: "youtube.reclassify",
    // Deliberately rare. Re-running the classifier is for after a keyword list
    // has been edited, and a daily pass over everything already judged is
    // enough to catch what changed.
    intervalMs: 24 * 60 * 60 * 1000,
    handler: () => {
      if (!youtubeConfigured()) return null;
      const result = reclassifyPending();
      if (result.changed > 0) log(`youtube.reclassify: ${result.changed} of ${result.examined} verdicts changed`);
      return result;
    },
  });

  // ── Reminders ───────────────────────────────────────────────────────────
  // A one-minute tick with a ten-minute window per job. The overlap is what
  // makes a job eventually fire for every timezone on the roster.
  scheduler.add({
    name: "verse.daily",
    intervalMs: 60_000,
    handler: async () => {
      if (!pushConfigured()) return null;
      const sweep = await sendDailyVerse();
      if (sweep.result.sent > 0) {
        log(`verse.daily: sent ${sweep.result.sent} of ${sweep.considered} due`);
      }
      return sweep;
    },
  });

  scheduler.add({
    name: "streak.nudge",
    intervalMs: 60_000,
    handler: async () => {
      if (!pushConfigured()) return null;
      const sweep = await sendStreakNudge();
      if (sweep.result.sent > 0) {
        log(`streak.nudge: sent ${sweep.result.sent} of ${sweep.considered} due`);
      }
      return sweep;
    },
  });

  scheduler.add({
    name: "live.alerts",
    intervalMs: 60_000,
    handler: async () => {
      if (!pushConfigured()) return null;
      const sweeps = await fireLiveAlerts();
      const sent = sweeps.reduce((total, sweep) => total + sweep.result.sent, 0);
      if (sent > 0) log(`live.alerts: sent ${sent}`);
      return sweeps;
    },
  });

  scheduler.add({
    name: "push.housekeeping",
    intervalMs: 6 * 60 * 60 * 1000,
    handler: () => {
      const pruned = pruneDeliveries(30);
      if (pruned > 0) log(`push.housekeeping: pruned ${pruned} delivery rows`);
      return { pruned };
    },
  });

  return scheduler;
}

/** A one-line health summary for the worker's own status endpoint. */
export function workerStatus(): {
  jobs: JobState[];
  push: { configured: boolean; subscriptions: number };
  youtube: { configured: boolean; channels: number; quotaUsed: number; quotaRemaining: number; lastIngest: IngestSummary | null; recentVerdicts: number };
} {
  return {
    jobs: worker.status(),
    push: {
      configured: pushConfigured(),
      subscriptions: count("SELECT COUNT(*) AS total FROM push_subscriptions"),
    },
    youtube: {
      configured: youtubeConfigured(),
      channels: count("SELECT COUNT(*) AS total FROM youtube_channels WHERE is_active = 1"),
      quotaUsed: unitsSpentToday(),
      quotaRemaining: remainingQuota(),
      lastIngest,
      recentVerdicts: count("SELECT COUNT(*) AS total FROM youtube_videos"),
    },
  };
}

async function main(): Promise<void> {
  assertWhitelistIsSane();
  runMigrations();

  log("started");
  log(`  push      ${pushConfigured() ? "configured" : "NOT configured (reminders will not be delivered)"}`);
  log(`  youtube   ${youtubeConfigured() ? `${CHANNEL_WHITELIST.length} channels whitelisted` : "NOT configured (ingest disabled)"}`);
  log(`  quota     ${remainingQuota()} units left today of ${env.youtubeDailyQuota}`);

  // `worker:once` is the smoke test for a deploy: run every job exactly one
  // time, report what each one did, and exit non-zero if any of them failed.
  // Without this the scheduler's timers are unref'd, so the process would start,
  // run nothing at all, and exit 0 — reporting success for work it never did.
  if (process.argv.includes("--once")) {
    const failed = await runAllJobsOnce();
    process.exit(failed > 0 ? 1 : 0);
  }

  registerJobs().start();

  const shutdown = (signal: string) => {
    log(`${signal} received, stopping`);
    worker.stop();
    setTimeout(() => process.exit(0), 200).unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

/** Runs every registered job one at a time and returns how many failed. */
export async function runAllJobsOnce(): Promise<number> {
  const scheduler = registerJobs();
  let failed = 0;
  for (const job of scheduler.status()) {
    const outcome = await scheduler.runNow(job.name);
    if (outcome.ran) {
      log(`  ok    ${job.name}`);
    } else {
      failed += 1;
      log(`  FAIL  ${job.name}: ${outcome.error ?? "unknown error"}`);
    }
  }
  log(failed > 0 ? `finished with ${failed} failed job(s)` : "all jobs completed");
  return failed;
}

// Only self-start when executed directly, so tests can import `registerJobs`.
if (process.argv[1]?.endsWith("worker.ts") || process.argv[1]?.endsWith("worker.js")) {
  await main();
}

export { recentVerdicts, lastIngest };
