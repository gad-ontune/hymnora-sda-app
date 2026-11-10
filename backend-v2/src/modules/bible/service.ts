import { z } from "zod";
import { all, get, run, placeholders, type Params, type Row } from "../../db/client.ts";
import { notFound, badRequest, unprocessable } from "../../lib/errors.ts";
import {
  MAX_PLAUSIBLE_CHAPTERS,
  MAX_PLAUSIBLE_VERSES,
  MIN_PLAUSIBLE_CHAPTERS,
  MIN_PLAUSIBLE_VERSES,
  REQUIRED_BOOKS,
  REQUIRED_CHAPTERS,
} from "./completeness.ts";
import { canonNumber } from "./canon.ts";
import { decodeChapter } from "./chapterstore.ts";
import { newId } from "../../lib/http.ts";
import type { BibleBook, BibleBookmark, BiblePassage, BibleVerse, BibleVersion } from "../../types/domain.ts";

/**
 * The Bible module is read-mostly: scripture text is licensed per version and is
 * loaded from the KJV corpus rather than authored through the admin API, so only
 * bookmarks (personal, per-user) are writable here.
 */

type VersionRow = Row & {
  id: string;
  name: string;
  language: string;
  language_code: string;
  status: string;
  publisher: string | null;
  year: number | null;
  books_count: number;
  chapters_count: number;
  verses_count: number;
  description: string | null;
};

function toVersion(row: VersionRow): BibleVersion {
  return {
    id: row.id,
    name: row.name,
    label: row.name,
    language: row.language,
    languageCode: row.language_code,
    status: row.status,
    publisher: row.publisher,
    year: row.year === null ? null : Number(row.year),
    booksCount: Number(row.books_count ?? 0),
    chaptersCount: Number(row.chapters_count ?? 0),
    versesCount: Number(row.verses_count ?? 0),
    description: row.description,
  };
}

const versionSelect = `
  v.id, v.name, v.language, v.language_code, v.status, v.publisher, v.year,
  v.books_count, v.chapters_count, v.verses_count, v.description
`;

/** Default version for a request: an explicit `?version=` wins, else KJV. */
export const DEFAULT_VERSION_CODE = "KJV";

export function listVersions(): BibleVersion[] {
  return all<VersionRow>(`SELECT ${versionSelect} FROM bible_versions v ORDER BY v.books_count DESC, v.name`).map(toVersion);
}

export function findVersion(idOrCode: string): BibleVersion {
  const row = resolveVersionRow(idOrCode);
  if (!row) throw notFound("Bible version");
  return toVersion(row);
}

/**
 * Versions are addressed by id in the API but by code ("KJV") in the UI and in
 * `?version=` query params, so both are accepted.
 */
function resolveVersionRow(idOrCode: string): VersionRow | undefined {
  const direct = get<VersionRow>(`SELECT ${versionSelect} FROM bible_versions v WHERE v.id = ?`, [idOrCode]);
  if (direct) return direct;
  const code = idOrCode.replace(/[^A-Za-z]/g, "").toUpperCase();
  return (
    get<VersionRow>(`SELECT ${versionSelect} FROM bible_versions v WHERE v.name LIKE ?`, [`%${code}%`]) ??
    get<VersionRow>(`SELECT ${versionSelect} FROM bible_versions v WHERE v.id = ?`, [DEFAULT_VERSION_CODE.toLowerCase()])
  );
}

/** The version row, falling back to the default when `?version=` is unknown. */
export function versionOrDefault(idOrCode: string | undefined): VersionRow {
  if (idOrCode) {
    const row = resolveVersionRow(idOrCode);
    if (row) return row;
  }
  const fallback = get<VersionRow>(`SELECT ${versionSelect} FROM bible_versions v WHERE v.name LIKE '%KJV%' LIMIT 1`);
  if (fallback) return fallback;
  const any = get<VersionRow>(`SELECT ${versionSelect} FROM bible_versions v ORDER BY books_count DESC LIMIT 1`);
  if (!any) throw notFound("Bible version");
  return any;
}

// ─── Complete versions ────────────────────────────────────────────────────────

/** A whole Bible, ready to read offline. Only ever populated by verified seeds. */
export type CompleteVersion = BibleVersion & { versionKey: string };

/**
 * Versions that are genuinely complete and present locally.
 *
 * `listVersions()` returns whatever is in the table, which on a fresh database
 * is the handful of placeholder rows the base seed creates. The reader's picker
 * uses this instead, so a translation is only offered once the seeder has
 * confirmed all 66 books and a plausible chapter and verse count are actually
 * in the database.
 */
export function listCompleteVersions(): CompleteVersion[] {
  // The verse and book counts come from the stored rows rather than the
  // version's own metadata, so a row that merely *claims* completeness — a stub
  // from the base seed, say — is filtered out instead of opening onto an empty
  // reader.
  const rows = all<VersionRow & { stored_books: number; stored_verses: number }>(
    `SELECT ${versionSelect},
            (SELECT COUNT(*) FROM bible_books b WHERE b.version_id = v.id)  AS stored_books,
            (SELECT COALESCE(SUM(c.verse_count), 0) FROM bible_chapters c WHERE c.version_id = v.id) AS stored_verses
     FROM bible_versions v
     ORDER BY v.language, v.name`,
  );
  return rows
    .filter(
      (row) =>
        Number(row.stored_books) === REQUIRED_BOOKS &&
        Number(row.chapters_count) >= MIN_PLAUSIBLE_CHAPTERS &&
        Number(row.chapters_count) <= MAX_PLAUSIBLE_CHAPTERS &&
        Number(row.stored_verses) >= MIN_PLAUSIBLE_VERSES &&
        Number(row.stored_verses) <= MAX_PLAUSIBLE_VERSES,
    )
    .map((row) => ({
      ...toVersion({ ...row, books_count: Number(row.stored_books), verses_count: Number(row.stored_verses) }),
      versionKey: row.id,
    }));
}

/** Distinct languages among the locally available complete versions. */
export function completeVersionLanguages(): string[] {
  return all<{ language: string }>(
    // The same band the seeder enforces, not the 1,189-chapter skeleton: a
    // version with 1,190 chapters is still a complete Bible and its language
    // belongs in this list.
    `SELECT DISTINCT v.language FROM bible_versions v
     WHERE v.books_count = ? AND v.chapters_count BETWEEN ? AND ?
       AND v.verses_count BETWEEN ? AND ?
     ORDER BY v.language`,
    [REQUIRED_BOOKS, MIN_PLAUSIBLE_CHAPTERS, MAX_PLAUSIBLE_CHAPTERS, MIN_PLAUSIBLE_VERSES, MAX_PLAUSIBLE_VERSES],
  ).map((row) => row.language);
}

export type BibleOverview = {
  versionCount: number;
  languageCount: number;
  bookCount: number;
  /** Chapters summed across the whole library. */
  chapterCount: number;
  /**
   * Chapters in a single translation, as the median across the library.
   *
   * A Bible's own shape is 66 books and ~1,189 chapters, and that is what the
   * card needs to show next to a library-wide verse total. It cannot be a
   * constant, though: the Douay-Rheims runs to 1,197 and the Hausa to 1,190,
   * so the median is taken from what is actually stored.
   */
  chaptersPerVersion: number;
  verseCount: number;
  booksPerVersion: number;
};

/** The middle value of an unsorted list of numbers. */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

/** Totals for the home-page card, counted from the verses actually stored. */
export function bibleOverview(): BibleOverview {
  const versions = listCompleteVersions();
  return {
    versionCount: versions.length,
    languageCount: new Set(versions.map((version) => version.language)).size,
    bookCount: REQUIRED_BOOKS,
    // Counted from the rows, not asserted as 1,189: versions on a different
    // versification carry a different number of chapters and the card should
    // not claim otherwise.
    chapterCount: versions.reduce((total, version) => total + version.chaptersCount, 0),
    chaptersPerVersion: median(versions.map((version) => version.chaptersCount)),
    verseCount: versions.reduce((total, version) => total + version.versesCount, 0),
    booksPerVersion: REQUIRED_BOOKS,
  };
}

// ─── Books ───────────────────────────────────────────────────────────────────

type BookRow = Row & {
  id: string;
  name: string;
  abbreviation: string;
  testament: string;
  book_number: number;
  chapter_count: number;
  verse_count: number;
};

function toBook(row: BookRow): BibleBook {
  return {
    id: row.id,
    name: row.name,
    abbreviation: row.abbreviation,
    testament: row.testament as BibleBook["testament"],
    bookNumber: Number(row.book_number),
    chapterCount: Number(row.chapter_count),
    verseCount: Number(row.verse_count),
  };
}

const bookSelect = "b.id, b.name, b.abbreviation, b.testament, b.book_number, b.chapter_count, b.verse_count";

export function listBooks(versionId: string, testament?: string): BibleBook[] {
  const params: (string | number)[] = [versionId];
  let sql = `SELECT ${bookSelect} FROM bible_books b WHERE b.version_id = ?`;
  if (testament === "Old" || testament === "New") {
    sql += " AND b.testament = ?";
    params.push(testament);
  }
  sql += " ORDER BY b.book_number";
  return all<BookRow>(sql, params).map(toBook);
}

/** Books are addressed by name, abbreviation or id — the reader uses all three. */
export function findBook(versionId: string, nameOrId: string): BibleBook {
  const row =
    get<BookRow>(`SELECT ${bookSelect} FROM bible_books b WHERE b.version_id = ? AND b.id = ?`, [versionId, nameOrId]) ??
    get<BookRow>(`SELECT ${bookSelect} FROM bible_books b WHERE b.version_id = ? AND b.name = ? COLLATE NOCASE`, [versionId, nameOrId]) ??
    get<BookRow>(`SELECT ${bookSelect} FROM bible_books b WHERE b.version_id = ? AND b.abbreviation = ? COLLATE NOCASE`, [versionId, nameOrId]) ??
    // A Kiswahili Bible calls the Gospel of John "Yohane", so a stored-name
    // match alone would make "John 3:16" fail the moment the reader switched
    // language. Translating the English name to a canon position, then looking
    // the position up in this version, makes one reference work everywhere.
    (() => {
      const number = canonNumber(nameOrId);
      return number === undefined
        ? undefined
        : get<BookRow>(`SELECT ${bookSelect} FROM bible_books b WHERE b.version_id = ? AND b.book_number = ?`, [versionId, number]);
    })();
  if (!row) throw notFound("Bible book");
  return toBook(row);
}

// ─── Verses & chapters ───────────────────────────────────────────────────────

type VerseRow = Row & {
  id: string;
  book_id: string;
  book: string;
  chapter: number;
  verse: number;
  text: string;
  abbreviation: string | null;
};

function toVerse(row: VerseRow): BibleVerse {
  return {
    id: row.id,
    book: row.book,
    bookAbbreviation: row.abbreviation ?? row.book.slice(0, 3),
    chapter: Number(row.chapter),
    verse: Number(row.verse),
    text: row.text,
  };
}

const verseSelect = "v.id, v.book_id, v.book, v.chapter, v.verse, v.text, b.abbreviation AS abbreviation";

/**
 * Every verse of one chapter, from the compressed store.
 *
 * A chapter is a single row holding a zstd-compressed array of verse strings,
 * so a chapter read is one row fetch and one decompress rather than thirty
 * indexed lookups.
 */
function readChapter(versionId: string, bookNumber: number, chapter: number): string[] {
  const row = get<{ payload: Uint8Array }>(
    "SELECT payload FROM bible_chapters WHERE version_id = ? AND book_number = ? AND chapter = ?",
    [versionId, bookNumber, chapter],
  );
  return row ? decodeChapter(row.payload) : [];
}

/**
 * Walk every chapter of a version in canon order.
 *
 * Search and the library's existence check need to look at text the compressed
 * store deliberately cannot index, so they decompress chapter by chapter and
 * stop as soon as the caller's limit is met. That is a full scan in the worst
 * case, which is the price of not keeping 700 MB of duplicated verse rows
 * around to index — and both callers are interactive, not hot paths.
 */
function scanVersion(
  versionId: string,
  visit: (chapter: { bookNumber: number; chapter: number; verses: string[] }) => boolean,
): void {
  const rows = all<{ book_number: number; chapter: number; payload: Uint8Array }>(
    "SELECT book_number, chapter, payload FROM bible_chapters WHERE version_id = ? ORDER BY book_number, chapter",
    [versionId],
  );
  for (const row of rows) {
    if (!visit({ bookNumber: Number(row.book_number), chapter: Number(row.chapter), verses: decodeChapter(row.payload) })) {
      return;
    }
  }
}

/** Chapters a book actually holds, for the reader's chapter controls. */
function chapterNumbers(versionId: string, bookNumber: number): number[] {
  return all<{ chapter: number }>(
    "SELECT chapter FROM bible_chapters WHERE version_id = ? AND book_number = ? ORDER BY chapter",
    [versionId, bookNumber],
  ).map((row) => Number(row.chapter));
}

/** Every verse in a chapter, ordered canonically. */
export function listChapter(versionId: string, bookName: string, chapter: number): BibleVerse[] {
  const book = findBook(versionId, bookName);
  return readChapter(versionId, book.bookNumber, chapter).map((text, index) => ({
    id: `v-${versionId}-${book.id}-${chapter}-${index + 1}`,
    book: book.name,
    bookAbbreviation: book.abbreviation,
    chapter,
    verse: index + 1,
    text,
  }));
}

/**
 * The parts of a verse id: `v-{versionId}-{bookId}-{chapter}-{verse}`, where the
 * book id is itself `bk-{versionId}-{bookNumber}`.
 *
 * The library points notes and favourites at content by id, and a note taken
 * beside John 3:16 has to survive the reader switching translation or chapter —
 * the id is the only handle that does. Parsing it here, as data, is what lets
 * the note find the verse again without the caller re-deriving the format.
 */
export function parseVerseId(id: string): { versionId: string; bookId: string; chapter: number; verse: number } | null {
  const parts = /^v-(.+?)-(bk-.+?)-(\d+)-(\d+)$/.exec(id);
  if (!parts) return null;
  return {
    versionId: parts[1],
    bookId: parts[2],
    chapter: Number(parts[3]),
    verse: Number(parts[4]),
  };
}

/**
 * A verse looked up by the id the reader already has.
 *
 * Returns null rather than throwing: a note whose verse has gone should read as
 * "unavailable" in the library, not fail the whole request. The text comes from
 * the compressed chapter store, because that is where the reader's own
 * translation lives — a note on John 3:16 in the KJV and one in the Kiswahili
 * are different notes about the same verse.
 */
export function findVerseById(id: string): BibleVerse | null {
  const parsed = parseVerseId(id);
  if (!parsed) return null;
  const book = findBook(parsed.versionId, parsed.bookId);
  const text = readChapter(parsed.versionId, book.bookNumber, parsed.chapter)[parsed.verse - 1];
  if (text === undefined) return null;
  return {
    id,
    book: book.name,
    bookAbbreviation: book.abbreviation,
    chapter: parsed.chapter,
    verse: parsed.verse,
    text,
  };
}

/** A book by its own id, for the same reason: the reader's place, not a query. */
export function findBookById(id: string): BibleBook | null {
  const row = get<BookRow>(`SELECT ${bookSelect} FROM bible_books b WHERE b.id = ?`, [id]);
  return row ? toBook(row) : null;
}

/** Chapter numbers that actually hold verses — lets the reader skip empty ones. */
export function listChapterNumbers(versionId: string, bookName: string): number[] {
  const book = findBook(versionId, bookName);
  return chapterNumbers(versionId, book.bookNumber);
}

/**
 * A passage spans `chapter:verse` to `chapter:verse`, and may cross chapter
 * boundaries — `"John 3:16-17"` and `"John 3:16-4:2"` are both valid input, so
 * the range is resolved as a (chapter, verse) tuple comparison rather than by
 * arithmetic on the verse number alone.
 */
export function findPassage(versionId: string, reference: string): BiblePassage {
  const parsed = parseReference(reference);
  const version = toVersion(versionRowById(versionId));
  const book = findBook(versionId, parsed.book);
  // The reference can span chapters, so each chapter in the range is read whole
  // and then trimmed to the verses actually asked for.
  const rows: BibleVerse[] = [];
  for (let chapter = parsed.startChapter; chapter <= parsed.endChapter; chapter += 1) {
    const verses = readChapter(versionId, book.bookNumber, chapter);
    const from = chapter === parsed.startChapter ? parsed.startVerse : 1;
    const to = chapter === parsed.endChapter ? parsed.endVerse : verses.length;
    for (let verse = from; verse <= to && verse <= verses.length; verse += 1) {
      rows.push({
        id: `v-${versionId}-${book.id}-${chapter}-${verse}`,
        book: book.name,
        bookAbbreviation: book.abbreviation,
        chapter,
        verse,
        text: verses[verse - 1],
      });
    }
  }
  if (rows.length === 0) {
    throw notFound(`Passage "${reference}"`);
  }
  const verses = rows;
  return {
    version,
    reference,
    book: book.name,
    chapter: parsed.startChapter,
    verses,
    text: verses.map((verse) => verse.text).join(" "),
    verseCount: verses.length,
  };
}

function versionRowById(id: string): VersionRow {
  const row = get<VersionRow>(`SELECT ${versionSelect} FROM bible_versions v WHERE v.id = ?`, [id]);
  if (!row) throw notFound("Bible version");
  return row;
}

export type ParsedReference = {
  book: string;
  startChapter: number;
  startVerse: number;
  endChapter: number;
  endVerse: number;
};

/** Parses `"John 3"`, `"John 3:16"`, `"John 3:16-17"` and `"John 3:16-4:2"`. */
export function parseReference(reference: string): ParsedReference {
  const cleaned = reference.trim().replace(/\s+/g, " ");
  const match = /^(.+?)\s+(\d+)(?::(\d+))?(?:\s*[-–]\s*(?:(\d+):)?(\d+))?$/.exec(cleaned);
  if (!match) throw badRequest(`"${reference}" is not a valid scripture reference`);
  const [, book, chapterText, verseText, endChapterText, endVerseText] = match;
  const startChapter = Number(chapterText);
  const startVerse = verseText ? Number(verseText) : 1;
  const endChapter = endChapterText ? Number(endChapterText) : startChapter;
  const endVerse = endVerseText ? Number(endVerseText) : startVerse;
  if (startVerse < 1 || endVerse < 1) throw badRequest("Verse numbers start at 1");
  if (endChapter < startChapter || (endChapter === startChapter && endVerse < startVerse)) {
    throw badRequest(`"${reference}" ends before it starts`);
  }
  return { book: book!, startChapter, startVerse, endChapter, endVerse };
}

/** Free-text search across verse text, scoped to one version. */
export function searchVerses(versionId: string, term: string, limit = 50): BibleVerse[] {
  const needle = term.trim().toLowerCase();
  if (needle === "") return [];
  const cap = Math.min(200, Math.max(1, limit));
  const found: BibleVerse[] = [];
  const book = get<BibleBook>("SELECT name, abbreviation FROM bible_books WHERE version_id = ? AND book_number = 1", [versionId]);

  scanVersion(versionId, ({ bookNumber, chapter, verses }) => {
    for (let index = 0; index < verses.length; index += 1) {
      const text = verses[index]!;
      if (!text.toLowerCase().includes(needle)) continue;
      found.push({
        id: `v-${versionId}-${bookNumber}-${chapter}-${index + 1}`,
        book: book?.name ?? String(bookNumber),
        bookAbbreviation: book?.abbreviation ?? String(bookNumber).slice(0, 3),
        chapter,
        verse: index + 1,
        text,
      });
      if (found.length >= cap) return false;
    }
    return true;
  });
  return found;
}

/** Every distinct version that has text for a book — powers the version picker. */
export function versionsForBook(bookName: string): BibleVersion[] {
  // Book names are stored per translation — Hausa calls John "Yohanna",
  // Kiswahili "Yohane" — so matching on the requested string would only ever
  // find the English versions. Resolve to the canon number first, then compare
  // numbers, which every translation agrees on.
  const number = canonNumber(bookName);
  const params: Params = [];
  let where: string;
  if (number === undefined) {
    // Not an English book name, so it can only be a local one. Compare against
    // every book's stored name.
    where = "b.name = ? COLLATE NOCASE";
    params.push(bookName);
  } else {
    where = "b.book_number = ?";
    params.push(number);
  }
  const rows = all<VersionRow & { total: number }>(
    `SELECT DISTINCT ${versionSelect},
            (SELECT COALESCE(SUM(c.verse_count), 0) FROM bible_chapters c WHERE c.version_id = v.id) AS total
     FROM bible_versions v
     JOIN bible_books b ON b.version_id = v.id
     WHERE ${where}
       AND EXISTS (SELECT 1 FROM bible_chapters c WHERE c.version_id = v.id)
     ORDER BY total DESC`,
    params,
  );
  return rows.map(toVersion);
}

// ─── Spotlight ────────────────────────────────────────────────────────────────

/** A verse plus enough context to attribute it on a card. */
export type SpotlightVerse = {
  id: string;
  reference: string;
  text: string;
  versionId: string;
  versionName: string;
  language: string;
  languageCode: string;
};

export type SpotlightEntry = SpotlightVerse & { dayOfYear: number };

/**
 * Passages the home page cycles through, drawn from the versions actually
 * stored locally. The book names are the KJV ones, so the same reference
 * resolves in every translation that is onboarded.
 */
const SPOTLIGHT_REFERENCES = [
  "John 3:16", "Psalm 23:1", "Isaiah 40:31", "Proverbs 3:5", "Romans 12:2", "Philippians 4:13",
  "Micah 6:8", "Matthew 11:28", "Psalm 46:1", "John 1:14", "2 Timothy 3:16", "Lamentations 3:23",
] as const;

/**
 * One verse per reference, spread across the available versions so the card
 * shows more than one translation over time. Returns an empty list when no
 * complete version is onboarded, rather than falling back to invented text.
 */
export function spotlightVerses(term?: string, limit = 6): SpotlightEntry[] {
  const versions = listCompleteVersions();
  if (versions.length === 0) return [];

  const picks: SpotlightEntry[] = [];
  const dayOfYear = Math.floor(
    (Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86_400_000,
  );

  if (term) {
    // A search narrows to passages that mention the term, newest versions first.
    for (const version of versions) {
      for (const row of searchVerses(version.id, term, 4)) {
        picks.push(toSpotlight(row, version, dayOfYear));
      }
      if (picks.length >= limit) break;
    }
    return picks.slice(0, limit);
  }

  // Rotate the starting point by day so consecutive days lead with a different
  // passage, and walk the version list per pick so the languages vary.
  const start = dayOfYear % SPOTLIGHT_REFERENCES.length;
  for (let index = 0; index < SPOTLIGHT_REFERENCES.length && picks.length < limit; index += 1) {
    const reference = SPOTLIGHT_REFERENCES[(start + index) % SPOTLIGHT_REFERENCES.length]!;
    const version = versions[index % versions.length]!;
    try {
      const passage = findPassage(version.id, reference);
      const first = passage.verses[0];
      if (!first) continue;
      picks.push({
        id: first.id,
        reference: passage.reference,
        text: first.text,
        versionId: version.id,
        versionName: version.label,
        language: version.language,
        languageCode: version.languageCode,
        dayOfYear,
      });
    } catch {
      // A version missing this book simply is not used for this pick.
    }
  }
  return picks;
}

function toSpotlight(verse: BibleVerse, version: BibleVersion, dayOfYear: number): SpotlightEntry {
  return {
    id: verse.id,
    reference: `${verse.book} ${verse.chapter}:${verse.verse}`,
    text: verse.text,
    versionId: version.id,
    versionName: version.label,
    language: version.language,
    languageCode: version.languageCode,
    dayOfYear,
  };
}

// ─── Bookmarks ───────────────────────────────────────────────────────────────

type BookmarkRow = Row & {
  id: string;
  version_id: string;
  book: string;
  chapter: number;
  verse: number;
  text: string;
  highlight_color: string | null;
  note: string | null;
  created_at: string;
};

function toBookmark(row: BookmarkRow): BibleBookmark {
  return {
    id: row.id,
    versionId: row.version_id,
    reference: `${row.book} ${row.chapter}:${row.verse}`,
    book: row.book,
    chapter: Number(row.chapter),
    verse: Number(row.verse),
    text: row.text,
    highlightColor: row.highlight_color,
    note: row.note,
    createdAt: row.created_at,
  };
}

export function listBookmarks(userId: string): BibleBookmark[] {
  return all<BookmarkRow>(
    `SELECT id, version_id, book, chapter, verse, text, highlight_color, note, created_at
     FROM bible_bookmarks WHERE user_id = ? ORDER BY created_at DESC`,
    [userId],
  ).map(toBookmark);
}

export const bookmarkInputSchema = z.object({
  versionId: z.string().trim().max(120).min(1),
  book: z.string().trim().min(1).max(80),
  chapter: z.number().int().min(1).max(200),
  verse: z.number().int().min(1).max(1000),
  text: z.string().max(8000).default(""),
  highlightColor: z.string().trim().max(40).nullable().optional(),
  note: z.string().max(8000).nullable().optional(),
});

export type BookmarkInput = z.output<typeof bookmarkInputSchema>;

/** Returns the existing bookmark id when the verse is already saved. */
export function createBookmark(userId: string, input: BookmarkInput): BibleBookmark {
  const id = newId();
  run(
    `INSERT INTO bible_bookmarks (id, user_id, version_id, book, chapter, verse, text, highlight_color, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, version_id, book, chapter, verse) DO UPDATE SET
       text = excluded.text, highlight_color = excluded.highlight_color, note = excluded.note`,
    [id, userId, input.versionId, input.book, input.chapter, input.verse, input.text, input.highlightColor ?? null, input.note ?? null],
  );
  const row = get<BookmarkRow>(
    `SELECT id, version_id, book, chapter, verse, text, highlight_color, note, created_at
     FROM bible_bookmarks WHERE user_id = ? AND version_id = ? AND book = ? AND chapter = ? AND verse = ?`,
    [userId, input.versionId, input.book, input.chapter, input.verse],
  );
  if (!row) throw unprocessable("Could not save the bookmark");
  return toBookmark(row);
}

export function updateBookmark(userId: string, id: string, input: Partial<BookmarkInput>): BibleBookmark {
  const existing = get<BookmarkRow>(
    "SELECT id, version_id, book, chapter, verse, text, highlight_color, note, created_at FROM bible_bookmarks WHERE id = ? AND user_id = ?",
    [id, userId],
  );
  if (!existing) throw notFound("Bookmark");
  run("UPDATE bible_bookmarks SET highlight_color = ?, note = ?, text = ? WHERE id = ? AND user_id = ?", [
    input.highlightColor === undefined ? existing.highlight_color : input.highlightColor,
    input.note === undefined ? existing.note : input.note,
    input.text === undefined ? existing.text : input.text,
    id,
    userId,
  ]);
  const row = get<BookmarkRow>(
    "SELECT id, version_id, book, chapter, verse, text, highlight_color, note, created_at FROM bible_bookmarks WHERE id = ? AND user_id = ?",
    [id, userId],
  );
  return toBookmark(row!);
}

export function deleteBookmark(userId: string, id: string): void {
  const result = run("DELETE FROM bible_bookmarks WHERE id = ? AND user_id = ?", [id, userId]);
  if (result.changes === 0) throw notFound("Bookmark");
}

/** Ids of the verses a user has bookmarked — lets the reader show a flag inline. */
export function bookmarkedKeys(userId: string, versionId: string): Set<string> {
  const rows = all<{ book: string; chapter: number; verse: number }>(
    "SELECT book, chapter, verse FROM bible_bookmarks WHERE user_id = ? AND version_id = ?",
    [userId, versionId],
  );
  return new Set(rows.map((row) => `${row.book} ${row.chapter}:${row.verse}`));
}

/** Bulk existence check used by the library to hydrate a page of items at once. */
export function verseKeysExist(versionId: string, keys: string[]): Set<string> {
  const found = new Set<string>();
  if (keys.length === 0) return found;

  // Text lives in chapter blobs, so group the requested keys by chapter and
  // read each blob once. A page of library items usually spans a handful of
  // chapters, which keeps this to a few decompressions rather than one per key.
  type Group = { book: string; number: number; chapter: number; verses: number[] };
  const byChapter = new Map<string, Group>();
  for (const key of keys) {
    const match = /^(.*\S)\s+(\d+):(\d+)$/.exec(key);
    if (!match) continue;
    const [, book, chapter, verse] = match;
    const number = canonNumber(book);
    if (number === undefined) continue;
    const group = byChapter.get(`${number}:${chapter}`) ?? { book, number, chapter: Number(chapter), verses: [] };
    group.verses.push(Number(verse));
    byChapter.set(`${number}:${chapter}`, group);
  }

  for (const group of byChapter.values()) {
    const text = readChapter(versionId, group.number, group.chapter);
    for (const verse of group.verses) {
      if (verse >= 1 && verse <= text.length) found.add(`${group.book} ${group.chapter}:${verse}`);
    }
  }
  return found;
}
