/**
 * One-shot conversion of the verse-row store into the chapter store.
 *
 * The reader used to keep one row per verse. Each row repeated the version,
 * the book id, the book name and a surrogate text key, and four indexes
 * duplicated all of it: 719 MB to hold 241 MB of text. The chapter store holds
 * the same text as 1,189 compressed rows per Bible instead of 31,000 plain
 * ones, so this walks the old table chapter by chapter, writes the compressed
 * equivalent, checks the totals line up, and only then drops what it replaced.
 *
 * It refuses to drop anything if the conversion comes out short, so an
 * interrupted run leaves the original rows intact and re-runnable.
 *
 *   npm run pack:verses          # convert, verify, then drop bible_verses
 *   npm run pack:verses -- --check   # report sizes, change nothing
 */
import { all, closeDatabase, get, run, transaction } from "./client.ts";
import { encodeChapter } from "../modules/bible/chapterstore.ts";

/** Chapters handled per transaction, to bound peak memory and rollback cost. */
const BATCH = 500;

type ChapterKey = { version_id: string; book_id: string; chapter: number; book_number: number };

function pack(checkOnly: boolean): void {
  const before = tally("SELECT COUNT(*) s FROM bible_verses");
  const bytesBefore = tally("SELECT COALESCE(SUM(LENGTH(text)), 0) s FROM bible_verses");

  if (checkOnly) {
    report("current", before, bytesBefore);
    const chapters = tally("SELECT COUNT(*) s FROM bible_chapters");
    report("chapters", chapters, 0);
    return;
  }

  // Distinct chapters, walked in primary-key order so a rerun after a partial
  // conversion simply rewrites the same rows rather than doubling up.
  const keys = all<ChapterKey>(
    `SELECT v.version_id, v.book_id, v.chapter, b.book_number
     FROM bible_verses v
     JOIN bible_books b ON b.id = v.book_id
     GROUP BY v.version_id, v.book_id, v.chapter
     ORDER BY v.version_id, b.book_number, v.chapter`,
  );
  console.log(`  [pack] converting ${keys.length.toLocaleString()} chapters from ${before.toLocaleString()} verses`);

  let written = 0;
  let versesWritten = 0;
  for (let i = 0; i < keys.length; i += BATCH) {
    const slice = keys.slice(i, i + BATCH);
    transaction(() => {
      for (const key of slice) {
        const verses = all<{ text: string }>(
          "SELECT text FROM bible_verses WHERE version_id = ? AND book_id = ? AND chapter = ? ORDER BY verse",
          [key.version_id, key.book_id, key.chapter],
        ).map((row) => row.text);
        if (verses.length === 0) continue;
        versesWritten += verses.length;
        run(
          `INSERT INTO bible_chapters (version_id, book_number, chapter, verse_count, payload)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (version_id, book_number, chapter) DO UPDATE SET
             verse_count = excluded.verse_count, payload = excluded.payload`,
          [key.version_id, key.book_number, key.chapter, verses.length, encodeChapter(verses)],
        );
        written += 1;
      }
    });
    if (written % 5000 < BATCH) {
      console.log(`  [pack]   ${written.toLocaleString()} chapters`);
    }
  }

  const after = tally("SELECT COALESCE(SUM(verse_count), 0) s FROM bible_chapters");
  if (after !== versesWritten || after !== before) {
    throw new Error(
      `refusing to drop bible_verses: wrote ${versesWritten.toLocaleString()} verses, ` +
        `chapter store reports ${after.toLocaleString()}, source held ${before.toLocaleString()}`,
    );
  }
  console.log(`  [pack] verified ${after.toLocaleString()} verses across ${written.toLocaleString()} chapters`);

  // Only now is the old table redundant.
  run("DROP TABLE IF EXISTS bible_verses");
  run("VACUUM");
  report("chapter store", after, tally("SELECT COALESCE(SUM(LENGTH(payload)), 0) s FROM bible_chapters"));
  console.log("  [pack] done — dropped bible_verses");
}

function report(label: string, verses: number, bytes: number): void {
  if (bytes > 0) {
    console.log(`  [pack] ${label.padEnd(14)} ${verses.toLocaleString().padStart(11)} verses  ${(bytes / 1048576).toFixed(1).padStart(8)} MB`);
  } else {
    console.log(`  [pack] ${label.padEnd(14)} ${verses.toLocaleString().padStart(11)} chapters`);
  }
}

/** A single-value aggregate, which always returns exactly one row. */
function tally(sql: string): number {
  return Number(get<{ s: number }>(sql)?.s ?? 0);
}

const checkOnly = process.argv.includes("--check");
pack(checkOnly);
closeDatabase();
