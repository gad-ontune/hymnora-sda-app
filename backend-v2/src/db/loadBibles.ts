/**
 * Seeds complete Bible translations from the HelloAO catalogue into the local
 * SQLite tables, so scripture reads work with no network at all.
 *
 * Only translations that pass the completeness checks in
 * `modules/bible/completeness.ts` are written. A translation that fails is
 * skipped entirely and reported as a single-line console warning — it is never
 * partially written, because a Bible that stops mid-canon is worse than one
 * that is absent.
 *
 * Usage:
 *   npm run load:bible                  # the default set below
 *   npm run load:bible -- --all         # every complete translation upstream
 *   npm run load:bible -- --ids=kjv,swh # an explicit list
 *   npm run load:bible -- --list        # show what would be seeded, fetch nothing
 */

import { closeDatabase, pluck, run, transaction } from "./client.ts";
import { fetchCompleteTranslation, fetchTranslations, type HelloAOTranslation } from "../modules/bible/external.ts";
import {
  REQUIRED_BOOKS,
  REQUIRED_CHAPTERS,
  checkMetadata,
  explain,
  extractBooks,
  verifyPayload,
  type ExtractedBook,
} from "../modules/bible/completeness.ts";
import { canonBook } from "../modules/bible/canon.ts";
import { encodeChapter } from "../modules/bible/chapterstore.ts";

/**
 * Translations seeded by default: the languages the hymnal already carries,
 * plus English. Pass `--all` to onboard the other 180-odd complete
 * translations upstream offers — that is roughly 1.2 GB of text.
 */
const DEFAULT_IDS = [
  // English — upstream prefixes these with `eng_`
  "eng_kjv", "eng_kja", "eng_cpb", "eng_asv", "ENGWEBP", "eng_bbe", "eng_dby", "eng_gnv", "eng_ulb", "eng_ylt",
  // Kiswahili
  "swh_bib", "swh_onmm", "swh_ulb",
  // Kenyan / East African
  "luo_bib", "kik_bib", "lin_bib",
  // Southern & West African
  "nde_bib", "nya_bib", "sna_bib", "twi_aka", "twi_asa",
  // Other world languages
  "rus_syn", "spa_rvg", "por_bsl", "fra_lsg",
] as const;

type SeedOutcome = "seeded" | "skipped-incomplete" | "skipped-download" | "skipped-invalid" | "failed";

export type SeedTranslationReport = {
  id: string;
  name: string;
  language: string;
  outcome: SeedOutcome;
  reason?: string;
  books?: number;
  chapters?: number;
  verses?: number;
};

export type SeedReport = {
  seeded: SeedTranslationReport[];
  skipped: SeedTranslationReport[];
  failed: SeedTranslationReport[];
  totals: { versions: number; books: number; verses: number };
};

/** Human name for a translation, preferring the English gloss on a non-English catalogue. */
function label(t: HelloAOTranslation): string {
  return t.englishName?.trim() || t.name?.trim() || t.id;
}

/**
 * Strips characters the version lookup and `?version=` matching cannot carry.
 * Upstream ids are lowercase with underscores; the reader is addressed by id
 * or by a letter code, so `kjv` and `KJVC-P` both have to survive the round trip.
 */
/** A single-value SUM, which always returns exactly one row. */
function sumOf(sql: string): number {
  return Number(pluck(sql) ?? 0);
}

function versionId(t: HelloAOTranslation): string {
  return t.id.replace(/[^A-Za-z0-9_-]/g, "").toLowerCase();
}

/** `verse-<version>-<book>-<chapter>-<verse>`; stable so re-seeding upserts. */
function verseId(version: string, book: number, chapter: number, verse: number): string {
  return `v-${version}-${book}-${chapter}-${verse}`;
}

/** `book-<version>-<book number>` — the same 66 books exist once per version. */
function bookId(version: string, book: number): string {
  return `bk-${version}-${book}`;
}

/**
 * Writes one verified translation. Runs in a single transaction so a failure
 * part-way through leaves no half-written Bible behind.
 */
function writeTranslation(t: HelloAOTranslation, books: ExtractedBook[]): { books: number; chapters: number; verses: number } {
  const version = versionId(t);
  let verseTotal = 0;
  const chapterTotal = books.reduce((total, book) => total + book.chapterCount, 0);

  transaction(() => {
    run(
      `INSERT INTO bible_versions (id, name, language, language_code, status, publisher, year, description,
                                   books_count, chapters_count, verses_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name, language = excluded.language, language_code = excluded.language_code,
         status = excluded.status, publisher = excluded.publisher, year = excluded.year,
         description = excluded.description, books_count = excluded.books_count,
         chapters_count = excluded.chapters_count, verses_count = excluded.verses_count`,
      [
        version,
        t.name || label(t),
        languageName(t),
        t.language || "en",
        rightsStatus(t),
        null,
        null,
        t.englishName || t.name || t.id,
        // The counts recorded here are the ones this translation actually has,
        // not the canonical skeleton. The Douay-Rheims runs to 1,197 chapters
        // and the Hausa to 1,190; writing 1,189 into the row for either would
        // put a number the data does not support into the overview totals.
        books.length,
        chapterTotal,
        Number(t.totalNumberOfVerses ?? 0),
      ],
    );

    for (const book of books) {
      // Re-seeding a version must not leave text from a previous run behind.
      run("DELETE FROM bible_chapters WHERE version_id = ? AND book_number = ?", [version, book.bookNumber]);
      run(
        `INSERT INTO bible_books (id, version_id, name, abbreviation, testament, book_number, chapter_count, verse_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name, abbreviation = excluded.abbreviation, testament = excluded.testament,
           chapter_count = excluded.chapter_count, verse_count = excluded.verse_count`,
        [
          bookId(version, book.bookNumber),
          version,
          book.name,
          canonBook(book.bookNumber)?.abbreviation ?? book.name.slice(0, 3),
          canonBook(book.bookNumber)?.testament ?? (book.bookNumber <= 39 ? "Old" : "New"),
          book.bookNumber,
          book.chapterCount,
          book.verseCount,
        ],
      );

      // Verses are stored a chapter at a time, compressed, rather than one row
      // each. The reader asks for whole chapters, so this is both the compact
      // shape and the fast one.
      const byChapter = new Map<number, string[]>();
      for (const verse of book.verses) {
        const bucket = byChapter.get(verse.chapter);
        if (bucket) bucket.push(verse.text);
        else byChapter.set(verse.chapter, [verse.text]);
        verseTotal += 1;
      }
      for (const [chapter, verses] of byChapter) {
        run(
          `INSERT INTO bible_chapters (version_id, book_number, chapter, verse_count, payload)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(version_id, book_number, chapter) DO UPDATE SET
             verse_count = excluded.verse_count, payload = excluded.payload`,
          [version, book.bookNumber, chapter, verses.length, encodeChapter(verses)],
        );
      }
    }
  });

  return { books: books.length, chapters: chapterTotal, verses: verseTotal };
}

/** The catalogue carries ISO codes; the reader shows a readable language. */
const LANGUAGE_NAMES: Record<string, string> = {
  eng: "English", swh: "Kiswahili", luo: "Dholuo", kik: "Kikuyu", twi: "Twi", nde: "Ndebele",
  nya: "Chichewa", sna: "Shona", rus: "Russian", spa: "Spanish", por: "Portuguese", fra: "French",
  lin: "Lingala", som: "Somali", kin: "Kinyarwanda", xho: "Xhosa", zul: "Zulu", yor: "Yoruba",
  hau: "Hausa", ibo: "Igbo", amo: "Amharic", orc: "Oromo", tso: "Tsonga", ven: "Venda",
  nso: "Sepedi", tsn: "Tswana", sot: "Sotho", tum: "Tumbuka", ewe: "Ewe", aka: "Akan",
  bam: "Bambara", wol: "Wolof", mfe: "Morisyen", tir: "Tigrinya", arb: "Arabic", tur: "Turkish",
  per: "Persian", urd: "Urdu", hin: "Hindi", ben: "Bengali", pan: "Panjabi", guj: "Gujarati",
  mar: "Marathi", tel: "Telugu", kan: "Kannada", tam: "Tamil", mal: "Malayalam", sin: "Sinhala",
  mdy: "Maale", gaz: "Oromo",
};

/**
 * A readable language name for the reader.
 *
 * The curated table wins where it has an entry, so names already on screen stay
 * put — "Kiswahili" rather than "Swahili", "Chichewa" rather than "Nyanja".
 * Everything else comes from the catalogue, which names all 105 of its
 * languages. Falling through to a bare "English" is what this used to do for an
 * unknown code, and it labelled the Luganda, Oromo, Gamo, Gofa, Dawro, Maale,
 * Susu and Ditammari Bibles as English. The code itself is the last resort, so
 * a language the catalogue fails to name still shows its own identifier rather
 * than someone else's.
 */
function languageName(t: HelloAOTranslation): string {
  const code = t.language;
  return (
    (code && LANGUAGE_NAMES[code]) ||
    t.languageName ||
    t.languageEnglishName ||
    code ||
    "Unknown"
  );
}

/** Everything not openly licensed is labelled so the reader can be honest about it. */
function rightsStatus(t: HelloAOTranslation): string {
  const url = (t.licenseUrl ?? "").toLowerCase();
  if (!url) return "Check licence";
  if (url.includes("publicdomain") || url.includes("creativecommons.org/publicdomain")) return "Public domain";
  if (url.includes("creativecommons.org/licenses/by")) return "CC BY";
  if (url.includes("creativecommons.org/licenses/by-sa")) return "CC BY-SA";
  if (url.includes("creativecommons.org/licenses/by-nc")) return "CC BY-NC";
  return "Licensed";
}

export type SeedOptions = {
  /** Seed every complete translation upstream offers, not just the default set. */
  all?: boolean;
  /** Seed an explicit list of upstream ids, bypassing the default set. */
  ids?: string[];
  /** Report what would happen without downloading or writing anything. */
  list?: boolean;
};

export async function loadBibles(options: SeedOptions = {}): Promise<SeedReport> {
  const catalogue = await fetchTranslations();
  const wanted = options.ids?.length
    ? new Set(options.ids.map((id) => id.toLowerCase()))
    : null;

  // Stage one — metadata. Reject here so no ~6 MB download is spent on a
  // translation that turns out to be only the New Testament.
  // Upstream ids are not consistently cased (`ENGWEBP` sits alongside
  // `eng_kjv`), so every comparison goes through one normalisation.
  const normalise = (id: string): string => id.toLowerCase();
  const defaultIds = new Set((DEFAULT_IDS as readonly string[]).map(normalise));

  const inScope = (t: HelloAOTranslation): boolean => {
    if (wanted) return wanted.has(normalise(t.id));
    if (options.all) return true;
    return defaultIds.has(normalise(t.id));
  };

  // An id that matches nothing is almost always a typo, and quietly seeding
  // twenty-five of twenty-six translations is the kind of thing that only gets
  // noticed weeks later — so unmatched ids are reported, not dropped.
  if (wanted) {
    const found = new Set(catalogue.filter((t) => wanted.has(t.id.toLowerCase())).map((t) => t.id.toLowerCase()));
    const unknown = [...wanted].filter((id) => !found.has(id));
    for (const id of unknown) console.warn(`  [bible] no such translation upstream: ${id}`);
  }

  const candidates: HelloAOTranslation[] = [];
  const skipped: SeedTranslationReport[] = [];
  for (const t of catalogue) {
    if (!inScope(t)) continue;
    const verdict = checkMetadata(t);
    if (verdict.complete) {
      candidates.push(t);
    } else {
      skipped.push({
        id: t.id, name: label(t), language: t.language,
        outcome: "skipped-incomplete", reason: verdict.detail,
        books: verdict.books, chapters: verdict.chapters, verses: verdict.verses,
      });
    }
  }

  if (options.list) {
    for (const t of candidates) console.log(`  would seed  ${t.id.padEnd(12)} ${label(t)}`);
    for (const s of skipped) console.warn(`  skipped     ${s.id.padEnd(12)} ${s.name} — ${s.reason}`);
    return {
      seeded: [], skipped,
      failed: [],
      totals: { versions: 0, books: 0, verses: 0 },
    };
  }

  const seeded: SeedTranslationReport[] = [];
  const failed: SeedTranslationReport[] = [];

  for (const t of candidates) {
    const report = { id: t.id, name: label(t), language: t.language };
    let payload: unknown;
    try {
      payload = await fetchCompleteTranslation(t.id);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      failed.push({ ...report, outcome: "skipped-download", reason: explain("request-failed", { books: 0, chapters: 0, verses: 0 }, reason) });
      console.warn(`  [bible] skipped ${t.id} (${label(t)}) — could not be downloaded: ${reason}`);
      continue;
    }

    // Stage two — the text itself, not just the metadata it was sold with.
    const verdict = verifyPayload(payload as Parameters<typeof verifyPayload>[0], Number(t.totalNumberOfVerses));
    if (!verdict.complete) {
      skipped.push({ ...report, outcome: "skipped-incomplete", reason: verdict.detail, books: verdict.books, chapters: verdict.chapters, verses: verdict.verses });
      console.warn(`  [bible] skipped ${t.id} (${label(t)}) — ${verdict.detail}`);
      continue;
    }

    try {
      const written = writeTranslation(t, extractBooks(payload as Parameters<typeof extractBooks>[0]));
      if (written.verses !== verdict.verses) throw new Error(`wrote ${written.verses} verses but verified ${verdict.verses}`);
      seeded.push({ ...report, outcome: "seeded", books: written.books, chapters: verdict.chapters, verses: written.verses });
      console.log(`  [bible] seeded ${t.id.padEnd(12)} ${label(t)} — ${written.books} books, ${written.verses.toLocaleString("en-KE")} verses`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      failed.push({ ...report, outcome: "failed", reason });
      console.warn(`  [bible] failed  ${t.id} (${label(t)}) — ${reason}`);
    }
  }

  return {
    seeded,
    skipped,
    failed,
    totals: {
      versions: sumOf("SELECT COUNT(*) AS total FROM bible_versions"),
      books: sumOf("SELECT COUNT(*) AS total FROM bible_books"),
      verses: sumOf("SELECT COALESCE(SUM(verse_count), 0) AS total FROM bible_chapters"),
    },
  };
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const flag = (name: string): string | undefined => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
  const options: SeedOptions = {
    all: args.includes("--all"),
    list: args.includes("--list"),
    ids: flag("ids")?.split(",").map((id) => id.trim()).filter(Boolean),
  };

  loadBibles(options)
    .then((report) => {
      if (options.list) {
        console.log(`[bible] ${report.skipped.length} incomplete translation(s) in scope`);
        return;
      }
      console.log(
        `[bible] done — ${report.seeded.length} seeded, ${report.skipped.length} skipped as incomplete, ${report.failed.length} failed`,
      );
      console.log(
        `[bible] library now holds ${report.totals.versions} version(s), ${report.totals.books.toLocaleString("en-KE")} book rows, ${report.totals.verses.toLocaleString("en-KE")} verses`,
      );
    })
    .catch((error) => {
      console.error(`[bible] seeding failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    })
    .finally(closeDatabase);
}
