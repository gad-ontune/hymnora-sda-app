/**
 * Whitelist integrity checks.
 *
 * A channel id in the whitelist that does not resolve is the quietest possible
 * failure in this pipeline: the poller spends a quota unit, gets an empty list,
 * marks the channel as polled, and moves on. Nothing logs an error and the
 * music page is simply emptier than it should be.
 *
 * So the ids are checked at two points — at seed time, for shape, and in
 * `scripts/verify-channels.mjs`, against the live API, for existence.
 */

import { CHANNEL_WHITELIST, type WhitelistSeed } from "./whitelist.ts";

export type WhitelistProblem = {
  title: string;
  channelId: string;
  problem: string;
};

const CHANNEL_ID = /^UC[0-9A-Za-z_-]{22}$/;

/** Shape checks. Catches typos and truncated ids without a network call. */
export function validateWhitelistShape(entries: WhitelistSeed[] = CHANNEL_WHITELIST): WhitelistProblem[] {
  const problems: WhitelistProblem[] = [];
  const seenIds = new Map<string, string>();
  const seenTitles = new Map<string, string>();

  for (const entry of entries) {
    if (!CHANNEL_ID.test(entry.channelId)) {
      problems.push({
        title: entry.title,
        channelId: entry.channelId,
        problem: "Not a well-formed channel id (expected 24 characters starting with \"UC\")",
      });
    }
    const previous = seenIds.get(entry.channelId);
    if (previous) {
      problems.push({
        title: entry.title,
        channelId: entry.channelId,
        problem: `Duplicate id — already claimed by "${previous}"`,
      });
    }
    seenIds.set(entry.channelId, entry.title);

    // Two entries under one title means either a copy-paste slip or two channels
    // that were renamed onto the same name during a rewrite — both of which
    // leave the music page showing the same name twice. Real channels
    // occasionally collide on a name, so this is reported, not fatal.
    const titleKey = entry.title.replace(/\s+/g, " ").trim().toLowerCase();
    if (titleKey) {
      const previousTitle = seenTitles.get(titleKey);
      if (previousTitle) {
        problems.push({
          title: entry.title,
          channelId: entry.channelId,
          problem: `Duplicate title — "${previousTitle}" already uses this name`,
        });
      }
      seenTitles.set(titleKey, entry.title);
    }

    if (!entry.title.trim()) {
      problems.push({ title: "(untitled)", channelId: entry.channelId, problem: "Missing a title" });
    }
    if (!entry.country.trim()) {
      problems.push({ title: entry.title, channelId: entry.channelId, problem: "Missing a country" });
    }
    // The music page groups by language, and a blank one leaves a card with no
    // subtitle — which reads as a bug in the app rather than in the data.
    if (!entry.language.trim()) {
      problems.push({ title: entry.title, channelId: entry.channelId, problem: "Missing a language" });
    }
    if (!["east-africa", "southern-africa", "west-africa", "europe", "north-america", "global"].includes(entry.region)) {
      problems.push({ title: entry.title, channelId: entry.channelId, problem: `Unknown region "${entry.region}"` });
    }
    if (!["music", "preaching", "mixed"].includes(entry.focus)) {
      problems.push({ title: entry.title, channelId: entry.channelId, problem: `Unknown focus "${entry.focus}"` });
    }
    // The affiliation gate: no SDA marker, no ingest. A channel without one was
    // introduced before the gate existed and is exactly what "it must be SDA"
    // is there to stop.
    if (!["sda", "other"].includes(entry.denomination)) {
      problems.push({
        title: entry.title,
        channelId: entry.channelId,
        problem: `Missing or unknown denomination "${String(entry.denomination)}" — every channel must be marked sda or other`,
      });
    }
  }

  return problems;
}

/** Music-only channels without a dedicated streaming use. Not fatal, worth a look. */
export function summariseByFocus(entries: WhitelistSeed[] = CHANNEL_WHITELIST): Record<string, number> {
  const counts: Record<string, number> = { music: 0, preaching: 0, mixed: 0 };
  for (const entry of entries) counts[entry.focus] = (counts[entry.focus] ?? 0) + 1;
  return counts;
}
