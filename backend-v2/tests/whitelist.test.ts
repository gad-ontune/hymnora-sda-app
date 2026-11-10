/**
 * The whitelist registry.
 *
 * This file is the one thing in the ingest pipeline a human maintains by hand,
 * so these tests are about it being *honest* rather than about it being right.
 * A channel id that is malformed must fail here and at startup; an id that is
 * well-formed but wrong cannot be caught without the live API, which is what
 * `npm run channels:verify` is for.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CHANNEL_WHITELIST, REGION_LABELS } from "../src/modules/youtube/whitelist.ts";
import { summariseByFocus, validateWhitelistShape } from "../src/modules/youtube/whitelist-check.ts";
import { parseIsoDuration } from "../src/modules/youtube/client.ts";

/** A well-formed id for the negative cases below. */
const GOOD_ID = "UCabcdefghijklmnopqrstuv";

const entry = (over: Partial<(typeof CHANNEL_WHITELIST)[number]> = {}) => ({
  channelId: GOOD_ID,
  title: "Example SDA Church",
  handle: null,
  country: "Kenya",
  region: "east-africa" as const,
  language: "English",
  focus: "music" as const,
  denomination: "sda" as const,
  ...over,
});

describe("validateWhitelistShape", () => {
  it("accepts a well-formed entry", () => {
    assert.deepEqual(validateWhitelistShape([entry()]), []);
  });

  it("rejects an id that is not 24 characters", () => {
    for (const channelId of ["UCtooShort", `${GOOD_ID}AA`, `${GOOD_ID.slice(0, 23)}`]) {
      const problems = validateWhitelistShape([entry({ channelId })]);
      assert.ok(problems.length > 0, `${channelId} (${channelId.length} chars) should be rejected`);
    }
  });

  it("rejects an id that does not start with UC", () => {
    const problems = validateWhitelistShape([entry({ channelId: `XX${GOOD_ID.slice(2)}` })]);
    assert.ok(problems.some((problem) => /UC/.test(problem.problem)));
  });

  it("rejects an id using characters YouTube never emits", () => {
    const problems = validateWhitelistShape([entry({ channelId: "UC-abcdefghijklmnopqrstuv" })]);
    assert.ok(problems.length > 0, "a hyphen is not in the channel-id alphabet");
  });

  it("reports the same id claimed by two channels", () => {
    const problems = validateWhitelistShape([
      entry({ title: "First" }),
      entry({ title: "Second" }),
    ]);
    assert.ok(problems.some((problem) => /Duplicate/.test(problem.problem)));
    assert.ok(problems.some((problem) => problem.title === "Second" && /First/.test(problem.problem)));
  });

  it("catches a region with no label", () => {
    const problems = validateWhitelistShape([entry({ region: "atlantis" as never })]);
    assert.ok(problems.some((problem) => /atlantis/.test(problem.problem)));
  });

  it("catches a focus the classifier does not understand", () => {
    const problems = validateWhitelistShape([entry({ focus: "chanting" as never })]);
    assert.ok(problems.some((problem) => /chanting/.test(problem.problem)));
  });

  it("catches a channel that is not marked sda or other", () => {
    // The affiliation gate's own test: a channel introduced without a
    // denomination is exactly the channel this gate exists to stop.
    for (const denomination of [undefined, "lutheran", ""]) {
      const problems = validateWhitelistShape([entry({ denomination: denomination as never })]);
      assert.ok(
        problems.some((problem) => /[Uu]nknown denomination|Missing or unknown denomination/.test(problem.problem)),
        `denomination "${String(denomination)}" should be rejected: ${JSON.stringify(problems)}`,
      );
    }
  });

  it("catches an entry with no title", () => {
    const problems = validateWhitelistShape([entry({ title: "   " })]);
    assert.ok(problems.some((problem) => /[Mm]issing a title/.test(problem.problem)));
  });

  it("catches a country with no country", () => {
    const problems = validateWhitelistShape([entry({ country: "" })]);
    assert.ok(problems.length > 0);
  });

  it("catches two entries sharing a title", () => {
    // Replaced wholesale from guessed names to real ones, this is exactly how a
    // stale entry survives a rewrite: the new list is added, the old one is not
    // removed, and the page shows the same name twice.
    const problems = validateWhitelistShape([entry(), entry({ channelId: "UCbbbb2222cccc3333dddd444" })]);
    assert.ok(problems.some((problem) => /[Dd]uplicate title/.test(problem.problem)), JSON.stringify(problems));
  });

  it("ignores case and extra whitespace when comparing titles", () => {
    const problems = validateWhitelistShape([
      entry({ title: "Example SDA Church" }),
      entry({ channelId: "UCbbbb2222cccc3333dddd444", title: "  example   sda   church  " }),
    ]);
    assert.equal(problems.filter((problem) => /[Dd]uplicate title/.test(problem.problem)).length, 1);
  });

  it("does not call two differently-named channels a collision", () => {
    const problems = validateWhitelistShape([
      entry({ title: "Nairobi Central SDA Church" }),
      entry({ channelId: "UCbbbb2222cccc3333dddd444", title: "Nairobi South SDA Church" }),
    ]);
    assert.equal(problems.filter((problem) => /[Dd]uplicate title/.test(problem.problem)).length, 0);
  });

  it("collects every problem rather than stopping at the first", () => {
    // One run of the check has to be enough to fix the file.
    const problems = validateWhitelistShape([entry({ channelId: "short", region: "atlantis" as never, focus: "chanting" as never })]);
    assert.ok(problems.length >= 3, `expected 3 problems, got ${problems.length}`);
  });
});

describe("the committed whitelist", () => {
  it("passes its own shape check", () => {
    // This is the assertion that flips the pipeline from "structurally broken"
    // to "ready for API verification".
    assert.deepEqual(validateWhitelistShape(CHANNEL_WHITELIST), []);
  });

  it("has no duplicate channel IDs", () => {
    const ids = CHANNEL_WHITELIST.map((channel) => channel.channelId);
    assert.equal(new Set(ids).size, ids.length, "the same channel twice means it is polled twice");
  });

  it("gives every channel a region that has a label", () => {
    for (const channel of CHANNEL_WHITELIST) {
      assert.ok(REGION_LABELS[channel.region], `${channel.title} has no label for "${channel.region}"`);
    }
  });

  it("labels every region it uses, so no bubble can render as a raw slug", () => {
    for (const region of new Set(CHANNEL_WHITELIST.map((channel) => channel.region))) {
      assert.ok(REGION_LABELS[region], `"${region}" is used but has no label`);
    }
  });

  it("covers all three channel natures, or one of the two tables never fills", () => {
    const focuses = new Set(CHANNEL_WHITELIST.map((channel) => channel.focus));
    assert.ok(focuses.has("music"), "no music channels: the music page stays empty");
    assert.ok(focuses.has("preaching"), "no preaching channels: the sermons table never fills");
  });

  it("marks every channel with an affiliation, and quarantines the non-SDA ones", () => {
    // Every channel must carry the gate, and the known non-SDA entries (the AIC
    // choirs) must be recorded as "other" so nothing re-admits them silently.
    for (const channel of CHANNEL_WHITELIST) {
      assert.ok(["sda", "other"].includes(channel.denomination), `${channel.title} has no denomination`);
    }
    const quarantined = CHANNEL_WHITELIST.filter((channel) => channel.denomination === "other");
    const titles = quarantined.map((channel) => channel.title);
    assert.deepEqual([...titles].sort(), ["Aic Nzega Vijana Choir", "The Hebrews Choir #THC", "Vijana Choir AIC Kiganjo"]);
  });

  it("keeps the bilingual vocabulary reachable", () => {
    // A whitelist with no Kiswahili channels would leave the East African rows
    // permanently empty, which is the most likely way for this pipeline to look
    // broken while reporting success.
    const languages = new Set(CHANNEL_WHITELIST.map((channel) => channel.language));
    assert.ok(languages.has("Kiswahili"), "no Kiswahili channels in the whitelist");
  });

  it("writes the Kiswahili language name one way", () => {
    // "Swahili" and "Kiswahili" are the same language, and a row that renders
    // the wrong one is a bug nobody would notice.
    const variants = CHANNEL_WHITELIST.map((channel) => channel.language).filter((language) => /swahili/i.test(language));
    assert.deepEqual([...new Set(variants)], ["Kiswahili"]);
  });

  it("has enough channels to fill the home page", () => {
    assert.ok(CHANNEL_WHITELIST.length >= 20, `only ${CHANNEL_WHITELIST.length} channels whitelisted`);
  });

  it("summarises to a count that matches the list", () => {
    const summary = summariseByFocus(CHANNEL_WHITELIST);
    const total = Object.values(summary).reduce((sum, value) => sum + value, 0);
    assert.equal(total, CHANNEL_WHITELIST.length);
    assert.equal(Object.keys(summary).length, 3, "music, preaching and mixed");
  });
});

describe("parseIsoDuration", () => {
  it("reads the forms YouTube actually returns", () => {
    assert.equal(parseIsoDuration("PT4M13S"), 253);
    assert.equal(parseIsoDuration("PT1H2M3S"), 3723);
    assert.equal(parseIsoDuration("PT45S"), 45);
    assert.equal(parseIsoDuration("PT1M0S"), 60);
  });

  it("returns 0 for a live stream, which is the caller's cue to skip it", () => {
    // A broadcast reports PT0S, and a two-hour live service must not be filed
    // as a two-hour hymn.
    assert.equal(parseIsoDuration("PT0S"), 0);
    assert.equal(parseIsoDuration(""), 0);
    assert.equal(parseIsoDuration(null), 0);
    assert.equal(parseIsoDuration(undefined), 0);
  });
});
