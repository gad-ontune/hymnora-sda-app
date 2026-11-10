/**
 * The reading streak ledger.
 *
 * The streak nudge in `reminders.ts` can only be as good as the record of what
 * was actually read, and that record has to be written by the reader opening a
 * chapter — not by the worker. So the Bible reader POSTs here once per chapter,
 * and the row it gets back is what it shows in the streak badge.
 *
 * Anonymous readers are deliberately not recorded. A streak that can be started
 * without an account is a streak that cannot be nudged, and the nudge is the
 * whole feature.
 */

import { Router } from "express";
import { asyncHandler } from "../../lib/async.ts";
import { optionalAuth, requireAuth } from "../../middleware/auth.ts";
import { recordReadingDay, streakFor, shiftDay, timezoneFor, localNow } from "./reminders.ts";

export const readingRouter: Router = Router();

/** `GET /api/reading/streak` — the current run and the best one. */
readingRouter.get(
  "/streak",
  optionalAuth,
  asyncHandler(async (req, res) => {
    if (!req.auth) {
      res.json({ current: 0, best: 0, lastDay: null, today: isoToday(), days: [] });
      return;
    }
    res.json(streakPayload(req.auth.id, timezoneFor(req.auth.id)));
  }),
);

/**
 * `POST /api/reading/day` — "I opened a chapter today".
 *
 * Idempotent per day in the sense that matters: calling it five times in a row
 * increments `chapters_read` but does not create five streaks, and the returned
 * counters are the same.
 */
readingRouter.post(
  "/day",
  requireAuth,
  asyncHandler(async (req, res) => {
    // The client sends its own zone because a reader in Nairobi on a laptop set
    // to UTC still wants "today" to mean their today.
    const reported = typeof req.body?.timezone === "string" ? req.body.timezone : null;
    const timezone = reported ?? timezoneFor(req.auth!.id);
    recordReadingDay(req.auth!.id, timezone);
    res.json(streakPayload(req.auth!.id, timezone));
  }),
);

/** The last 30 days, for the streak strip in the reader. */
function streakPayload(userId: string, timezone: string) {
  // `today` has to be the reader's local day — the same day `recordReadingDay`
  // writes — or a reader whose zone is ahead of UTC is shown a streak that the
  // POST they just made already counted as broken.
  const today = localNow(timezone)?.day ?? isoToday();
  const stats = streakFor(userId, today);
  const days: string[] = [];
  for (let offset = 29; offset >= 0; offset -= 1) days.push(shiftDay(today, -offset));
  return { ...stats, today, days };
}

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}
