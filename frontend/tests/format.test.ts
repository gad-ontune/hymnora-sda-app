/**
 * The formatters the player and the video surfaces share.
 *
 * These have a test because every bug they had was silent: a duration that read
 * as `899`, and a like count that rendered as "16 views likes". Neither throws,
 * and neither is visible without looking at the page.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatClock, formatCount, formatTotal, formatViews, formatWhen, initials } from "../src/lib/format.ts";

describe("formatClock", () => {
  it("reads seconds the way a person says them", () => {
    assert.equal(formatClock(0), "0:00");
    assert.equal(formatClock(9), "0:09");
    assert.equal(formatClock(59), "0:59");
    assert.equal(formatClock(60), "1:00");
    assert.equal(formatClock(899), "14:59");
  });

  it("adds an hours field past an hour, because 94:59 is not a duration", () => {
    assert.equal(formatClock(3600), "1:00:00");
    assert.equal(formatClock(5691), "1:34:51");
  });

  it("truncates rather than rounding, so a track never claims time it does not have", () => {
    assert.equal(formatClock(59.9), "0:59");
    assert.equal(formatClock(119.9), "1:59");
  });

  it("treats a missing or nonsensical duration as zero rather than rendering NaN", () => {
    assert.equal(formatClock(Number.NaN), "0:00");
    assert.equal(formatClock(-1), "0:00");
    assert.equal(formatClock(Number.POSITIVE_INFINITY), "0:00");
  });
});

describe("formatViews", () => {
  it("leaves small counts exact, because 9 and 0.9K are different claims", () => {
    assert.equal(formatViews(1), "1 view");
    assert.equal(formatViews(9), "9 views");
    assert.equal(formatViews(999), "999 views");
  });

  it("abbreviates the way YouTube does", () => {
    assert.equal(formatViews(1_000), "1.0K views");
    assert.equal(formatViews(44_437), "44K views");
    assert.equal(formatViews(905), "905 views");
    assert.equal(formatViews(1_500_000), "1.5M views");
  });

  it("says so when there are none, rather than showing a bare 0", () => {
    assert.equal(formatViews(0), "No views");
    assert.equal(formatViews(-4), "No views");
    assert.equal(formatViews(Number.NaN), "No views");
  });
});

describe("formatCount", () => {
  it("keeps a like count exact and un-abbreviated", () => {
    assert.equal(formatCount(16), "16");
    assert.equal(formatCount(1_474), "1,474");
  });

  it("is not the view formatter", () => {
    // The bug this exists to prevent: `formatViews(16)` is "16 views", which
    // reads as "16 views likes".
    assert.notEqual(formatCount(16), formatViews(16));
    assert.equal(formatViews(16).includes("view"), true);
    assert.equal(formatCount(16).includes("view"), false);
  });

  it("is zero rather than empty for a count nobody has", () => {
    assert.equal(formatCount(0), "0");
    assert.equal(formatCount(Number.NaN), "0");
  });
});

describe("formatWhen", () => {
  const now = new Date("2026-09-28T12:00:00Z");

  it("describes the last few minutes and hours", () => {
    assert.equal(formatWhen("2026-09-28T11:59:30Z", now), "just now");
    assert.equal(formatWhen("2026-09-28T11:30:00Z", now), "30 minutes ago");
    assert.equal(formatWhen("2026-09-28T11:59:00Z", now), "1 minute ago");
    assert.equal(formatWhen("2026-09-28T02:00:00Z", now), "10 hours ago");
  });

  it("describes days and weeks", () => {
    assert.equal(formatWhen("2026-09-26T12:00:00Z", now), "2 days ago");
    assert.equal(formatWhen("2026-09-21T12:00:00Z", now), "1 week ago");
  });

  it("falls back to a date once weeks stop being useful", () => {
    const old = formatWhen("2026-01-04T12:00:00Z", now);
    assert.match(old, /4/);
    assert.equal(old.includes("ago"), false);
  });

  it("does not claim a video is from the future when a clock disagrees", () => {
    assert.equal(formatWhen("2026-10-01T12:00:00Z", now), "just now");
  });

  it("returns nothing for a missing or unparseable date rather than NaN", () => {
    assert.equal(formatWhen("", now), "");
    assert.equal(formatWhen("not a date", now), "");
  });
});

describe("formatTotal", () => {
  it("speaks in minutes and hours, not in a clock time", () => {
    assert.equal(formatTotal(42 * 60), "42 min");
    assert.equal(formatTotal(60 * 60), "1 hr");
    assert.equal(formatTotal(95 * 60), "1 hr 35 min");
    // 1775 minutes is 29 hours 35 minutes, not 30.
    assert.equal(formatTotal(1775 * 60), "29 hr 35 min");
  });

  it("returns nothing for a total of zero, so no row reads '0 min'", () => {
    assert.equal(formatTotal(0), "");
    assert.equal(formatTotal(Number.NaN), "");
  });
});

describe("initials", () => {
  it("takes the first letter of the first two words", () => {
    assert.equal(initials("Peter Kamau"), "PK");
    assert.equal(initials("Ada Wanjiru Mwangi"), "AW");
  });

  it("falls back to the email when a name is missing or blank", () => {
    assert.equal(initials(null, "reader@hymnora.app"), "R");
    assert.equal(initials("   ", "reader@hymnora.app"), "R");
    // The local part is the human part; the domain is not an identity.
    assert.equal(initials(undefined, "peter.kamau@hymnora.app"), "PK");
  });

  it("gives a one-word name one letter rather than an empty circle", () => {
    assert.equal(initials("Cher"), "C");
  });

  it("returns nothing when there is no name and no email", () => {
    assert.equal(initials(null, null), "");
    assert.equal(initials("", ""), "");
  });

  it("does not count the separators as words", () => {
    assert.equal(initials("  Peter   Kamau  "), "PK");
    assert.equal(initials("peter_kamau"), "PK");
    assert.equal(initials("peter-kamau"), "PK");
  });
});
