/**
 * The three device-level reminders.
 *
 * There is no in-app inbox behind these. Each job is a sweep over users whose
 * preference for that purpose is on, at the hour they picked, resolved in their
 * own timezone, and each send is protected by a unique key on
 * `push_deliveries` so a sweep that runs twice is a no-op the second time.
 *
 * The timezone handling is the part worth reading. A user in Nairobi and a user
 * in London both set "07:00", and 07:00 has to mean their own 07:00. Times are
 * stored as `HH:MM` local, and `Intl.DateTimeFormat` is used to ask what the
 * current local time is in the row's zone — no `date` library, and no UTC
 * offset table to go stale.
 */

import { all, get, run } from "../../db/client.ts";
import { spotlightVerses, type SpotlightEntry } from "../bible/service.ts";
import { deliver, subscriptionsForUsers, type PushPurpose } from "../push/service.ts";
import type { DeliveryResult } from "../push/service.ts";

/** How many passages the home-page rotation offers; the daily verse picks from these. */
const SPOTLIGHT_REFERENCES_COUNT = 12;

export type ReminderSweep = {
  purpose: PushPurpose;
  considered: number;
  result: DeliveryResult;
};

/** `HH:MM` in `timeZone`, or null when the zone is not a real IANA zone. */
export function localNow(timeZone: string, at: Date = new Date()): { day: string; hour: number; minute: number } | null {
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts = Object.fromEntries(
      formatter.formatToParts(at).map((part) => [part.type, part.value]),
    );
    const day = `${parts.year}-${parts.month}-${parts.day}`;
    // `hour12: false` yields "24" at midnight in some ICU versions.
    const hour = Number(parts.hour) % 24;
    return { day, hour, minute: Number(parts.minute) };
  } catch {
    return null;
  }
}

export function parseHhMm(value: string): { hour: number; minute: number } {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return { hour: 7, minute: 0 };
  return { hour: Math.min(23, Number(match[1])), minute: Math.min(59, Number(match[2])) };
}

type ReminderRow = {
  user_id: string;
  timezone: string;
  daily_verse_time: string;
  streak_reminder_time: string;
  reminders_enabled: number;
  notify_daily_verse: number;
  notify_reading_streak: number;
  notify_live_worship: number;
};

function enabledUsers(): ReminderRow[] {
  return all<ReminderRow>(
    `SELECT p.user_id, u.timezone, p.daily_verse_time, p.streak_reminder_time,
            p.reminders_enabled, p.notify_daily_verse, p.notify_reading_streak, p.notify_live_worship
       FROM user_preferences p
       JOIN users u ON u.id = p.user_id
      WHERE u.deleted_at IS NULL
        AND u.status = 'active'
        AND p.reminders_enabled = 1`,
  );
}

/** The window a sweep tolerates firing late by, in minutes. */
const DUE_WINDOW_MINUTES = 10;

/**
 * Whether a reader whose local clock reads `now` is due for a reminder set at
 * `target`.
 *
 * Pure, and the only place the schedule is decided. The window is a few minutes
 * *after* the target and wraps around midnight, so a reader who set 23:55 is
 * caught by a sweep running at 00:02 instead of being skipped because the
 * arithmetic went negative.
 *
 * Idempotency is not this function's job. Under a 60-second tick roughly ten
 * sweeps each find themselves inside the window, and the unique key on
 * `push_deliveries` turns nine of them into no-ops. Keeping the "have I already
 * sent it" question in one place — the table, which survives a restart — is why
 * this can stay a two-line comparison.
 */
export function isDue(now: { hour: number; minute: number }, target: { hour: number; minute: number }): boolean {
  const minutesNow = now.hour * 60 + now.minute;
  const minutesTarget = target.hour * 60 + target.minute;
  return (minutesNow - minutesTarget + 1440) % 1440 <= DUE_WINDOW_MINUTES;
}

/**
 * Walks the enabled users and returns the ones whose local clock is inside the
 * window. The window is 10 minutes wide, which is what makes a 60-second tick
 * eventually catch every user in every timezone.
 */
function dueNow(rows: ReminderRow[], pick: (row: ReminderRow) => { on: number; time: string }, at: Date = new Date()): { row: ReminderRow; localDay: string }[] {
  const due: { row: ReminderRow; localDay: string }[] = [];

  for (const row of rows) {
    const setting = pick(row);
    if (setting.on !== 1) continue;
    const now = localNow(row.timezone, at);
    if (!now) continue; // An invalid timezone means "never", not "always".
    if (isDue(now, parseHhMm(setting.time))) due.push({ row, localDay: now.day });
  }
  return due;
}

// ─── 1. Daily verse ─────────────────────────────────────────────────────────

/**
 * One verse a day, at the reader's chosen hour, in their language when the
 * library has one.
 *
 * The verse is picked by day-of-year against the spotlight endpoint's own
 * rotation, so every user gets the same verse on the same day and the choice
 * does not depend on which verse the database happened to index first.
 */
export async function sendDailyVerse(): Promise<ReminderSweep> {
  const purpose: PushPurpose = "daily_verse";
  const due = dueNow(enabledUsers(), (row) => ({ on: row.notify_daily_verse, time: row.daily_verse_time }));
  const result: DeliveryResult = { attempted: 0, sent: 0, skipped: 0, failed: 0, retired: 0 };

  for (const { row, localDay } of due) {
    const verse = verseOfTheDay(row.user_id, localDay);
    if (!verse) continue;

    const outcome = await deliver(subscriptionsForUsers([row.user_id]), {
      purpose,
      dedupeKey: localDay,
      message: {
        title: verse.reference,
        body: verse.text,
        url: `/bible?passage=${encodeURIComponent(verse.reference)}`,
        tag: "hymnora-daily-verse",
      },
    });
    add(result, outcome);
  }

  return { purpose, considered: due.length, result };
}

/**
 * The day's verse, drawn from the same rotation the home page already uses.
 *
 * Reusing `spotlightVerses` rather than re-querying `bible_verses` is deliberate:
 * the reference list, the version fallback and the "a version missing this book
 * is skipped" behaviour are all already there and already correct, and a second
 * implementation of "pick today's verse" is how you end up with a push that
 * disagrees with the website.
 *
 * The rotation is indexed by the *reader's* local day, so the same person gets
 * the same verse all day regardless of when the worker happens to run, and two
 * readers in Nairobi and Auckland get the one that is already morning for them.
 */
export function verseOfTheDay(userId: string, localDay: string): SpotlightEntry | null {
  const entries = spotlightVerses(undefined, SPOTLIGHT_REFERENCES_COUNT);
  if (entries.length === 0) return null;

  const user = get<{ language: string }>("SELECT language FROM users WHERE id = ?", [userId]);
  const dayOfYear = dayOfYearOf(localDay);
  const offset = dayOfYear % entries.length;

  // Prefer a translation in the reader's own language, but never at the cost of
  // sending nothing: a verse in the wrong language is worse than no verse.
  const ordered = [...entries.slice(offset), ...entries.slice(0, offset)];
  const language = user?.language?.toLowerCase() ?? "english";
  return (
    ordered.find((entry) => entry.language.toLowerCase() === language) ??
    ordered.find((entry) => entry.languageCode.toLowerCase() === language.slice(0, 2)) ??
    ordered[0]!
  );
}

function dayOfYearOf(day: string): number {
  const date = new Date(`${day}T00:00:00Z`);
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  return Math.floor((date.getTime() - start) / 86_400_000);
}

// ─── 2. Reading streak ──────────────────────────────────────────────────────

/**
 * A nudge when the day's chapter has not been opened.
 *
 * Only fires when there is a streak to protect. A brand-new reader with zero
 * days is not nagged at — the first verse reminder is the introduction, and a
 * "you have a 0 day streak" message is the fastest way to get a notification
 * muted for good.
 */
export async function sendStreakNudge(): Promise<ReminderSweep> {
  const purpose: PushPurpose = "reading_streak";
  const due = dueNow(enabledUsers(), (row) => ({ on: row.notify_reading_streak, time: row.streak_reminder_time }));
  const result: DeliveryResult = { attempted: 0, sent: 0, skipped: 0, failed: 0, retired: 0 };

  for (const { row, localDay } of due) {
    const stats = streakFor(row.user_id);
    if (!stats || stats.current < 1) continue; // Nothing to protect yet.
    if (stats.lastDay === localDay) continue; // Already read today.

    const noun = stats.current === 1 ? "day" : "days";
    const outcome = await deliver(subscriptionsForUsers([row.user_id]), {
      purpose,
      dedupeKey: localDay,
      message: {
        title: `Your ${stats.current}-${noun} streak is still open`,
        body: "One chapter keeps it going. It will only take a moment.",
        url: "/bible",
        tag: "hymnora-streak",
      },
    });
    add(result, outcome);
  }

  return { purpose, considered: due.length, result };
}

export type Streak = { current: number; best: number; lastDay: string | null };

/**
 * Consecutive days ending today or yesterday.
 *
 * Yesterday counts: a streak that breaks at midnight because the reader has not
 * woken up yet is not a streak that broke.
 */
export function streakFor(userId: string, today = localNow("UTC")?.day ?? new Date().toISOString().slice(0, 10)): Streak {
  const days = all<{ day: string }>(
    "SELECT day FROM reading_days WHERE user_id = ? ORDER BY day DESC LIMIT 400",
    [userId],
  ).map((row) => row.day);
  if (days.length === 0) return { current: 0, best: 0, lastDay: null };

  const yesterday = shiftDay(today, -1);
  if (days[0] !== today && days[0] !== yesterday) {
    return { current: 0, best: bestRun(days), lastDay: days[0] };
  }

  let current = 0;
  let cursor = days[0]!;
  for (const day of days) {
    if (day === cursor) {
      current += 1;
      cursor = shiftDay(cursor, -1);
    } else if (day < cursor) {
      break;
    }
  }
  return { current, best: Math.max(bestRun(days), current), lastDay: days[0] };
}

function bestRun(days: string[]): number {
  let best = 0;
  let run = 0;
  let previous: string | null = null;
  for (const day of days) {
    run = previous && day === shiftDay(previous, -1) ? run + 1 : 1;
    best = Math.max(best, run);
    previous = day;
  }
  return best;
}

export function shiftDay(day: string, by: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + by);
  return date.toISOString().slice(0, 10);
}

/**
 * The user's own timezone, or Nairobi.
 *
 * Read from the `users` table rather than from the request: the push
 * subscription already carries a client-reported zone, but this is the
 * authoritative one and a request is not always available (the worker has no
 * requests at all).
 */
export function timezoneFor(userId: string, fallback = "Africa/Nairobi"): string {
  const row = get<{ timezone: string | null }>("SELECT timezone FROM users WHERE id = ?", [userId]);
  return row?.timezone || fallback;
}

/**
 * Records that a chapter was read today and refreshes the cached counters in
 * `user_preferences`, which is what the Settings page reads.
 */
export function recordReadingDay(userId: string, timeZone: string): Streak {
  const day = localNow(timeZone)?.day ?? new Date().toISOString().slice(0, 10);
  run(
    `INSERT INTO reading_days (user_id, day, chapters_read)
     VALUES (?, ?, 1)
     ON CONFLICT (user_id, day) DO UPDATE SET chapters_read = chapters_read + 1`,
    [userId, day],
  );
  const stats = streakFor(userId, day);
  run(
    `UPDATE user_preferences
        SET reading_streak_current = ?, reading_streak_best = ?, last_reading_day = ?,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE user_id = ?`,
    [stats.current, stats.best, day, userId],
  );
  return stats;
}

// ─── 3. Live worship & church events ────────────────────────────────────────

/**
 * Alerts before a stream goes live, and just before a saved event starts.
 *
 * These are event-driven rather than clock-driven: the worker calls `fireLiveAlerts`
 * when it notices a stream has crossed into its alert window, and the dedupe
 * key (`live-<id>`) means a stream can only ever raise one alert no matter how
 * often the check runs.
 */
export async function fireLiveAlerts(): Promise<ReminderSweep[]> {
  const result: DeliveryResult = { attempted: 0, sent: 0, skipped: 0, failed: 0, retired: 0 };
  const sweeps: ReminderSweep[] = [];

  for (const stream of streamsInAlertWindow()) {
    const recipients = subscribersTo(stream);
    if (recipients.length === 0) continue;

    const outcome = await deliver(subscriptionsForUsers(recipients.map((row) => row.user_id)), {
      purpose: "live_worship",
      dedupeKey: `live-${stream.id}`,
      message: {
        title: stream.startsInMinutes <= 0 ? `${stream.title} is live now` : `Starting in ${stream.startsInMinutes} minutes`,
        body: stream.church || stream.title,
        url: `/live?stream=${stream.id}`,
        tag: `hymnora-live-${stream.id}`,
      },
      filter: (subscription) => {
        const preference = get<{ notify_live_worship: number; reminders_enabled: number; live_alert_lead_minutes: number }>(
          "SELECT notify_live_worship, reminders_enabled, live_alert_lead_minutes FROM user_preferences WHERE user_id = ?",
          [subscription.user_id],
        );
        if (!preference || preference.reminders_enabled !== 1 || preference.notify_live_worship !== 1) return false;
        return stream.startsInMinutes <= preference.live_alert_lead_minutes;
      },
    });
    add(result, outcome);
    sweeps.push({ purpose: "live_worship", considered: recipients.length, result: outcome });
  }

  return sweeps;
}

type AlertStream = { id: string; title: string; church: string; startsAt: string; startsInMinutes: number };

/**
 * Streams inside their lead window. The user's own `live_alert_lead_minutes`
 * narrows this further in the `filter` below; 60 minutes is the widest anyone
 * can set, so it is the outer bound here.
 */
function streamsInAlertWindow(): AlertStream[] {
  const now = new Date().toISOString();
  const horizon = new Date(Date.now() + 60 * 60_000).toISOString();
  return all<{ id: string; title: string; church_name: string; starts_at: string }>(
    `SELECT id, title, church_name, starts_at
       FROM live_streams
      WHERE starts_at IS NOT NULL
        AND starts_at BETWEEN ? AND ?
        AND status IN ('Live now', 'Starting soon', 'Upcoming')
      ORDER BY starts_at`,
    [now, horizon],
  ).map((row) => ({
    id: row.id,
    title: row.title,
    church: row.church_name,
    startsAt: row.starts_at,
    startsInMinutes: Math.round((new Date(row.starts_at).getTime() - Date.now()) / 60_000),
  }));
}

/**
 * Who should hear about this stream.
 *
 * Three overlapping audiences, in descending order of how deliberate they were:
 * someone explicitly asked to be reminded about this event, someone who follows
 * the broadcasting church, and someone who follows any church and is already
 * online. `notify_live` is honoured per row so a user who turned the per-church
 * bell off is not added by the wider follow query.
 */
function subscribersTo(stream: AlertStream): { user_id: string }[] {
  // `events.starts_at` is stored as an ISO-8601 UTC string, so the window
  // bounds are computed here rather than with SQLite's `datetime()`, which
  // emits a space-separated form that never compares equal to a `T`-joined
  // ISO string.
  const streamStart = new Date(stream.startsAt);
  const windowStart = new Date(streamStart.getTime() - 30 * 60_000).toISOString();
  const windowEnd = new Date(streamStart.getTime() + 30 * 60_000).toISOString();
  return all<{ user_id: string }>(
    `SELECT DISTINCT user_id FROM (
       SELECT se.user_id
         FROM saved_events se
         JOIN events e ON e.id = se.event_id
        WHERE se.notify_live = 1
          AND e.status = 'published'
          AND e.starts_at BETWEEN ? AND ?
       UNION
       SELECT f.user_id
         FROM followed_churches f
         JOIN live_streams s ON s.church_id = f.church_id
        WHERE f.notify_live = 1 AND s.id = ?
     )`,
    [windowStart, windowEnd, stream.id],
  );
}

function add(into: DeliveryResult, from: DeliveryResult): void {
  into.attempted += from.attempted;
  into.sent += from.sent;
  into.skipped += from.skipped;
  into.failed += from.failed;
  into.retired += from.retired;
}
