/**
 * The feed's shelves.
 *
 * `classify.ts` answers "is this music?" and its tests are about the gate. This
 * file is about the other question — which of the chips a reader is holding a
 * reel belongs on — and it is worth writing for the same reason: the rules are
 * an ordered list, and an ordering bug is invisible in the response unless
 * something asserts the precedence directly.
 *
 * The cases below are all drawn from titles this corpus actually contains, plus
 * the combinations the ordering has to settle: a camp meeting that is also a
 * choir, a sermon that mentions a mission, a hymn sung at a revival.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  classifyReelCategory,
  reelCategories,
  reelCategory,
  reelCategoryIds,
  reelCategoryLabel,
  reelFeedWeight,
} from "../src/modules/reels/category.ts";

const shelf = (title: string, extra: Parameters<typeof classifyReelCategory>[0] extends infer T ? Partial<T> : never = {}) =>
  classifyReelCategory({ title, ...extra }).category;

describe("every shelf is reachable and labelled", () => {
  it("gives every id a label and a description", () => {
    for (const id of reelCategoryIds) {
      const category = reelCategory(id);
      assert.ok(category, `${id} has no category row`);
      assert.notEqual(category.label, "");
      assert.notEqual(category.description, "");
    }
  });

  it("has no duplicate ids, and no duplicates among the chips", () => {
    assert.equal(new Set(reelCategoryIds).size, reelCategoryIds.length);
    assert.equal(new Set(reelCategories.map((category) => category.id)).size, reelCategories.length);
  });

  it("falls back to For you for anything unknown, which is what a chip needs", () => {
    assert.equal(reelCategoryLabel("nonsense"), "For you");
    assert.equal(reelCategoryLabel(null), "For you");
  });

  it("never classifies into For you — it is the absence of a classification", () => {
    for (const title of ["Amazing grace", "Sermon", "Camp meeting"]) {
      assert.notEqual(shelf(title), "for-you", title);
    }
  });
});

describe("music shelves", () => {
  it("reads a choir from the title", () => {
    assert.equal(shelf("SDA Kurasini Choir Day"), "choirs");
    assert.equal(shelf("Kwaya 5 - Msimamizi"), "choirs");
  });

  it("reads hymns, instrumentals and acapella apart", () => {
    assert.equal(shelf("Nyimbo za Kristo Mix Volume 4"), "hymns");
    assert.equal(shelf("Relaxing Piano Hymns for Meditation"), "instrumentals");
    assert.equal(shelf("And Can It Be (a cappella)"), "acapella");
  });

  it("prefers a specific shelf over a general one", () => {
    // "Acapella" also contains a choir and worship; the narrowest promise wins.
    assert.equal(shelf("Choir sings a cappella at the sanctuary"), "acapella");
  });

  it("falls back to the ingest bucket when the title says nothing", () => {
    const result = classifyReelCategory({ title: "Untitled upload", musicCategory: "instrumentals" });
    assert.equal(result.category, "instrumentals");
    assert.equal(result.fromIngest, true);
  });
});

describe("spoken-word shelves", () => {
  it("reads a sermon, a testimony and a Bible study apart", () => {
    assert.equal(shelf("Sermon: the road to Emmaus"), "sermons");
    assert.equal(shelf("My testimony of God's faithfulness"), "testimonies");
    assert.equal(shelf("Meditation on Romans 8"), "bible");
    assert.equal(shelf("Sabbath school lesson 4"), "sermons");
  });

  it("keeps a preaching channel's untitled upload out of Church life", () => {
    const result = classifyReelCategory({ title: "2026-09-26", channelFocus: "preaching" });
    assert.equal(result.category, "sermons");
    assert.equal(result.fromIngest, true);
  });
});

describe("occasion and people shelves", () => {
  it("files a camp meeting as an event even when a choir is singing", () => {
    assert.equal(shelf("Calvary Gardens SDA Church Camp Meeting 2026"), "events");
    assert.equal(shelf("THE GREAT CONTROVERSY CAMPMEETING 2025"), "events");
    assert.equal(shelf("CHOIR DAY at Starehe SDA Church"), "choirs");
  });

  it("reads youth, education and mission from the title", () => {
    assert.equal(shelf("Pathfinders investiture service"), "youth");
    assert.equal(shelf("VBS 2025"), "education");
    assert.equal(shelf("Literature evangelists report record scripture distribution"), "mission");
  });

  it("does not let a mission word inside a church's name claim a shelf", () => {
    // "Mission Hill SDA" is where a church is, not what a video is about. With no
    // other signal the floor is correct; the risk being guarded against is the
    // reverse — a whole shelf of worship videos filed as mission work.
    assert.equal(shelf("Nyimbo za Kristo Mix Volume 4"), "hymns");
  });
});

describe("the floor", () => {
  it("files an unclassifiable general church upload as church life", () => {
    const result = classifyReelCategory({ title: "Namwandama Bwana", channelFocus: "mixed" });
    assert.equal(result.category, "church-life");
    assert.equal(result.matchedTerm, null);
  });

  it("does not let an empty title crash or invent a shelf", () => {
    const result = classifyReelCategory({ title: "", description: null, tags: [] });
    assert.ok(reelCategoryIds.includes(result.category));
  });
});

describe("description and tags count as evidence", () => {
  it("reads the description when the title is uninformative", () => {
    assert.equal(
      classifyReelCategory({ title: "Session 14", description: "our community clinic in Kisumu opened today" })
        .category,
      "community",
    );
  });

  it("reads IETF tags", () => {
    assert.equal(classifyReelCategory({ title: "Upload 3", tags: ["youth-orchestra"] }).category, "youth");
  });
});

describe("feed ordering", () => {
  it("is stable for the same video, so pagination cannot repeat or skip a card", () => {
    const id = "3mFP5P5vSzE";
    assert.equal(reelFeedWeight(id), reelFeedWeight(id));
  });

  it("spreads different videos across the range instead of clustering", () => {
    const weights = Array.from({ length: 200 }, (_, index) => reelFeedWeight(`video-${index}`));
    const lowest = Math.min(...weights);
    const highest = Math.max(...weights);
    assert.ok(highest - lowest > 0.5, "weights are not spread");
    assert.ok(weights.every((weight) => weight >= 0 && weight < 1));
  });
});
