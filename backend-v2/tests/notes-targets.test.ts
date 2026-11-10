/**
 * What a note can point at.
 *
 * The reader takes a note beside a verse, so the library has to be able to turn
 * the id the reader is already holding back into a title. That id is a string
 * that has to be taken apart: `v-{version}-{bookId}-{chapter}-{verse}`, where
 * the book id is itself `bk-{version}-{bookNumber}`. Every segment is
 * dash-separated and the version and book both contain one, which is exactly
 * the kind of format a lazy regex gets wrong — silently returning the wrong
 * book, or the right one for the wrong version.
 *
 * `assertItemExists` refuses anything it cannot resolve, so a mis-parse does not
 * throw loudly on the way in; it makes a note that saves and then cannot be
 * shown against anything. These assertions are on the parse, because the parse
 * is where the silence lives.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseVerseId } from "../src/modules/bible/service.ts";

describe("a verse id is read back into its parts", () => {
  it("reads the id listChapter mints", () => {
    assert.deepEqual(parseVerseId("v-eng_kjv-bk-eng_kjv-43-3-16"), {
      versionId: "eng_kjv",
      bookId: "bk-eng_kjv-43",
      chapter: 3,
      verse: 16,
    });
  });

  it("keeps the book's own dashes with the book, not the version", () => {
    // The trap: a greedy or eager split puts `43` in the book and leaves the
    // version holding `bk-eng_kjv`, which resolves to a different book or none.
    const parsed = parseVerseId("v-ewe_bib-bk-ewe_bib-43-1-1");
    assert.equal(parsed?.versionId, "ewe_bib");
    assert.equal(parsed?.bookId, "bk-ewe_bib-43");
    assert.equal(parsed?.bookId.startsWith("bk-"), true);
  });

  it("handles a two-digit chapter and a three-digit verse", () => {
    const parsed = parseVerseId("v-eng_kjv-bk-eng_kjv-24-119-176");
    assert.equal(parsed?.chapter, 119);
    assert.equal(parsed?.verse, 176);
  });

  it("refuses anything that is not shaped like a verse id", () => {
    for (const id of [
      "",
      "43",
      "eng_kjv-bk-eng_kjv-43-3-16", // missing the v- prefix
      "v-eng_kjv-bk-eng_kjv-43-three-16", // not a number
      "bible",
    ]) {
      assert.equal(parseVerseId(id), null, `${id} should not parse as a verse`);
    }
  });

  it("parses a verse that cannot exist, and leaves the refusal to the lookup", () => {
    // `readChapter(...)[0 - 1]` would quietly return the final verse of the
    // chapter, filing the note against the wrong words. The parse says nothing
    // about whether the verse is there, so the check has to be at the read —
    // which is what `findVerseById` does by returning null on `undefined`.
    assert.deepEqual(parseVerseId("v-eng_kjv-bk-eng_kjv-43-3-0"), {
      versionId: "eng_kjv",
      bookId: "bk-eng_kjv-43",
      chapter: 3,
      verse: 0,
    });
  });

  it("does not mistake a truncated book id for a whole one", () => {
    // `bk-eng_kjv` with no book number is a different string from
    // `bk-eng_kjv-43`; the parse hands it on and the lookup declines it.
    assert.equal(parseVerseId("v-eng_kjv-bk-eng_kjv-3-16")?.bookId, "bk-eng_kjv");
  });
});
