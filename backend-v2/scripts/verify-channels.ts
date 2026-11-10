#!/usr/bin/env node --experimental-strip-types
/**
 * Checks the whitelist against the live YouTube Data API.
 *
 *     npm run channels:verify
 *
 * A channel id that does not exist is the quietest failure in the ingest
 * pipeline: the poller spends a unit, gets an empty list, marks the channel
 * polled, and moves on. Nothing errors. The music page is just emptier than it
 * should be, permanently. This script is how that gets caught — before the
 * worker is switched on, not after.
 *
 * `channels.list` with ids in batches of 50 costs 1 unit per call, so the whole
 * 42-channel whitelist is verified for 1 unit.
 */

import { CHANNEL_WHITELIST, type WhitelistSeed } from "../src/modules/youtube/whitelist.ts";
import { summariseByFocus, validateWhitelistShape } from "../src/modules/youtube/whitelist-check.ts";
import { env } from "../src/config/env.ts";
import { CHANNELS_LIST_UNIT_COST, recordQuotaUse } from "../src/modules/youtube/client.ts";

const API_BASE = "https://www.googleapis.com/youtube/v3";

type ChannelItem = {
  id: string;
  snippet?: {
    title?: string;
    country?: string;
    defaultLanguage?: string;
    publishedAt?: string;
    customUrl?: string;
    description?: string;
  };
  /** Only present when `contentDetails` was requested. */
  contentDetails?: { relatedPlaylists?: { uploads?: string } };
};

type ChannelResponse = {
  items?: ChannelItem[];
};

type Row = {
  entry: WhitelistSeed;
  status: "ok" | "missing" | "renamed" | "error";
  detail: string;
};

/** Fetches up to 50 channels per call, as the API allows. */
async function fetchChannels(ids: string[]): Promise<Map<string, ChannelItem>> {
  const found = new Map<string, ChannelItem>();
  for (let start = 0; start < ids.length; start += 50) {
    const batch = ids.slice(start, start + 50);
    const url = new URL(`${API_BASE}/channels`);
    url.searchParams.set("part", "snippet,contentDetails,statistics");
    url.searchParams.set("id", batch.join(","));
    url.searchParams.set("key", env.youtubeApiKey!);

    const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    const body = (await response.json().catch(() => ({}))) as ChannelResponse & {
      error?: { message?: string };
    };
    // Recorded whatever the outcome: a rejected call still counts against the
    // day's quota, and an audit that omits failures looks like a smaller bill
    // than the real one.
    recordQuotaUse("channels.list", CHANNELS_LIST_UNIT_COST, body.items?.length ?? 0);
    if (!response.ok) {
      throw new Error(`YouTube returned ${response.status}: ${body.error?.message ?? "unknown error"}`);
    }
    for (const item of body.items ?? []) found.set(item.id, item);
  }
  return found;
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

async function main(): Promise<number> {
  if (!env.youtubeApiKey) {
    process.stderr.write("YOUTUBE_API_KEY is not set. Add it to backend-v2/.env first.\n");
    return 1;
  }

  const shapeProblems = validateWhitelistShape(CHANNEL_WHITELIST);
  if (shapeProblems.length) {
    process.stderr.write("The whitelist is malformed, so there is nothing to verify:\n");
    for (const problem of shapeProblems) {
      process.stderr.write(`  ${problem.title} (${problem.channelId}): ${problem.problem}\n`);
    }
    return 1;
  }

  const live = await fetchChannels(CHANNEL_WHITELIST.map((channel) => channel.channelId));
  const rows: Row[] = CHANNEL_WHITELIST.map((entry) => {
    const found = live.get(entry.channelId);
    if (!found) {
      return { entry, status: "missing", detail: "no such channel — id is wrong or the channel is gone" };
    }
    const liveTitle = (found.snippet?.title ?? "(untitled)").trim();
    // A mismatch here is the useful finding: the id is real but belongs to
    // something else, which means it was copied from the wrong place. Compare
    // on collapsed whitespace and case only — several real channels have a
    // trailing space or an odd capitalisation in their own display name, and
    // neither should read as "this id belongs to something else".
    const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
    if (norm(liveTitle) !== norm(entry.title)) {
      return { entry, status: "renamed", detail: `channel is actually called "${liveTitle}"` };
    }
    const uploads = found.contentDetails?.relatedPlaylists?.uploads;
    return { entry, status: "ok", detail: uploads ? `uploads ${uploads}` : "no uploads playlist (verify by hand)" };
  });

  const mark = { ok: "OK  ", missing: "MISS", renamed: "DIFF", error: "ERR " } as const;
  process.stdout.write("\nWhitelist verification against the live API\n\n");
  for (const row of rows) {
    process.stdout.write(
      `  ${mark[row.status]} ${pad(row.entry.title, 42)} ${pad(row.entry.region, 15)} ${row.detail}\n`,
    );
  }

  const byStatus = rows.reduce<Record<string, number>>((counts, row) => {
    counts[row.status] = (counts[row.status] ?? 0) + 1;
    return counts;
  }, {});
  const focus = summariseByFocus(CHANNEL_WHITELIST);
  process.stdout.write(
    `\n  ${rows.length} channels — ${byStatus.ok ?? 0} verified, ${byStatus.missing ?? 0} missing, ${byStatus.renamed ?? 0} mismatched` +
      `\n  focus: ${focus.music} music, ${focus.preaching} preaching, ${focus.mixed} mixed\n\n`,
  );

  if (byStatus.missing || byStatus.renamed) {
    process.stdout.write(
      "Fix these before enabling the poller. To resolve a handle to an id:\n" +
        "    npm run channels:resolve -- @thehandle\n\n",
    );
    return 1;
  }
  process.stdout.write("Every id resolves and matches its title. Safe to run `npm run worker`.\n\n");
  return 0;
}

process.exitCode = await main();
