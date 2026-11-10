/**
 * The classification gate.
 *
 * These cases are the reason the music page is trustworthy, and they are taken
 * from titles that actually appear on Seventh-day Adventist YouTube channels —
 * including the awkward ones, where a single video mentions both a choir and a
 * sermon and has to land on exactly one side of the divide.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classify, normalizeText, classifierVocabulary } from "../src/modules/youtube/classify.ts";

/** A realistic upload: a title, a boilerplate description, and a real length. */
function upload(title: string, options: { description?: string; focus?: "music" | "preaching" | "mixed"; seconds?: number } = {}) {
  return classify({
    title: normalizeText(title),
    // Deliberately neutral boilerplate: exclude terms in a channel's standard
    // description would otherwise decide the test rather than the title.
    description: options.description ?? "Subscribe for more. Thanks for watching.",
    channelFocus: options.focus ?? "mixed",
    durationSeconds: options.seconds ?? 312,
  });
}

describe("Step A — the exclude filter", () => {
  it("routes a plain sermon to the sermon table", () => {
    const decision = upload("Sermon: The Patience of Job", { focus: "preaching" });
    assert.equal(decision.verdict, "sermon");
    assert.equal(decision.excludedKeyword, "sermon");
    assert.equal(decision.category, null);
  });

  it("routes a Swahili message to the sermon table", () => {
    // "Kwaya" in the description is the pull the Step A rescue exists for, and
    // it must not beat an exclude term found in the title.
    const decision = upload("Hutubani: Umekuwa Mzuri Leo", { focus: "preaching", description: "Kwaya za asubuhi." });
    assert.equal(decision.verdict, "sermon");
    assert.equal(decision.excludedKeyword, "hutubani");
  });

  it("routes an East African sermon signed with a courtesy title to the sermon table", () => {
    // Real Week of Prayer uploads on a division media channel: nothing in the
    // title names a sermon, but "Pr." is the biography of one.
    const decision = upload("EE MUNGU, NAOMBA UNIONGOZE || Pr. David Mmbaga", { focus: "mixed" });
    assert.equal(decision.verdict, "sermon");
    assert.equal(decision.excludedKeyword, "pr.");

    const swahili = upload("JINSI YA KUSIMAMA IMARA || Pst. Amini", { focus: "mixed" });
    assert.equal(swahili.verdict, "sermon");
    assert.equal(swahili.excludedKeyword, "pst.");

    const mch = upload("Uzio wa Kiroho || Mch. Wambua", { focus: "mixed" });
    assert.equal(mch.verdict, "sermon");
    assert.equal(mch.excludedKeyword, "mch.");
  });

  it("does not confuse the \"Pr.\" title with a scripture reference or a suffix", () => {
    // "Rev." is deliberately NOT in the list, because "Rev. 21" in a title is a
    // reference to Revelation, which hymns name constantly. The period-dependent
    // boundaries of these patterns exist exactly so "Pr." cannot fire inside
    // "April" or "Concert Pride".
    const decision = upload("Hymn 108 — April Harmony, Pride of the Choir", { focus: "music" });
    assert.equal(decision.verdict, "music");
  });

  it("routes a Sabbath school lesson away from music, even though it mentions a choir", () => {
    // The exact shape this filter exists for: a general church channel whose
    // lesson title also contains a musical word.
    const decision = upload("Sabbath School Lesson 14 — How the Choir Learned to Sing", { focus: "mixed" });
    assert.equal(decision.verdict, "sermon");
    assert.equal(decision.excludedKeyword, "sabbath school");
  });

  it("keeps a choir video off the sermon table when the word appears in the description", () => {
    const decision = upload("Nyimbo za Kristo — Moyo Wangu", {
      focus: "music",
      description: "Acapella version. Our pastor preached on this one at camp meeting last year.",
    });
    assert.equal(decision.verdict, "music");
    assert.equal(decision.category, "hymns");
  });

  it("still bails a music-only channel when the title itself is spoken word", () => {
    // The rescue in Step A only applies to description-only hits. A music
    // channel that titles a video "Sermon" is either mislabelled or not really
    // a music channel, and neither belongs on the music page.
    const decision = upload("Sermon — What the Choir Sang", { focus: "music" });
    assert.equal(decision.verdict, "sermon");
  });

  it("does not fire on a word that merely contains an exclude term", () => {
    const decision = upload("Hymn 108: He Hideth My Soul in the Hollow of His Hand", { focus: "music" });
    assert.equal(decision.verdict, "music");
  });
});

describe("Step B — the include filter", () => {
  it("rejects a video with no music vocabulary at all", () => {
    const decision = upload("Church Photo Montage 2026", { focus: "mixed" });
    assert.equal(decision.verdict, "skipped");
    assert.equal(decision.category, null);
  });

  it("rejects a sub-minute clip even when the title is unambiguous", () => {
    const decision = upload("Acapella — He Hideth My Soul", { focus: "music", seconds: 22 });
    assert.equal(decision.verdict, "skipped");
    assert.match(decision.reasons.join(" "), /shorter than/);
  });

  it("keeps a video whose duration YouTube has not reported yet", () => {
    const decision = upload("Acapella — He Hideth My Soul", { focus: "music", seconds: 0 });
    assert.equal(decision.verdict, "music");
  });

  it("gives a preaching-only channel the benefit on a video with no music words", () => {
    const decision = upload("The Seventh-day", { focus: "preaching", description: "A message on the true Sabbath." });
    assert.equal(decision.verdict, "sermon");
  });
});

describe("Step C — categorisation", () => {
  const cases: [string, string][] = [
    ["Adventist Choir — Rise, Singers, Rise", "choirs"],
    ["Kwaya ya Imani — Adventist Youth Choir", "choirs"],
    ["Hymn 108 — He Hideth My Soul", "hymns"],
    ["Nyimbo za Kristo No. 45", "hymns"],
    ["Ndudzo ya Mwanga", "hymns"],
    ["Hymns for Piano, No Vocals", "instrumentals"],
    ["Meditation on the Sabbath — Instrumental", "instrumentals"],
    ["Acapella — Now Thank We All Our God", "acapella"],
    ["A Cappella version of Amazing Grace", "acapella"],
  ];

  for (const [title, expected] of cases) {
    it(`files "${title}" under ${expected}`, () => {
      const decision = upload(title, { focus: "music", description: "" });
      assert.equal(decision.verdict, "music");
      assert.equal(decision.category, expected);
    });
  }

  it("lets a title beat a description when the two disagree", () => {
    // "Acapella version of hymn 108" is an acapella piece. The word "hymn" is
    // only naming the source material, so the title must win.
    const decision = upload("Acapella version of Hymn 108", {
      focus: "music",
      description: "A traditional hymn. No vocals in the chorus.",
    });
    assert.equal(decision.category, "acapella");
  });

  it("reports lower confidence when two buckets are nearly tied", () => {
    const clear = upload("Hymn — He Hideth My Soul", { focus: "music", description: "" });
    const ambiguous = upload("Hymn and Choir Concert", { focus: "music", description: "" });
    assert.ok(clear.confidence >= ambiguous.confidence, `${clear.confidence} should be >= ${ambiguous.confidence}`);
  });

  it("records the keyword that carried the video, for the audit trail", () => {
    const decision = upload("Acapella — Now Thank We All Our God", { focus: "music", description: "" });
    assert.equal(decision.matchedKeyword, "acapella");
    assert.ok(decision.tags.includes("acapella"));
  });
});

describe("livestream uploads", () => {
  // Real titles from Kurasini SDA Choir, a genuine music channel, taken from
  // the first live ingest. These are hours-long services that carry a choir's
  // name and the word "kwaya", so Step B's music signals are all present.
  it("sends a livestream of a music channel's own service to sermons, not tracks", () => {
    const decision = upload("🔴 LIVE :MAKAMBI MTAA WA KURASINI 2026 || SIKU YA KWANZA ASUBUHI", {
      focus: "music",
      description: "Jumamosi. Kurasini SDA Choir, Dar es Salaam.",
    });
    assert.equal(decision.verdict, "sermon");
  });

  it("treats 'LIVE' with no other marker as a broadcast too", () => {
    assert.equal(upload("LIVE: Sabatu ya Kwanza — Kwaya za Kwanza", { focus: "music" }).verdict, "sermon");
    assert.equal(upload("Livestream || Evening Worship || Kurasini", { focus: "music" }).verdict, "sermon");
  });

  it("does not mistake a song with 'live' in the title for a broadcast", () => {
    // "live" as an adjective for a performance is normal in choir titles. The
    // broadcast patterns need "livestream" or a "LIVE:" colon to fire, and the
    // music keyword still has to be there for the video to be music at all.
    assert.equal(upload("Kwaya: He Hideth My Soul (Live Recording)", { focus: "music" }).verdict, "music");
    assert.equal(upload("Nyimbo za Upendo", { focus: "music" }).verdict, "music");
    // A title with no music keyword is skipped whatever it is called — that is
    // Step B doing its job, not the broadcast rule misfiring.
    assert.equal(upload("Oceans (Live)", { focus: "music" }).verdict, "skipped");
  });
});

describe("normalisation", () => {
  it("strips emoji, hashtags and pipes so word boundaries hold", () => {
    assert.equal(normalizeText("🎵 Hymn 108 #Adventist | He Hideth My Soul"), "Hymn 108 Adventist He Hideth My Soul");
  });

  it("classifies a title that arrives wrapped in channel branding", () => {
    const decision = upload("🔔 KWAYA | Nyimbo za Kristo — Tumaini 🕊️", { focus: "music", description: "" });
    assert.equal(decision.verdict, "music");
    assert.ok(["choirs", "hymns"].includes(decision.category!));
  });
});

describe("the vocabulary is documented, not implicit", () => {
  it("keeps every term unique", () => {
    const all = [...classifierVocabulary.excludeTerms, ...classifierVocabulary.includeTerms];
    assert.equal(new Set(all).size, all.length, "duplicate keyword in the classifier vocabulary");
  });

  it("holds no term in both lists", () => {
    const exclude = new Set(classifierVocabulary.excludeTerms);
    const overlap = classifierVocabulary.includeTerms.filter((term) => exclude.has(term));
    assert.deepEqual(overlap, [], `a term cannot be both include and exclude: ${overlap.join(", ")}`);
  });
});
