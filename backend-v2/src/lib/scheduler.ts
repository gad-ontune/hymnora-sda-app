/**
 * A very small interval scheduler.
 *
 * The worker needs to run four things on four different cadences and needs to
 * survive a restart without double-firing. That is the entire requirement, and
 * it does not justify a cron dependency, a queue, or a Redis.
 *
 * Two properties matter more than they look:
 *
 *  1. A job that overruns its interval does not stack. `setInterval` would run
 *     the YouTube poll a second time while the first is still awaiting YouTube,
 *     and the unique indexes would absorb the duplicates but the quota would
 *     not. `running` is checked before the timer is allowed to fire again.
 *  2. A job that throws is logged and rescheduled, not fatal. The whole point
 *     of a background worker is that it keeps going.
 *
 * The last-run timestamps are in memory on purpose. Persisting them would mean
 * deciding what to do about a process that dies mid-job; re-running a job after
 * a restart is always safe here because every job is idempotent.
 */

export type Job = {
  name: string;
  intervalMs: number;
  /** Runs once on start rather than waiting a full interval. */
  runOnStart?: boolean;
  handler: () => Promise<unknown> | unknown;
};

export type JobState = {
  name: string;
  intervalMs: number;
  lastRunAt: string | null;
  lastDurationMs: number | null;
  runs: number;
  failures: number;
  lastError: string | null;
  running: boolean;
};

type Entry = { job: Job; state: JobState; timer: NodeJS.Timeout | null };

export class Scheduler {
  private readonly entries = new Map<string, Entry>();
  private stopped = false;

  add(job: Job): this {
    if (this.entries.has(job.name)) throw new Error(`A job named "${job.name}" is already registered`);
    this.entries.set(job.name, {
      job,
      state: {
        name: job.name,
        intervalMs: job.intervalMs,
        lastRunAt: null,
        lastDurationMs: null,
        runs: 0,
        failures: 0,
        lastError: null,
        running: false,
      },
      timer: null,
    });
    return this;
  }

  start(): this {
    this.stopped = false;
    for (const entry of this.entries.values()) this.schedule(entry);
    return this;
  }

  stop(): void {
    this.stopped = true;
    for (const entry of this.entries.values()) {
      if (entry.timer) clearInterval(entry.timer);
      entry.timer = null;
    }
  }

  /** Runs one job now, outside its schedule. Used by the admin "run now" route. */
  async runNow(name: string): Promise<{ ran: boolean; result?: unknown; error?: string }> {
    const entry = this.entries.get(name);
    if (!entry) return { ran: false, error: `No job named "${name}"` };
    if (entry.state.running) return { ran: false, error: `"${name}" is already running` };
    try {
      const result = await entry.job.handler();
      return { ran: true, result };
    } catch (error) {
      recordFailure(entry.state, error);
      return { ran: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  status(): JobState[] {
    return [...this.entries.values()].map((entry) => ({ ...entry.state }));
  }

  private schedule(entry: Entry): void {
    if (this.stopped) return;
    const { job, state } = entry;
    const fire = () => {
      if (state.running) return; // Still busy — skip this tick rather than stack.
      state.running = true;
      const startedAt = Date.now();
      void Promise.resolve()
        .then(() => job.handler())
        .then(() => {
          state.runs += 1;
          state.lastRunAt = new Date().toISOString();
          state.lastDurationMs = Date.now() - startedAt;
          state.lastError = null;
        })
        .catch((error) => {
          state.runs += 1;
          state.lastRunAt = new Date().toISOString();
          state.lastDurationMs = Date.now() - startedAt;
          recordFailure(state, error);
        })
        .finally(() => {
          state.running = false;
        });
    };

    if (job.runOnStart) setTimeout(fire, 0);
    entry.timer = setInterval(fire, job.intervalMs);
    // Deliberately ref'd. An unref'd timer does not hold the event loop open, so
    // a worker whose only timers are unref'd runs its first pass and then exits
    // 0 — a background worker that never polls again. Shutdown is handled by
    // SIGINT/SIGTERM calling `stop()`, which clears this interval, so holding
    // the loop open here does not trap the process.
  }
}

function recordFailure(state: JobState, error: unknown): void {
  state.failures += 1;
  state.lastError = error instanceof Error ? error.message : String(error);
  // eslint-disable-next-line no-console
  console.error(`[worker] job "${state.name}" failed: ${state.lastError}`);
}
