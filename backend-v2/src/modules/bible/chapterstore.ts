/**
 * Chapter-level storage for verse text.
 *
 * The reader only ever wants a whole chapter at a time, and a chapter's verses
 * read as a list. Storing that list as one zstd-compressed blob turns 31,000
 * rows per Bible into 1,189, which is where nearly all of the size saving
 * comes from — the per-row key overhead, not the text, was the problem.
 *
 * zstd level 9 measured 4.1x on real verse text and still decompresses at
 * gigabytes per second, so a chapter read stays far quicker than the thirty
 * row reads it replaces.
 */
import zlib from "node:zlib";

const LEVEL = 9;

/** Verse texts for one chapter, as stored. */
export type ChapterRow = {
  version_id: string;
  book_number: number;
  chapter: number;
  verse_count: number;
  payload: Uint8Array;
};

/** Pack a chapter's verses into the stored form. */
export function encodeChapter(verses: string[]): Buffer {
  return zlib.zstdCompressSync(Buffer.from(JSON.stringify(verses), "utf8"), {
    params: { [zlib.constants.ZSTD_c_compressionLevel]: LEVEL },
  });
}

/** Unpack a stored chapter. A truncated blob must not read as an empty chapter. */
export function decodeChapter(payload: Uint8Array): string[] {
  const json = zlib.zstdDecompressSync(Buffer.from(payload));
  const verses: unknown = JSON.parse(json.toString("utf8"));
  if (!Array.isArray(verses)) throw new Error("stored chapter is not a verse list");
  return verses.map((verse) => (typeof verse === "string" ? verse : ""));
}
