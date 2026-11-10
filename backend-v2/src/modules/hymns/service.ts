import { z } from "zod";
import type { Request } from "express";
import { all, get, run, type Row } from "../../db/client.ts";
import { notFound, unprocessable } from "../../lib/errors.ts";
import { WhereBuilder, orderBy, paginate } from "../../lib/sql.ts";
import { listQueryFrom, sortColumn } from "../../lib/query.ts";
import { buildMeta, newId } from "../../lib/http.ts";
import { formatDuration, parseDurationToSeconds } from "../../lib/time.ts";
import type { Hymn, HymnDetail, HymnEdition } from "../../types/domain.ts";
import type { ListMeta, ListQuery } from "../../types/api.ts";
import { configuredThemeName } from "../../db/hymnThemes.ts";

type HymnRow = Row & {
  id: string;
  number: string;
  sort_number: number;
  title: string;
  edition_id: string;
  edition: string;
  edition_code?: string | null;
  language: string;
  duration_seconds: number;
  image: string;
  theme: string;
  theme_slug: string | null;
  tune: string | null;
  meter: string | null;
  musical_key: string | null;
  verse_count: number;
  lyrics: string | null;
  copyright: string | null;
  audio_url: string | null;
  downloadable: number;
  play_count: number;
  status: string;
  created_at: string;
  updated_at: string;
};

function toHymn(row: HymnRow): Hymn {
  return {
    id: row.id,
    number: row.number,
    title: row.title,
    edition: row.edition,
    editionCode: row.edition_code ?? null,
    language: row.language,
    duration: formatDuration(row.duration_seconds),
    image: row.image,
    theme: row.theme,
  };
}

function toHymnDetail(row: HymnRow, editionCode = "HCASDA", publisher: string | null = null): HymnDetail {
  return {
    ...toHymn(row),
    sortNumber: row.sort_number,
    editionId: row.edition_id,
    editionCode,
    publisher,
    copyright: row.copyright,
    tune: row.tune,
    meter: row.meter,
    musicalKey: row.musical_key,
    verseCount: row.verse_count,
    lyrics: row.lyrics,
    themeSlug: row.theme_slug,
    downloadable: row.downloadable === 1,
    audioUrl: row.audio_url,
    status: row.status as HymnDetail["status"],
  };
}

const selectColumns = `
  h.id, h.number, h.sort_number, h.title, h.edition_id, h.edition, h.language, h.duration_seconds,
  (SELECT e.code FROM hymn_editions e WHERE e.id = h.edition_id) AS edition_code,
  h.image, h.theme, h.theme_slug, h.tune, h.meter, h.musical_key, h.verse_count, h.lyrics,
  h.copyright, h.audio_url, h.downloadable, h.play_count, h.status, h.created_at, h.updated_at
`;

const table = "hymns h";

function buildWhere(query: ListQuery, req: Request) {
  const where = new WhereBuilder().addPublished("h", query.includeDrafts === true);
  where.addIf(query.language, "h.language = ?", query.language);
  const edition = typeof req.query.edition === "string" ? req.query.edition : undefined;
  if (edition) where.add("(h.edition_id = ? OR h.edition = ?)", edition, edition);
  const theme = typeof req.query.theme === "string" ? req.query.theme : undefined;
  where.addIf(theme, "h.theme_slug = ?", theme);
  const number = typeof req.query.number === "string" ? req.query.number : undefined;
  where.addIf(number, "h.number = ?", number);
  where.addWhen(req.query.downloadable === "true", "h.downloadable = 1");
  where.addSearch(["h.title", "h.theme", "h.lyrics", "h.tune", "h.number"], query.q);
  return where;
}

const sortMap: Record<string, string> = {
  number: "h.sort_number",
  title: "h.title",
  theme: "h.theme",
  duration: "h.duration_seconds",
  plays: "h.play_count",
  created: "h.created_at",
  updated: "h.updated_at",
};

/**
 * `GET /api/hymns` — returns a bare `Hymn[]`, matching what the frontend's
 * `getHymns()` expects. Hymn numbers are the natural sort key, not `created_at`.
 */
export function listHymns(req: Request): { items: Hymn[]; meta: ListMeta } {
  const query = listQueryFrom(req);
  const where = buildWhere(query, req);
  const { rows, total } = paginate<HymnRow>({
    select: selectColumns,
    from: table,
    where,
    orderBy: orderBy(sortColumn(query.sort, sortMap, "h.sort_number"), query.order),
    limit: query.limit,
    offset: query.offset,
  });
  return { items: rows.map(toHymn), meta: buildMeta(total, query.limit, query.offset) };
}

export function listHymnDetails(req: Request): { items: HymnDetail[]; meta: ListMeta } {
  const query = listQueryFrom(req);
  const where = buildWhere(query, req);
  const { rows, total } = paginate<HymnRow & { edition_code: string | null; publisher: string | null }>({
    select: `${selectColumns}, e.publisher AS publisher`,
    from: `${table} LEFT JOIN hymn_editions e ON e.id = h.edition_id`,
    where,
    orderBy: orderBy(sortColumn(query.sort, sortMap, "h.sort_number"), query.order),
    limit: query.limit,
    offset: query.offset,
  });
  const items = rows.map((row) => toHymnDetail(row, row.edition_code ?? "HCASDA", row.publisher));
  return { items, meta: buildMeta(total, query.limit, query.offset) };
}

/** Resolves by id, hymn number, or `title` — all three are used in deep links. */
export function findHymn(idOrNumber: string, includeDrafts = false): HymnDetail {
  const row = get<HymnRow & { edition_code: string | null; publisher: string | null }>(
    `SELECT ${selectColumns}, e.code AS edition_code, e.publisher AS publisher
     FROM ${table}
     LEFT JOIN hymn_editions e ON e.id = h.edition_id
     WHERE (h.id = ? OR h.number = ?) AND h.deleted_at IS NULL ${includeDrafts ? "" : "AND h.status = 'published'"}`,
    [idOrNumber, idOrNumber],
  );
  if (!row) throw notFound("Hymn");
  return toHymnDetail(row, row.edition_code ?? "HCASDA", row.publisher);
}

/** Existence check that ignores publish state — used before recording a play. */
export function findHymnRow(idOrNumber: string): { id: string } {
  const row = get<{ id: string }>("SELECT id FROM hymns WHERE (id = ? OR number = ?) AND deleted_at IS NULL", [idOrNumber, idOrNumber]);
  if (!row) throw notFound("Hymn");
  return row;
}

export function incrementPlays(id: string): void {
  run("UPDATE hymns SET play_count = play_count + 1 WHERE id = ?", [id]);
}

// ─── Editions ────────────────────────────────────────────────────────────────

type EditionRow = Row & {
  id: string;
  name: string;
  code: string;
  language: string;
  year: number | null;
  publisher: string | null;
  rights: string | null;
  description: string | null;
  hymn_count: number;
};

const editionSelect = `
  e.id, e.name, e.code, e.language, e.year, e.publisher, e.rights, e.description,
  (SELECT COUNT(*) FROM hymns h WHERE h.edition_id = e.id AND h.deleted_at IS NULL) AS hymn_count
`;

function toEdition(row: EditionRow): HymnEdition {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    language: row.language,
    year: row.year === null ? null : Number(row.year),
    publisher: row.publisher,
    rights: row.rights,
    description: row.description,
    hymnCount: Number(row.hymn_count ?? 0),
  };
}

export function listEditions(): HymnEdition[] {
  return all<EditionRow>(`SELECT ${editionSelect} FROM hymn_editions e ORDER BY e.year, e.name`).map(toEdition);
}

export function findEdition(codeOrId: string): HymnEdition {
  const row = get<EditionRow>(`SELECT ${editionSelect} FROM hymn_editions e WHERE e.id = ? OR e.code = ?`, [codeOrId, codeOrId]);
  if (!row) throw notFound("Hymn edition");
  return toEdition(row);
}

// ─── Themes & tunes ──────────────────────────────────────────────────────────

/**
 * `GET /api/hymns/themes` — distinct themes with counts, for the browse cards.
 *
 * Scoped to a language when one is given, so picking Kiswahili shows only the
 * Kiswahili hymns under each theme. Without a language the rows are aggregated by
 * slug instead, because each edition names the same theme in its own language and
 * grouping by the display name would split one theme into a dozen near-empty cards.
 *
 * `GET /api/hymns/tunes` — the tune/meter/key metadata the sheet-music view
 * reads, aggregated so the frontend does not have to load every hymn to draw it.
 */
export function listThemes(language?: string): { theme: string; slug: string | null; count: number }[] {
  const scoped = language?.trim();
  if (scoped) {
    return all<{ theme: string; slug: string | null; count: number }>(
      `SELECT theme, theme_slug AS slug, COUNT(*) AS count
       FROM hymns
       WHERE deleted_at IS NULL AND status = 'published' AND language = ?
         AND theme IS NOT NULL AND TRIM(theme) != ''
       GROUP BY theme, theme_slug
       ORDER BY count DESC, theme`,
      [scoped],
    );
  }
  return all<{ theme: string; slug: string | null; count: number }>(
    `SELECT MIN(theme) AS theme, theme_slug AS slug, COUNT(*) AS count
     FROM hymns
     WHERE deleted_at IS NULL AND status = 'published'
       AND theme IS NOT NULL AND TRIM(theme) != ''
     GROUP BY theme_slug
     ORDER BY count DESC, theme`,
  ).map((row) => ({
    ...row,
    // Fall back to the config's canonical name so an all-languages card is not
    // labelled with whichever translation happens to sort first.
    theme: (row.slug ? configuredThemeName(row.slug) : undefined) ?? row.theme ?? "",
  }));
}

export function listTunes(): { tune: string; meter: string | null; musicalKey: string | null; count: number }[] {
  return all<{ tune: string; meter: string | null; musical_key: string | null; count: number }>(
    `SELECT tune, meter, musical_key, COUNT(*) AS count
     FROM hymns
     WHERE deleted_at IS NULL AND status = 'published' AND tune IS NOT NULL AND tune != ''
     GROUP BY tune, meter, musical_key
     ORDER BY count DESC, tune`,
  ).map((row) => ({ tune: row.tune, meter: row.meter, musicalKey: row.musical_key, count: Number(row.count) }));
}

// ─── Write operations ────────────────────────────────────────────────────────

export const hymnInputSchema = z.object({
  number: z.string().trim().min(1).max(20),
  title: z.string().trim().min(1).max(200),
  editionId: z.string().trim().max(120).default(""),
  edition: z.string().trim().max(200).default(""),
  language: z.string().trim().min(2).max(40).default("English"),
  duration: z.string().trim().max(20).optional(),
  durationSeconds: z.number().int().min(0).max(3600).optional(),
  image: z.string().trim().max(400).default(""),
  theme: z.string().trim().max(80).default("Worship"),
  themeSlug: z.string().trim().max(96).nullable().optional(),
  tune: z.string().trim().max(120).nullable().optional(),
  meter: z.string().trim().max(40).nullable().optional(),
  musicalKey: z.string().trim().max(20).nullable().optional(),
  verseCount: z.number().int().min(0).max(200).default(0),
  lyrics: z.string().max(100_000).nullable().optional(),
  copyright: z.string().trim().max(400).nullable().optional(),
  audioUrl: z.string().trim().max(600).nullable().optional(),
  downloadable: z.boolean().default(false),
  status: z.enum(["draft", "published", "archived"]).default("published"),
  id: z.string().trim().max(120).optional(),
});

export type HymnInput = z.output<typeof hymnInputSchema>;

/** The edition is required by the schema, so resolve the name/label on write. */
function resolveEdition(input: Pick<HymnInput, "editionId" | "edition">): { id: string; name: string } {
  const id = input.editionId || input.edition;
  const row = get<{ id: string; name: string }>("SELECT id, name FROM hymn_editions WHERE id = ? OR code = ? OR name = ?", [id, id, id]);
  if (!row) throw unprocessable(`Unknown hymn edition "${id}"`, { field: "editionId" });
  return { id: row.id, name: row.name };
}

function resolveDuration(input: HymnInput): number {
  if (input.durationSeconds !== undefined) return input.durationSeconds;
  const parsed = parseDurationToSeconds(input.duration);
  return parsed ?? 0;
}

function uniqueHymnId(input: HymnInput, editionId: string): string {
  const id = input.id ?? newId();
  const clash = get<{ id: string }>("SELECT id FROM hymns WHERE id = ? OR (edition_id = ? AND number = ?)", [id, editionId, input.number]);
  if (!clash) return id;
  if (clash.id === id) return id;
  throw unprocessable(`Hymn "${input.number}" already exists in this edition`, { field: "number" });
}

export function createHymn(input: HymnInput): HymnDetail {
  const edition = resolveEdition(input);
  const id = uniqueHymnId(input, edition.id);
  run(
    `INSERT INTO hymns (id, number, sort_number, title, edition_id, edition, language, duration_seconds,
                        image, theme, theme_slug, tune, meter, musical_key, verse_count, lyrics,
                        copyright, audio_url, downloadable, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.number,
      Number.parseInt(input.number, 10) || 0,
      input.title,
      edition.id,
      edition.name,
      input.language,
      resolveDuration(input),
      input.image,
      input.theme,
      input.themeSlug ?? null,
      input.tune ?? null,
      input.meter ?? null,
      input.musicalKey ?? null,
      input.verseCount,
      input.lyrics ?? null,
      input.copyright ?? null,
      input.audioUrl ?? null,
      input.downloadable ? 1 : 0,
      input.status,
    ],
  );
  return findHymn(id, true);
}

export function updateHymn(id: string, input: Partial<HymnInput>): HymnDetail {
  findHymn(id, true);
  const map: Record<string, string> = {
    number: "number",
    sortNumber: "sort_number",
    title: "title",
    language: "language",
    image: "image",
    theme: "theme",
    themeSlug: "theme_slug",
    tune: "tune",
    meter: "meter",
    musicalKey: "musical_key",
    verseCount: "verse_count",
    lyrics: "lyrics",
    copyright: "copyright",
    audioUrl: "audio_url",
    status: "status",
  };
  const booleanMap: Record<string, string> = { downloadable: "downloadable" };
  const assignments: string[] = [];
  const params: (string | number | null)[] = [];

  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || key === "id" || key === "edition" || key === "editionId") continue;
    if (key === "duration" || key === "durationSeconds") continue;
    if (booleanMap[key]) {
      assignments.push(`${booleanMap[key]} = ?`);
      params.push(value ? 1 : 0);
      continue;
    }
    const column = map[key];
    if (!column) continue;
    assignments.push(`${column} = ?`);
    params.push(value as string | number | null);
  }

  if (input.number !== undefined) {
    assignments.push("sort_number = ?");
    params.push(Number.parseInt(input.number, 10) || 0);
  }
  if (input.duration !== undefined || input.durationSeconds !== undefined) {
    const seconds = input.durationSeconds ?? parseDurationToSeconds(input.duration);
    assignments.push("duration_seconds = ?");
    params.push(seconds ?? 0);
  }
  if (input.editionId !== undefined || (input.edition !== undefined && input.edition !== "")) {
    const edition = resolveEdition({ editionId: input.editionId ?? "", edition: input.edition ?? "" });
    assignments.push("edition_id = ?", "edition = ?");
    params.push(edition.id, edition.name);
  }

  if (assignments.length > 0) {
    params.push(id);
    run(`UPDATE hymns SET ${assignments.join(", ")}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`, params);
  }
  return findHymn(id, true);
}

export function deleteHymn(id: string): void {
  const result = run("UPDATE hymns SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND deleted_at IS NULL", [id]);
  if (result.changes === 0) throw notFound("Hymn");
}

export function restoreHymn(id: string): void {
  const result = run("UPDATE hymns SET deleted_at = NULL WHERE id = ?", [id]);
  if (result.changes === 0) throw notFound("Hymn");
}
