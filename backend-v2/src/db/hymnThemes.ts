/**
 * Theme lookup for hymns.
 *
 * The bundled hymnal sources carry no thematic metadata at all — the CIS JSON
 * files have only `title`, `number` and `content`, and the SDAH file has
 * `id`, `title`, `author`, `key`, `stanzas` and `choruses`. Rather than guess at
 * themes, they are supplied by hand in `assets/hymn-themes.json`, which maps
 * inclusive hymn-number ranges to a theme for each edition.
 *
 * A hymn that no range covers is left without a theme on purpose, so the browse
 * chips only ever show groupings somebody has actually confirmed.
 */

import { readFileSync, existsSync } from "node:fs";
import { get } from "./client.ts";

const THEMES_PATH = new URL("../../../assets/hymn-themes.json", import.meta.url).pathname;

/**
 * A range may carry its own `name` so a hymnal can show the theme in its own
 * language ("Sifa na Kuabudu") while still sharing the slug with the other
 * editions, which is what lets a theme be recognised across languages.
 */
export type ThemeRange = { from: number; to: number; theme: string; name?: string };
export type ThemeDefinition = { slug: string; name: string };

type ThemeConfig = {
  themes?: ThemeDefinition[];
  editions?: Record<string, ThemeRange[]>;
};

let cache: { names: Map<string, string>; ranges: Map<string, ThemeRange[]> } | null = null;
const codeCache = new Map<string, string>();

function load(): { names: Map<string, string>; ranges: Map<string, ThemeRange[]> } {
  if (cache) return cache;
  const names = new Map<string, string>();
  const ranges = new Map<string, ThemeRange[]>();
  if (existsSync(THEMES_PATH)) {
    const parsed = JSON.parse(readFileSync(THEMES_PATH, "utf-8")) as ThemeConfig;
    for (const theme of parsed.themes ?? []) names.set(theme.slug, theme.name);
    for (const [edition, list] of Object.entries(parsed.editions ?? {})) ranges.set(edition, list);
  }
  cache = { names, ranges };
  return cache;
}

/** The canonical English name for a theme slug, if the config declares one. */
export function configuredThemeName(slug: string): string | undefined {
  return load().names.get(slug);
}

/** Every theme defined in the config, in the order it was declared. */
export function listConfiguredThemes(): ThemeDefinition[] {
  const { names } = load();
  return [...names.entries()].map(([slug, name]) => ({ slug, name }));
}

/**
 * The theme for one hymn, or `null` when the config does not cover it.
 *
 * `edition` is matched against the edition id first (`CIS-ru`, `SDAH`) and then
 * against its `hymn_editions.code` (`HCASDA`). Matching on the code keeps config
 * keys readable: the HCASDA edition's id is a content hash, so a key naming it
 * would be unwriteable by hand.
 */
export function themeFor(edition: string, number: number | string): { name: string; slug: string } | null {
  const { names, ranges } = load();
  const list = ranges.get(edition) ?? ranges.get(editionCode(edition));
  if (!list) return null;
  const value = typeof number === "number" ? number : Number.parseInt(number, 10);
  if (!Number.isFinite(value)) return null;
  const hit = list.find((range) => value >= range.from && value <= range.to);
  if (!hit) return null;
  // A range pointing at a slug that is not declared is a config typo, not a theme.
  if (!names.has(hit.theme)) return null;
  return { name: hit.name ?? names.get(hit.theme)!, slug: hit.theme };
}

/** Maps an edition id to its short code, for config keys written by hand. */
function editionCode(editionId: string): string {
  if (codeCache.has(editionId)) return codeCache.get(editionId)!;
  let code = editionId;
  try {
    const row = get<{ code: string }>("SELECT code FROM hymn_editions WHERE id = ?", [editionId]);
    if (row?.code) code = row.code;
  } catch {
    // The editions table is not there yet (fresh database during seeding).
  }
  codeCache.set(editionId, code);
  return code;
}
