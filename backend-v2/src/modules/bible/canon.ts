/**
 * The 66 books in canonical order, with their KJV English names.
 *
 * Translations name their books in the language they are written in, so
 * "Yohane" for John, "Mwanzo" for Genesis. A reader that only understood the
 * stored name would break the moment someone opened a Swahili Bible and asked
 * for John 3:16 — the reference everyone actually types.
 *
 * The canon fixes that: every translation keeps its own book order, and
 * position 43 in any language is the Gospel of John. English references are
 * therefore resolved to a book *number* first, then looked up per version, so
 * "John 3:16" finds Yohane in Kiswahili, Yuhani in Dholuo and John in English
 * alike.
 *
 * The chapter counts are the KJV's and sum to 1,189, which is what makes this
 * list usable as a completeness check in its own right.
 */

export type CanonBook = {
  /** 1-66, matching the order every translation agrees on. */
  number: number;
  english: string;
  abbreviation: string;
  chapters: number;
  testament: "Old" | "New";
};

export const CANON_BOOKS: readonly CanonBook[] = [
  { number: 1, english: "Genesis", abbreviation: "Gen", chapters: 50, testament: "Old" },
  { number: 2, english: "Exodus", abbreviation: "Exo", chapters: 40, testament: "Old" },
  { number: 3, english: "Leviticus", abbreviation: "Lev", chapters: 27, testament: "Old" },
  { number: 4, english: "Numbers", abbreviation: "Num", chapters: 36, testament: "Old" },
  { number: 5, english: "Deuteronomy", abbreviation: "Deu", chapters: 34, testament: "Old" },
  { number: 6, english: "Joshua", abbreviation: "Jos", chapters: 24, testament: "Old" },
  { number: 7, english: "Judges", abbreviation: "Jdg", chapters: 21, testament: "Old" },
  { number: 8, english: "Ruth", abbreviation: "Ruth", chapters: 4, testament: "Old" },
  { number: 9, english: "1 Samuel", abbreviation: "1Sa", chapters: 31, testament: "Old" },
  { number: 10, english: "2 Samuel", abbreviation: "2Sa", chapters: 24, testament: "Old" },
  { number: 11, english: "1 Kings", abbreviation: "1Ki", chapters: 22, testament: "Old" },
  { number: 12, english: "2 Kings", abbreviation: "2Ki", chapters: 25, testament: "Old" },
  { number: 13, english: "1 Chronicles", abbreviation: "1Ch", chapters: 29, testament: "Old" },
  { number: 14, english: "2 Chronicles", abbreviation: "2Ch", chapters: 36, testament: "Old" },
  { number: 15, english: "Ezra", abbreviation: "Ezr", chapters: 10, testament: "Old" },
  { number: 16, english: "Nehemiah", abbreviation: "Neh", chapters: 13, testament: "Old" },
  { number: 17, english: "Esther", abbreviation: "Est", chapters: 10, testament: "Old" },
  { number: 18, english: "Job", abbreviation: "Job", chapters: 42, testament: "Old" },
  { number: 19, english: "Psalms", abbreviation: "Psa", chapters: 150, testament: "Old" },
  { number: 20, english: "Proverbs", abbreviation: "Pro", chapters: 31, testament: "Old" },
  { number: 21, english: "Ecclesiastes", abbreviation: "Eccl", chapters: 12, testament: "Old" },
  { number: 22, english: "Song of Solomon", abbreviation: "Song", chapters: 8, testament: "Old" },
  { number: 23, english: "Isaiah", abbreviation: "Isa", chapters: 66, testament: "Old" },
  { number: 24, english: "Jeremiah", abbreviation: "Jer", chapters: 52, testament: "Old" },
  { number: 25, english: "Lamentations", abbreviation: "Lam", chapters: 5, testament: "Old" },
  { number: 26, english: "Ezekiel", abbreviation: "Ezk", chapters: 48, testament: "Old" },
  { number: 27, english: "Daniel", abbreviation: "Dan", chapters: 12, testament: "Old" },
  { number: 28, english: "Hosea", abbreviation: "Hos", chapters: 14, testament: "Old" },
  { number: 29, english: "Joel", abbreviation: "Joel", chapters: 3, testament: "Old" },
  { number: 30, english: "Amos", abbreviation: "Amo", chapters: 9, testament: "Old" },
  { number: 31, english: "Obadiah", abbreviation: "Obad", chapters: 1, testament: "Old" },
  { number: 32, english: "Jonah", abbreviation: "Jon", chapters: 4, testament: "Old" },
  { number: 33, english: "Micah", abbreviation: "Mic", chapters: 7, testament: "Old" },
  { number: 34, english: "Nahum", abbreviation: "Nah", chapters: 3, testament: "Old" },
  { number: 35, english: "Habakkuk", abbreviation: "Hab", chapters: 3, testament: "Old" },
  { number: 36, english: "Zephaniah", abbreviation: "Zep", chapters: 3, testament: "Old" },
  { number: 37, english: "Haggai", abbreviation: "Hag", chapters: 2, testament: "Old" },
  { number: 38, english: "Zechariah", abbreviation: "Zec", chapters: 14, testament: "Old" },
  { number: 39, english: "Malachi", abbreviation: "Mal", chapters: 4, testament: "Old" },
  { number: 40, english: "Matthew", abbreviation: "Mat", chapters: 28, testament: "New" },
  { number: 41, english: "Mark", abbreviation: "Mrk", chapters: 16, testament: "New" },
  { number: 42, english: "Luke", abbreviation: "Luk", chapters: 24, testament: "New" },
  { number: 43, english: "John", abbreviation: "Jhn", chapters: 21, testament: "New" },
  { number: 44, english: "Acts", abbreviation: "Act", chapters: 28, testament: "New" },
  { number: 45, english: "Romans", abbreviation: "Rom", chapters: 16, testament: "New" },
  { number: 46, english: "1 Corinthians", abbreviation: "1Co", chapters: 16, testament: "New" },
  { number: 47, english: "2 Corinthians", abbreviation: "2Co", chapters: 13, testament: "New" },
  { number: 48, english: "Galatians", abbreviation: "Gal", chapters: 6, testament: "New" },
  { number: 49, english: "Ephesians", abbreviation: "Eph", chapters: 6, testament: "New" },
  { number: 50, english: "Philippians", abbreviation: "Phi", chapters: 4, testament: "New" },
  { number: 51, english: "Colossians", abbreviation: "Col", chapters: 4, testament: "New" },
  { number: 52, english: "1 Thessalonians", abbreviation: "1Th", chapters: 5, testament: "New" },
  { number: 53, english: "2 Thessalonians", abbreviation: "2Th", chapters: 3, testament: "New" },
  { number: 54, english: "1 Timothy", abbreviation: "1Ti", chapters: 6, testament: "New" },
  { number: 55, english: "2 Timothy", abbreviation: "2Ti", chapters: 4, testament: "New" },
  { number: 56, english: "Titus", abbreviation: "Tit", chapters: 3, testament: "New" },
  { number: 57, english: "Philemon", abbreviation: "Phm", chapters: 1, testament: "New" },
  { number: 58, english: "Hebrews", abbreviation: "Heb", chapters: 13, testament: "New" },
  { number: 59, english: "James", abbreviation: "Jas", chapters: 5, testament: "New" },
  { number: 60, english: "1 Peter", abbreviation: "1Pe", chapters: 5, testament: "New" },
  { number: 61, english: "2 Peter", abbreviation: "2Pe", chapters: 3, testament: "New" },
  { number: 62, english: "1 John", abbreviation: "1Jn", chapters: 5, testament: "New" },
  { number: 63, english: "2 John", abbreviation: "2Jn", chapters: 1, testament: "New" },
  { number: 64, english: "3 John", abbreviation: "3Jn", chapters: 1, testament: "New" },
  { number: 65, english: "Jude", abbreviation: "Jude", chapters: 1, testament: "New" },
  { number: 66, english: "Revelation", abbreviation: "Rev", chapters: 22, testament: "New" },
];

/** Chapter totals in the canon, which must equal {@link REQUIRED_CHAPTERS}. */
export const CANON_TOTAL_CHAPTERS = CANON_BOOKS.reduce((total, book) => total + book.chapters, 0);

const BY_ENGLISH = new Map<string, CanonBook>();
for (const book of CANON_BOOKS) {
  BY_ENGLISH.set(book.english.toLowerCase(), book);
  // "Psalms" is typed as "Psalm" and "Song of Songs" as "Song of Solomon";
  // the alternate spellings are what readers actually search for.
  if (book.english === "Psalms") BY_ENGLISH.set("psalm", book);
  if (book.english === "Psalms") BY_ENGLISH.set("psalm s", book);
  if (book.english === "Song of Solomon") BY_ENGLISH.set("song of songs", book);
  if (book.english === "Song of Solomon") BY_ENGLISH.set("song", book);
  if (book.english === "Revelation") BY_ENGLISH.set("revelations", book);
}

/** Resolves an English book name to its canonical position, or undefined. */
export function canonNumber(name: string): number | undefined {
  return BY_ENGLISH.get(name.trim().toLowerCase())?.number;
}

/** The canon entry at a position, or undefined if out of range. */
export function canonBook(number: number): CanonBook | undefined {
  return CANON_BOOKS[number - 1];
}
