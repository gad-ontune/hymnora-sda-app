/**
 * Streak arithmetic and reminder scheduling.
 *
 * These are date maths, which is exactly the category of code that is easy to
 * write, passes review, and is quietly wrong in production — on the 1st of a
 * month, across a DST boundary, or when a user reads their chapter at 23:50
 * Nairobi time. The cases below are the ones that actually break.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isDue, localNow, parseHhMm, shiftDay } from "../src/modules/push/reminders.ts";

describe("parseHhMm", () => {
  it("reads the format the Settings page stores", () => {
    assert.deepEqual(parseHhMm("07:00"), { hour: 7, minute: 0 });
    assert.deepEqual(parseHhMm("19:30"), { hour: 19, minute: 30 });
    assert.deepEqual(parseHhMm("00:00"), { hour: 0, minute: 0 });
    assert.deepEqual(parseHhMm("23:59"), { hour: 23, minute: 59 });
  });

  it("accepts an unpadded hour, which a time input can produce", () => {
    assert.deepEqual(parseHhMm("7:05"), { hour: 7, minute: 5 });
  });

  it("clamps rather than throwing on an out-of-range value", () => {
    // The column has a CHECK constraint, but a bad row must not be able to crash
    // the daily sweep for every other user.
    assert.deepEqual(parseHhMm("25:00"), { hour: 23, minute: 0 });
    assert.deepEqual(parseHhMm("07:99"), { hour: 7, minute: 59 });
  });

  it("falls back to 07:00 on something that is not a time at all", () => {
    assert.deepEqual(parseHhMm("7am"), { hour: 7, minute: 0 });
    assert.deepEqual(parseHhMm(""), { hour: 7, minute: 0 });
  });
});

describe("shiftDay", () => {
  it("crosses a month boundary", () => {
    assert.equal(shiftDay("2026-03-31", -1), "2026-03-30");
    assert.equal(shiftDay("2026-04-01", -1), "2026-03-31");
  });

  it("crosses a year boundary", () => {
    assert.equal(shiftDay("2026-01-01", -1), "2025-12-31");
    assert.equal(shiftDay("2025-12-31", 1), "2026-01-01");
    assert.equal(shiftDay("2026-12-31", 1), "2027-01-01");
  });

  it("handles a leap day, and knows when there is not one", () => {
    assert.equal(shiftDay("2028-03-01", -1), "2028-02-29");
    assert.equal(shiftDay("2026-03-01", -1), "2026-02-28");
  });

  it("returns the same day for a zero offset", () => {
    assert.equal(shiftDay("2026-03-05", 0), "2026-03-05");
  });
});

describe("localNow", () => {
  it("reports the calendar date in the user's zone, not the server's", () => {
    // 20:30 UTC on the 5th is 23:30 on the 5th in Nairobi and 16:30 on the 5th in
    // New York. A date worked out in UTC is wrong for the nine hours Nairobi is
    // ahead, and it is the date that decides whether today's verse has been sent.
    const at = new Date("2026-03-05T20:30:00Z");
    assert.deepEqual(localNow("Africa/Nairobi", at), { day: "2026-03-05", hour: 23, minute: 30 });
    // New York is still on standard time on 5 March; the DST cases are below.
    assert.deepEqual(localNow("America/New_York", at), { day: "2026-03-05", hour: 15, minute: 30 });
  });

  it("rolls the date over on the far side of local midnight", () => {
    // 02:00 UTC on the 6th is still the 5th in New York and already the 6th in
    // Auckland. One server-side "today" cannot serve both.
    const at = new Date("2026-03-06T02:00:00Z");
    assert.equal(localNow("America/New_York", at)!.day, "2026-03-05");
    assert.equal(localNow("Africa/Nairobi", at)!.day, "2026-03-06");
    assert.equal(localNow("Pacific/Auckland", at)!.day, "2026-03-06");
  });

  it("reports midnight as hour 0, not 24", () => {
    // `hour12: false` yields "24" at midnight in some ICU versions, which would
    // make the 00:00 window unreachable and every midnight verse late by a day.
    const at = new Date("2026-03-05T21:00:00Z");
    const nairobi = localNow("Africa/Nairobi", at)!;
    assert.equal(nairobi.day, "2026-03-06");
    assert.equal(nairobi.hour, 0);
    assert.equal(nairobi.minute, 0);
  });

  it("returns null for a zone that is not real rather than throwing", () => {
    // A browser can report anything, and a bad row must not take down the sweep.
    assert.equal(localNow("Not/AZone"), null);
    assert.equal(localNow(""), null);
  });
});

describe("isDue", () => {
  const target = parseHhMm("07:00");
  const at = (hour: number, minute = 0) => ({ hour, minute });

  it("fires on the minute", () => {
    assert.equal(isDue(at(7, 0), target), true);
  });

  it("tolerates a sweep that runs a little late", () => {
    // The whole point of the window: a 60-second tick, a job that was queued
    // behind something else, a server briefly busy. A reader must not lose a
    // morning verse because a timer fired ninety seconds late.
    assert.equal(isDue(at(7, 5), target), true);
    assert.equal(isDue(at(7, 10), target), true);
  });

  it("stops firing once the window has closed", () => {
    assert.equal(isDue(at(7, 11), target), false);
    assert.equal(isDue(at(7, 30), target), false);
    assert.equal(isDue(at(9, 0), target), false);
  });

  it("does not fire hours early", () => {
    assert.equal(isDue(at(3, 0), target), false);
    assert.equal(isDue(at(6, 45), target), false);
  });

  it("wraps around midnight rather than going negative", () => {
    // A reader who set 23:55 must be caught by a sweep at 00:02, not skipped
    // because the arithmetic produced a negative delta.
    const late = parseHhMm("23:55");
    assert.equal(isDue(at(0, 2), late), true);
    assert.equal(isDue(at(23, 55), late), true);
    assert.equal(isDue(at(23, 50), late), false);
    assert.equal(isDue(at(1, 0), late), false);
  });

  it("handles 00:00 exactly", () => {
    const midnight = parseHhMm("00:00");
    assert.equal(isDue(at(0, 0), midnight), true);
    assert.equal(isDue(at(0, 9), midnight), true);
    assert.equal(isDue(at(23, 55), midnight), false);
  });

  it("keeps answering true across the whole window, leaving dedupe to the table", () => {
    // Ten consecutive ticks all see themselves inside the window, and that is
    // intended: the unique key on `push_deliveries` is what makes the second
    // send a no-op, and it survives a restart in a way an in-memory flag
    // would not. The point of this test is that the window is a time range and
    // not a single instant that a slow sweep would miss.
    for (let minute = 0; minute <= 10; minute += 1) {
      assert.equal(isDue(at(7, minute), target), true, `07:${String(minute).padStart(2, "0")} should be inside the window`);
    }
    assert.equal(isDue(at(7, 11), target), false);
  });
});
