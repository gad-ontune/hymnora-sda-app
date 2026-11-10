/**
 * Completeness rules for onboarding a Bible translation.
 *
 * HelloAO publishes 1,256 "translations", but only 195 of them are whole
 * Bibles. The rest are New Testament only (27 books), partial extracts, or
 * single-book samples. Shipping one of those into the reader as though it
 * were a Bible produces passages that simply stop mid-canon, so a translation
 * is only onboarded when it passes every check below.
 *
 * Sixty-six books is the definition of "complete" and is checked as an exact
 * equality. Chapter and verse totals are *bounds, not equalities*, and the
 * reason is versification.
 *
 * "1,189 chapters" is the King James skeleton's count, not a property of the
 * text. Translations that follow a different chapter division disagree with it
 * while being every bit as complete: the Douay-Rheims and the Vulgate run to
 * 1,197, the Orthodox Jewish Bible and the Hausa Biblica 1,190, the Korean and
 * Romanian texts 1,188. Demanding 1,189 exactly rejected the Hausa Bible — a
 * whole Bible, in a major SDA language — for carrying one chapter more than
 * the English KJV. So the chapter count is held to a band wide enough for
 * every real versification and narrow enough that a truncated download still
 * fails. Ditto verses: a genuine translation runs from ~29,100 (the Open
 * Nueva Biblia Viva) to ~31,400, and the band is sized to those.
 *
 * The 66-book gate is what actually separates a Bible from a New Testament
 * extract, and it stays strict.
 */

import type { HelloAOTranslation } from "./external.ts";

/** Books in a complete Bible. */
export const REQUIRED_BOOKS = 66;

/**
 * The King James skeleton's chapter count, kept as the reader's reference
 * shape and for the 1,189-chapter cross-check. It is deliberately *not* used
 * to reject a translation — see the note at the top of this file.
 */
export const REQUIRED_CHAPTERS = 1189;

/**
 * Bounds a translation's chapter count must fall inside.
 *
 * Every 66-book translation upstream sits between 1,188 and 1,197 chapters.
 * The band is wider than that on both sides so a legitimate versification is
 * never refused, but far tighter than the truncated payloads it exists to
 * catch — a partial download lands at 954 or 769 chapters, not at 1,150.
 */
export const MIN_PLAUSIBLE_CHAPTERS = 1_150;
export const MAX_PLAUSIBLE_CHAPTERS = 1_260;

/**
 * Loose bounds on the verse count. The real range upstream is 30,640 (a
 * translator's draft) to 31,445, and complete non-KJV versifications reach
 * down to ~29,100, so these are deliberately wide — they exist
 * to catch a truncated or empty download, not to adjudicate versification.
 */
export const MIN_PLAUSIBLE_VERSES = 28_500;
export const MAX_PLAUSIBLE_VERSES = 32_000;

/**
 * How many blank verses a Bible may carry and still be onboarded.
 *
 * Blank verses are not evidence of a broken download. They are ordinary
 * typesetting gaps — the World English Bible, a wholly unremarkable
 * translation, carries exactly five, all at the end of sections, for a total
 * of 0.016% of its text. Rejecting a 31,000-verse Bible over five blank slots
 * would be the wrong trade, so a handful is tolerated and merely reported.
 *
 * The ceiling exists for the opposite case: a payload that is mostly empty is
 * a failed download, whatever its book count says.
 */
export const MAX_EMPTY_VERSE_FRACTION = 0.005;

export type CompletenessFailure =
  | "book-count"
  | "chapter-count-below-floor"
  | "chapter-count-above-ceiling"
  | "verse-count-below-floor"
  | "verse-count-above-ceiling"
  | "verse-count-mismatch"
  | "empty-payload"
  | "empty-verses-excessive"
  | "duplicate-verse"
  | "request-failed";

export type CompletenessResult =
  | { complete: true; books: number; chapters: number; verses: number }
  | { complete: false; reason: CompletenessFailure; detail: string; books: number; chapters: number; verses: number };

/** Soft findings — reported, but not grounds for rejecting a whole Bible. */
export type CompletenessWarnings = { emptyVerses: number; duplicateVerses: number };

type Counts = { books: number; chapters: number; verses: number };

/** Blank verses are reported separately, so the message needs them. */
let lastEmptyVerses = 0;

/** Builds a failure result with its message filled in, so no caller formats twice. */
function fail(reason: CompletenessFailure, counts: Counts, detail = ""): Extract<CompletenessResult, { complete: false }> {
  return { complete: false, reason, detail: detail || explain(reason, counts), ...counts };
}

/** A single human-readable line, used for the console warning. */
export function explain(reason: CompletenessFailure, counts: Counts, detail = ""): string {
  switch (reason) {
    case "book-count":
      return `has ${counts.books} books, expected ${REQUIRED_BOOKS}`;
    case "chapter-count-below-floor":
      return `has ${counts.chapters} chapters, too few for a whole Bible`;
    case "chapter-count-above-ceiling":
      return `has ${counts.chapters} chapters, far more than any versification`;
    case "verse-count-below-floor":
      return `has only ${counts.verses} verses, below the ${MIN_PLAUSIBLE_VERSES} floor for a complete Bible`;
    case "verse-count-above-ceiling":
      return `reports ${counts.verses} verses, above the ${MAX_PLAUSIBLE_VERSES} ceiling`;
    case "verse-count-mismatch":
      return detail || "chapter data disagrees with the catalogue verse total";
    case "empty-payload":
      return "returned no books";
    case "empty-verses-excessive":
      return `${lastEmptyVerses} verses carry no text, more than typesetting gaps account for`;
    case "duplicate-verse":
      return "contains a duplicated verse number";
    case "request-failed":
      return detail || "could not be downloaded";
  }
}

/**
 * Stage one: reject on the catalogue metadata alone, before spending a
 * ~6 MB download on it. This is what keeps the 1,256-entry list down to the
 * 195 that are worth fetching.
 */
/**
 * The shared bounds check. Both the catalogue entry and the downloaded text
 * run through this, so a translation cannot slip past on metadata and then
 * contradict itself in its own chapters.
 */
function checkCounts(books: number, chapters: number, verses: number): CompletenessResult {
  const counts = { books, chapters, verses };

  if (books !== REQUIRED_BOOKS) return fail("book-count", counts);
  if (chapters < MIN_PLAUSIBLE_CHAPTERS) return fail("chapter-count-below-floor", counts);
  if (chapters > MAX_PLAUSIBLE_CHAPTERS) return fail("chapter-count-above-ceiling", counts);
  if (verses < MIN_PLAUSIBLE_VERSES) return fail("verse-count-below-floor", counts);
  if (verses > MAX_PLAUSIBLE_VERSES) return fail("verse-count-above-ceiling", counts);
  return { complete: true, ...counts };
}

export function checkMetadata(translation: HelloAOTranslation): CompletenessResult {
  return checkCounts(
    Number(translation.numberOfBooks ?? 0),
    Number(translation.totalNumberOfChapters ?? 0),
    Number(translation.totalNumberOfVerses ?? 0),
  );
}

/** True when the catalogue metadata alone already disqualifies a translation. */
export function isCompleteByMetadata(translation: HelloAOTranslation): boolean {
  return checkMetadata(translation).complete;
}

/** Every translation in the catalogue that claims to be a whole Bible. */
export function completeByMetadata(translations: HelloAOTranslation[]): HelloAOTranslation[] {
  return translations.filter(isCompleteByMetadata);
}

// ─── Payload shape ────────────────────────────────────────────────────────────

/**
 * A verse's `content` is an array of either plain strings or, in poetic
 * passages, `{ text, poem }` objects. Both carry the words, so both are
 * unwrapped to text and joined.
 */
export type HelloAOVerseFragment = string | { text?: string; poem?: number; content?: string };

export type HelloAOContentBlock = {
  type?: string;
  number?: number;
  content?: HelloAOVerseFragment[];
};

export type HelloAOChapterPayload = {
  numberOfVerses?: number;
  chapter?: { number?: number; content?: HelloAOContentBlock[] };
};

export type HelloAOBookPayload = {
  id?: string;
  name?: string;
  commonName?: string;
  title?: string;
  order?: number;
  numberOfChapters?: number;
  totalNumberOfVerses?: number;
  chapters?: HelloAOChapterPayload[];
};

export type HelloAOCompletePayload = {
  translation?: HelloAOTranslation;
  books?: HelloAOBookPayload[];
};

/** One stored verse, already reduced to plain text. */
export type ExtractedVerse = { bookNumber: number; book: string; chapter: number; verse: number; text: string };

export type ExtractedBook = {
  bookNumber: number;
  name: string;
  chapterCount: number;
  verseCount: number;
  verses: ExtractedVerse[];
};

/**
 * Flattens a content fragment to its text, dropping the poem wrapper.
 *
 * Verses are stored with their editorial decoration still attached: a leading
 * pilcrow, and quotation marks that belong to the typesetting rather than to
 * the sentence. Those are stripped here so the reader can typeset the verse
 * itself instead of inheriting a print artefact.
 */
function fragmentText(fragment: HelloAOVerseFragment): string {
  const raw = typeof fragment === "string" ? fragment : fragment && typeof fragment === "object" ? fragment.text ?? fragment.content ?? "" : "";
  if (typeof raw !== "string") return "";
  return raw.replace(/^\s*[\u00b6\u2020]\s*/, "").trim();
}

/** Joins a verse's fragments and tidies the whitespace between them. */
function verseText(fragments: HelloAOVerseFragment[] | undefined): string {
  return (fragments ?? []).map(fragmentText).filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

/**
 * Stage two: verify the downloaded text itself, not just the metadata it was
 * advertised with. Counts what is actually present so a truncated or
 * mislabelled download cannot pass on the strength of its catalogue entry.
 */
export function verifyPayload(
  payload: HelloAOCompletePayload,
  advertisedVerses?: number,
): CompletenessResult {
  const books = payload.books ?? [];
  if (books.length === 0) {
    return { complete: false, reason: "empty-payload", detail: "returned no books", books: 0, chapters: 0, verses: 0 };
  }

  let chapters = 0;
  let verses = 0;
  let emptyVerses = 0;
  let duplicateVerses = 0;

  for (const book of books) {
    for (const chapter of book.chapters ?? []) {
      chapters += 1;
      const seen = new Set<number>();
      for (const block of chapter.chapter?.content ?? []) {
        if (block.type !== "verse" || typeof block.number !== "number") continue;
        if (seen.has(block.number)) duplicateVerses += 1;
        seen.add(block.number);
        if (!verseText(block.content)) {
          emptyVerses += 1;
          continue;
        }
        verses += 1;
      }
    }
  }

  const counts = { books: books.length, chapters, verses };
  lastEmptyVerses = emptyVerses;

  const bounded = checkCounts(books.length, chapters, verses);
  if (!bounded.complete) return fail(bounded.reason, counts);
  // A duplicated verse number means the chapter's structure is wrong, and the
  // two verses would collide on the same primary key — so this is fatal.
  if (duplicateVerses > 0) return fail("duplicate-verse", counts);
  // A handful of blanks is normal typesetting; a payload that is mostly blank
  // is a failed download regardless of what the catalogue claimed.
  if (emptyVerses > verses * MAX_EMPTY_VERSE_FRACTION) return fail("empty-verses-excessive", counts);
  // A translation whose own catalogue entry disagrees with its own chapter data
  // is internally inconsistent, so neither number is trusted. Blank verses
  // count towards the catalogue total — upstream counts them as verses, it
  // simply has no text to print for them.
  const slots = verses + emptyVerses;
  if (typeof advertisedVerses === "number" && advertisedVerses > 0 && advertisedVerses !== slots) {
    return fail(
      "verse-count-mismatch",
      counts,
      `chapter data holds ${slots} verse slots but the catalogue claims ${advertisedVerses}` +
        (emptyVerses > 0 ? ` (${emptyVerses} blank)` : ""),
    );
  }
  return { complete: true, ...counts };
}

/** Reshapes a verified payload into rows ready for insertion. */
export function extractBooks(payload: HelloAOCompletePayload): ExtractedBook[] {
  return (payload.books ?? []).map((book) => {
    const verses: ExtractedVerse[] = [];
    const bookNumber = Number(book.order ?? 0);
    const name = book.commonName || book.name || book.title || `Book ${bookNumber}`;
    for (const chapter of book.chapters ?? []) {
      const chapterNumber = Number(chapter.chapter?.number ?? 0);
      for (const block of chapter.chapter?.content ?? []) {
        if (block.type !== "verse" || typeof block.number !== "number") continue;
        const text = verseText(block.content);
        if (!text) continue;
        verses.push({ bookNumber, book: name, chapter: chapterNumber, verse: block.number, text });
      }
    }
    return {
      bookNumber,
      name,
      chapterCount: (book.chapters ?? []).length,
      verseCount: verses.length,
      verses,
    };
  });
}
