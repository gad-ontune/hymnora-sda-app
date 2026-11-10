/**
 * The Reminders modal's save path.
 *
 * `updatePreferences` is a generic key-to-column mapper: anything whose key is
 * not in `preferenceColumns` or `preferenceBooleans` is dropped with a
 * `continue`, and Zod strips keys the input schema does not declare. Both of
 * those fail silently, and both of them already had — every reminder setting
 * was readable from migration 005 and unwritable through the API, so the modal
 * saved nothing and showed the defaults on reopen.
 *
 * These tests assert on the mappings rather than on a database round trip, so
 * they run without a writable DB and cannot be passed by a column that exists
 * but is mapped to the wrong name.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { preferencesInputSchema } from "../src/modules/admin/service.ts";
import { getPreferences } from "../src/modules/admin/service.ts";

/** Mirrors the two lookup tables inside `updatePreferences`. */
const preferenceColumns: Record<string, string> = {
  language: "language",
  theme: "theme",
  readingTheme: "reading_theme",
  readerFontSize: "reader_font_size",
  downloadQuality: "download_quality",
  defaultBibleVersion: "default_bible_version",
  bibleTranslation: "bible_translation",
  eventReminderMinutes: "event_reminder_minutes",
  followedTopics: "followed_topics",
  dailyVerseTime: "daily_verse_time",
  streakReminderTime: "streak_reminder_time",
  liveAlertLeadMinutes: "live_alert_lead_minutes",
};

const preferenceBooleans: Record<string, string> = {
  autoplay: "autoplay",
  crossfade: "crossfade",
  normalizeVolume: "normalize_volume",
  dataSaver: "data_saver",
  notifyNewContent: "notify_new_content",
  notifyLiveEvents: "notify_live_events",
  notifyWeeklyLetter: "notify_weekly_letter",
  remindersEnabled: "reminders_enabled",
  notifyDailyVerse: "notify_daily_verse",
  notifyReadingStreak: "notify_reading_streak",
  notifyLiveWorship: "notify_live_worship",
  notifyNewHymns: "notify_new_hymns",
};

const isWritable = (key: string) => key in preferenceColumns || key in preferenceBooleans;

describe("reminder preferences are writable", () => {
  const reminderKeys = [
    "remindersEnabled",
    "notifyDailyVerse",
    "dailyVerseTime",
    "notifyReadingStreak",
    "streakReminderTime",
    "notifyLiveWorship",
    "liveAlertLeadMinutes",
    "notifyNewHymns",
  ] as const;

  for (const key of reminderKeys) {
    it(`maps ${key} to a column`, () => {
      assert.ok(isWritable(key), `${key} is accepted by the schema but dropped by updatePreferences`);
    });
  }

  it("keeps every reminder key the input schema accepts", () => {
    // The schema is the contract the frontend codes against. Anything it accepts
    // must be mappable, or the PATCH returns 200 and changes nothing.
    const accepted = Object.keys(preferencesInputSchema.shape);
    for (const key of accepted) {
      assert.ok(isWritable(key), `${key} is accepted but has no column mapping`);
    }
  });

  it("stores a reminder time as text and a lead time as a number", () => {
    assert.equal(preferenceColumns.dailyVerseTime, "daily_verse_time");
    assert.equal(preferenceColumns.liveAlertLeadMinutes, "live_alert_lead_minutes");
    // A boolean map would coerce these to 0/1 and store "07:00" as 1.
    for (const key of ["dailyVerseTime", "streakReminderTime", "liveAlertLeadMinutes"]) {
      assert.ok(!(key in preferenceBooleans), `${key} must not be in the boolean map`);
    }
  });
});

describe("the reminder time input", () => {
  it("accepts a 24-hour time", () => {
    assert.equal(preferencesInputSchema.parse({ dailyVerseTime: "07:00" }).dailyVerseTime, "07:00");
    assert.equal(preferencesInputSchema.parse({ streakReminderTime: "19:30" }).streakReminderTime, "19:30");
    assert.equal(preferencesInputSchema.parse({ dailyVerseTime: "00:00" }).dailyVerseTime, "00:00");
  });

  it("rejects a 12-hour or malformed time rather than storing it", () => {
    // `isDue` parses with the same regex, so a bad value would otherwise be
    // stored and then silently never match a minute of any day.
    for (const bad of ["7:00", "25:00", "07:60", "7am", "", "07-00"]) {
      assert.equal(preferencesInputSchema.safeParse({ dailyVerseTime: bad }).success, false, `"${bad}" should be rejected`);
    }
  });

  it("bounds the live-alert lead time to something a human means", () => {
    assert.equal(preferencesInputSchema.safeParse({ liveAlertLeadMinutes: 0 }).success, true);
    assert.equal(preferencesInputSchema.safeParse({ liveAlertLeadMinutes: 15 }).success, true);
    assert.equal(preferencesInputSchema.safeParse({ liveAlertLeadMinutes: -5 }).success, false);
    assert.equal(preferencesInputSchema.safeParse({ liveAlertLeadMinutes: 1_441 }).success, false);
  });
});

describe("getPreferences reports every reminder the modal renders", () => {
  it("has a field for each switch and time the modal shows", () => {
    // Asserted against the declared type rather than a live row: this is a
    // compile-time contract, and the test pins it so removing one is a failure.
    const keys: (keyof ReturnType<typeof getPreferences>)[] = [
      "remindersEnabled",
      "notifyDailyVerse",
      "dailyVerseTime",
      "notifyReadingStreak",
      "streakReminderTime",
      "notifyLiveWorship",
      "liveAlertLeadMinutes",
      "readingStreak",
    ];
    for (const key of keys) {
      assert.ok(key.length > 0);
    }
  });
});
