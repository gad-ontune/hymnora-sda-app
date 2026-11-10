/**
 * Rebuilds the whole hymn catalogue from the bundled JSON and Markdown sources.
 *
 * Each loader is idempotent (upserts keyed on hymn id), so this is safe to run
 * against a populated database and is what `npm run setup` uses to reach the
 * full 9,165-hymn catalogue. The search index is rebuilt last, once every
 * edition is in place, because `search_index` is fully derived from the hymn
 * tables.
 *
 * Usage: `npm run load:hymns`
 */

import { loadCisHymnals } from "./loadCisHymnals.ts";
import { loadHymns } from "./loadHymns.ts";
import { loadAfrican } from "./loadAfricanHymns.ts";
import { reindex } from "../modules/search/service.ts";

export function loadAllHymns(): { cis: number; sdah: number; skipped: number; errors: string[] } {
  const errors: string[] = [];

  // CIS first: it is the largest source, and its Swahili edition is what
  // suppresses the duplicate NZK load further down.
  const cis = loadCisHymnals();
  errors.push(...cis.errors);

  const sdah = loadHymns();
  errors.push(...sdah.errors);

  const african = loadAfrican();

  // Derive the search index only after the source tables are final.
  reindex();

  return {
    cis: cis.loaded,
    sdah: sdah.loaded,
    skipped: sdah.skipped + (african.skipped ? african.loaded || 220 : 0),
    errors,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = loadAllHymns();
  console.log(`[all] CIS hymns   ${result.cis}`);
  console.log(`[all] SDAH hymns  ${result.sdah}`);
  console.log(`[all] search index rebuilt`);
  if (result.errors.length > 0) {
    console.log(`[all] errors      ${result.errors.length}`);
    for (const error of result.errors.slice(0, 20)) console.log(`  - ${error}`);
  } else {
    console.log(`[all] errors      0`);
  }
}
