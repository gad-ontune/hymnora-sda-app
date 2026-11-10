/**
 * Loads SDA hymns from the GospelSounders hymnals-data JSON into the local SQLite table.
 *
 * Usage: `npx tsx src/db/loadHymns.ts` or compile with tsc and run `node dist/db/loadHymns.js`.
 */

import { readFileSync } from "node:fs";
import { all, run } from "./client.ts";
import { themeFor } from "./hymnThemes.ts";
import { existsSync } from "node:fs";

const DATA_PATH = new URL("../../../assets/hymnals-data/SDAH/index.json", import.meta.url).pathname;

interface Stanzas { [key: string]: string }
interface Song { id: number; title: string; author: string; key: string; stanzas: Stanzas; choruses: Record<string, unknown> }
interface HymnalData { songs: Record<string, Song> }

export function loadHymns(): { loaded: number; skipped: number; errors: string[] } {
  if (!existsSync(DATA_PATH)) {
    throw new Error(`Hymnal data not found at ${DATA_PATH}`);
  }
  const raw = JSON.parse(readFileSync(DATA_PATH, "utf-8")) as HymnalData;
  const songs = Object.values(raw.songs);

  const errors: string[] = [];
  let loaded = 0;
  let skipped = 0;

  // Ensure the SDA edition exists.
  const editionId = "SDAH";
  const existingEdition = all<{ c: number }>("SELECT COUNT(*) c FROM hymn_editions WHERE id = ?", [editionId])[0].c;
  if (existingEdition === 0) {
    run(
      "INSERT INTO hymn_editions (id, name, code, language, year, publisher, rights, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [editionId, "Seventh-day Adventist Hymnal", "SDAH", "English", 1985, "General Conference of Seventh-day Adventists", "Public domain", "695+ hymns from the Seventh-day Adventist Hymnal"],
    );
  }

  for (const song of songs) {
    // The upstream file pads the real 695 hymns out to 920 with empty
    // placeholder entries that carry no title and no stanzas.
    if (!song.title?.trim() || Object.keys(song.stanzas ?? {}).length === 0) {
      skipped++;
      continue;
    }

    try {
      const id = `sdah-${song.id}`;
      const number = String(song.id);
      const lyrics = Object.values(song.stanzas).join("\n\n");
      const tune = song.key && song.key !== "unknown" ? song.key : null;
      const theme = themeFor(editionId, song.id);

      run(
        `INSERT INTO hymns (id, number, sort_number, title, edition_id, edition, language, duration_seconds,
                            image, theme, theme_slug, tune, meter, musical_key, verse_count, lyrics,
                            copyright, audio_url, downloadable, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET title=excluded.title, lyrics=excluded.lyrics, tune=excluded.tune,
                                    musical_key=excluded.musical_key, verse_count=excluded.verse_count,
                                    theme=excluded.theme, theme_slug=excluded.theme_slug`,
        [
          id, number, song.id, song.title, editionId, "Seventh-day Adventist Hymnal", "English", 0,
          "", theme?.name ?? null, theme?.slug ?? null, tune, null, tune,
          Object.keys(song.stanzas).length, lyrics || null,
          "", "", 0, "published",
        ],
      );
      loaded++;
    } catch (e) {
      errors.push(`Song ${song.id} (${song.title}): ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { loaded, skipped, errors };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = loadHymns();
  console.log(`Loaded ${result.loaded} hymns, skipped ${result.skipped} empty placeholders, ${result.errors.length} errors`);
  if (result.errors.length > 0) console.log("Errors:", result.errors.slice(0, 5));
}
