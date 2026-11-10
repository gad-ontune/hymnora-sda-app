import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { all, run } from "./client.ts";
import { themeFor } from "./hymnThemes.ts";

const ROOT = new URL("../../../assets/cis-hymnals/", import.meta.url).pathname;

type CisBook = { key: string; title: string; language: string };
type CisHymn = { title?: string; number?: number | string; content?: string; markdown?: string };

const EDITION_PREFIX = "CIS";

/**
 * English already ships as the Seventh-day Adventist Hymnal and Hymns and
 * Carols, and the repository's own English books duplicate both with flatter
 * line breaks. They are skipped so the English list has no repeats.
 */
const SKIP_KEYS = new Set(["english", "sdah"]);

/** Display names for books that ship without a config.json entry. */
const LANGUAGE_TITLES: Record<string, string> = {
  twi: "Twi",
  icibemba: "Icibemba",
};

/**
 * Flattens the repository's HTML hymn body into plain text.
 *
 * The source marks stanza breaks with `</p>` and lines with `<br/>`, so those
 * become newlines and every other tag is dropped. Verse numbers arrive as an
 * orange `1.` prefix inside the stanza and are stripped from the lyrics.
 */
export function htmlToLyrics(html: string): { lyrics: string; verseCount: number } {
  const text = html
    .replace(/<h1[\s\S]*?<\/h1>/gi, "")
    .replace(/<\s*\/?\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\/\s*p\s*>/gi, "\n")
    // A bold or italic subtitle between the heading and the first stanza still
    // needs its own line, otherwise it welds itself onto verse one.
    .replace(/<\/\s*(?:b|i|em|strong|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trim())
    .map((line) => line.replace(/^\s*\d+\s*[.)]\s*/, ""))
    // A bare number in its own line is the verse marker, not a lyric.
    .filter((line) => !/^\s*\d+\s*$/.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const verseCount = text.split(/\n\s*\n/).filter((stanza) => stanza.trim().length > 0).length;
  return { lyrics: text, verseCount };
}

/**
 * Some books in the repository ship as markdown instead of HTML. Headings carry
 * the title, emphasis is decorative, and a bare bold number opens each stanza.
 */
export function markdownToLyrics(markdown: string): { lyrics: string; verseCount: number } {
  const text = markdown
    .split("\n")
    .filter((line) => !/^\s{0,3}#{1,6}\s/.test(line))
    .join("\n")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\*\*([^*]*)\*\*/g, "$1")
    .replace(/\*([^*]*)\*/g, "$1")
    .replace(/^\s*_+\s*$/gm, "")
    .replace(/\s+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trim())
    .map((line) => line.replace(/^\s*\d+\s*[.)]\s*/, ""))
    .filter((line) => !/^\s*\d+\s*$/.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const verseCount = text.split(/\n\s*\n/).filter((stanza) => stanza.trim().length > 0).length;
  return { lyrics: text, verseCount };
}

/** Books ship in one of two shapes; both collapse to the same plain-text form. */
function toLyrics(hymn: CisHymn): { lyrics: string; verseCount: number } {
  return hymn.markdown ? markdownToLyrics(hymn.markdown) : htmlToLyrics(hymn.content ?? "");
}

/** `1 'Mochenu Omochenu` and `1 - Lishisheni Ulupenga` -> plain text */
function cleanTitle(raw: string): string {
  return raw
    .replace(/^\s*\d+\s*/, "")
    .replace(/^[\s'"\-–—•.:]+/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** File names are not consistently cased against their config key. */
function resolveFile(key: string): string | null {
  if (existsSync(join(ROOT, `${key}.json`))) return join(ROOT, `${key}.json`);
  const match = readdirSync(ROOT).find((file) => file.toLowerCase() === `${key.toLowerCase()}.json`);
  return match ? join(ROOT, match) : null;
}

function loadBooks(): CisBook[] {
  const configPath = join(ROOT, "config.json");
  const config: CisBook[] = existsSync(configPath) ? JSON.parse(readFileSync(configPath, "utf-8")) : [];
  const files = readdirSync(ROOT).filter((file) => file.endsWith(".json") && file.toLowerCase() !== "config.json");

  // config.json is authoritative for titles, but a few books ship without an entry.
  const known = new Set(config.map((book) => book.key.toLowerCase()));
  const books = [...config];
  for (const file of files) {
    const key = file.replace(/\.json$/, "");
    if (known.has(key.toLowerCase())) continue;
    const sample = JSON.parse(readFileSync(join(ROOT, file), "utf-8")) as CisHymn[];
    books.push({ key, title: LANGUAGE_TITLES[key.toLowerCase()] ?? key.charAt(0).toUpperCase() + key.slice(1), language: LANGUAGE_TITLES[key.toLowerCase()] ?? key.charAt(0).toUpperCase() + key.slice(1) });
  }
  return books.sort((a, b) => b.key.localeCompare(a.key));
}

function upsertEdition(book: CisBook, count: number): void {
  const id = `${EDITION_PREFIX}-${book.key}`;
  run(
    `INSERT INTO hymn_editions (id, name, code, language, year, publisher, rights, description)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, language = excluded.language,
       description = excluded.description`,
    [
      id,
      book.title,
      id,
      book.language,
      null,
      "Christ In Song (CIS)",
      "Text reproduced from the open CIS hymnal repository",
      `${book.title} — ${count} hymns in ${book.language}`,
    ],
  );
}

export function loadCisHymnals(): { editions: number; loaded: number; errors: string[] } {
  const errors: string[] = [];
  let loaded = 0;
  let editions = 0;

  for (const book of loadBooks()) {
    if (SKIP_KEYS.has(book.key.toLowerCase())) continue;
    const file = resolveFile(book.key);
    if (!file) {
      errors.push(`${book.key}: file missing`);
      continue;
    }
    let hymns: CisHymn[] = [];
    try {
      hymns = JSON.parse(readFileSync(file, "utf-8"));
    } catch (error) {
      errors.push(`${book.key}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    if (!Array.isArray(hymns)) {
      errors.push(`${book.key}: unexpected JSON shape`);
      continue;
    }

    const editionId = `${EDITION_PREFIX}-${book.key}`;
    const rows = hymns
      .map((hymn, index) => {
        const number = String(hymn.number ?? index + 1).trim();
        const sortNumber = Number.parseInt(number, 10) || index + 1;
        const title = cleanTitle(hymn.title ?? "");
        const { lyrics, verseCount } = toLyrics(hymn);
        if (!title || !lyrics) return null;
        return { id: `${editionId}-${number}`, number, sortNumber, title, lyrics, verseCount };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);

    if (rows.length === 0) {
      errors.push(`${book.key}: no usable hymns`);
      continue;
    }

    upsertEdition(book, rows.length);
    editions += 1;

    for (const row of rows) {
      try {
        const theme = themeFor(editionId, row.sortNumber ?? row.number);
        run(
          `INSERT INTO hymns (id, number, sort_number, title, edition_id, edition, language, duration_seconds,
                              image, theme, theme_slug, verse_count, lyrics, copyright, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0, '', ?, ?, ?, ?, ?, 'published')
           ON CONFLICT(id) DO UPDATE SET number = excluded.number, sort_number = excluded.sort_number,
             title = excluded.title, edition_id = excluded.edition_id, edition = excluded.edition,
             language = excluded.language, theme = excluded.theme, theme_slug = excluded.theme_slug,
             verse_count = excluded.verse_count, lyrics = excluded.lyrics,
             copyright = excluded.copyright`,
          [
            row.id,
            row.number,
            row.sortNumber,
            row.title,
            editionId,
            book.title,
            book.language,
            theme?.name ?? null,
            theme?.slug ?? null,
            row.verseCount,
            row.lyrics,
            `© Christ In Song — ${book.title}`,
          ],
        );
        loaded += 1;
      } catch (error) {
        errors.push(`${book.key}/${row.number}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  return { editions, loaded, errors };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = loadCisHymnals();
  console.log(`[cis] editions ${result.editions}`);
  console.log(`[cis] hymns   ${result.loaded}`);
  if (result.errors.length > 0) {
    console.log(`[cis] errors  ${result.errors.length}`);
    for (const error of result.errors.slice(0, 20)) console.log(`  - ${error}`);
  }
  const tally = all<{ language: string; c: number }>(
    "SELECT language, COUNT(*) AS c FROM hymns WHERE edition_id LIKE 'CIS-%' GROUP BY language ORDER BY c DESC",
  );
  console.log(`[cis] languages ${tally.length}`);
  for (const row of tally) console.log(`  ${row.language}: ${row.c}`);
}
