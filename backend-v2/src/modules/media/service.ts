import { z } from "zod";
import type { Request } from "express";
import { all, get, run, placeholders, type Row } from "../../db/client.ts";
import { notFound, unprocessable } from "../../lib/errors.ts";
import { WhereBuilder, orderBy, paginate } from "../../lib/sql.ts";
import { listQueryFrom, sortColumn } from "../../lib/query.ts";
import { buildMeta, newId, slugify } from "../../lib/http.ts";
import { formatDuration } from "../../lib/time.ts";
import { toTrack, toTrackDetail, type TrackRow } from "../tracks/service.ts";
import type { Album, Collection, Track, TrackDetail } from "../../types/domain.ts";
import type { ListMeta } from "../../types/api.ts";

// ─── Albums ──────────────────────────────────────────────────────────────────

type AlbumRow = Row & {
  id: string;
  title: string;
  artist: string;
  cover_url: string | null;
  release_date: string | null;
  description: string | null;
  kind: string;
  track_count: number;
  created_at: string;
};

function toAlbum(row: AlbumRow): Album {
  return {
    id: row.id,
    title: row.title,
    artist: row.artist,
    coverUrl: row.cover_url,
    releaseDate: row.release_date,
    description: row.description,
    kind: row.kind as Album["kind"],
    trackCount: Number(row.track_count ?? 0),
  };
}

const albumSelect = `
  a.id, a.title, a.artist, a.cover_url, a.release_date, a.description, a.kind, a.created_at,
  (SELECT COUNT(*) FROM tracks t WHERE t.album_id = a.id AND t.deleted_at IS NULL) AS track_count
`;

export function listAlbums(req: Request): { items: Album[]; meta: ListMeta } {
  const query = listQueryFrom(req);
  const where = new WhereBuilder();
  where.addSearch(["a.title", "a.artist", "a.description"], query.q);
  const sortMap: Record<string, string> = { title: "a.title", artist: "a.artist", release: "a.release_date", created: "a.created_at" };
  const { rows, total } = paginate<AlbumRow>({
    select: albumSelect,
    from: "albums a",
    where,
    orderBy: orderBy(sortColumn(query.sort, sortMap, "a.created_at"), query.order),
    limit: query.limit,
    offset: query.offset,
  });
  return { items: rows.map(toAlbum), meta: buildMeta(total, query.limit, query.offset) };
}

export function findAlbum(id: string): Album {
  const row = get<AlbumRow>(`SELECT ${albumSelect} FROM albums a WHERE a.id = ?`, [id]);
  if (!row) throw notFound("Album");
  return toAlbum(row);
}

export const albumInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  artist: z.string().trim().max(200).default(""),
  coverUrl: z.string().trim().max(400).nullable().optional(),
  releaseDate: z.string().trim().max(40).nullable().optional(),
  description: z.string().max(4000).nullable().optional(),
  kind: z.enum(["audio", "video", "hymn", "sermon"]).default("audio"),
  id: z.string().trim().max(120).optional(),
});

export type AlbumInput = z.output<typeof albumInputSchema>;

export function createAlbum(input: AlbumInput): Album {
  const id = input.id ?? newId();
  if (get("SELECT 1 FROM albums WHERE id = ?", [id])) {
    throw unprocessable(`An album with the id "${id}" already exists`, { field: "id" });
  }
  run(
    `INSERT INTO albums (id, title, artist, cover_url, release_date, description, kind)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, input.title, input.artist, input.coverUrl ?? null, input.releaseDate ?? null, input.description ?? null, input.kind],
  );
  return findAlbum(id);
}

export function updateAlbum(id: string, input: Partial<AlbumInput>): Album {
  findAlbum(id);
  const map: Record<string, string> = {
    title: "title",
    artist: "artist",
    coverUrl: "cover_url",
    releaseDate: "release_date",
    description: "description",
    kind: "kind",
  };
  const assignments: string[] = [];
  const params: (string | null)[] = [];
  for (const [key, value] of Object.entries(input)) {
    const column = map[key];
    if (!column || value === undefined || key === "id") continue;
    assignments.push(`${column} = ?`);
    params.push(value as string | null);
  }
  if (assignments.length > 0) {
    params.push(id);
    run(`UPDATE albums SET ${assignments.join(", ")}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`, params);
  }
  return findAlbum(id);
}

export function deleteAlbum(id: string): void {
  const result = run("DELETE FROM albums WHERE id = ?", [id]);
  if (result.changes === 0) throw notFound("Album");
}

// ─── Collections ─────────────────────────────────────────────────────────────

type CollectionRow = Row & {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  image: string;
  kind: string;
  tone: string | null;
  curator: string | null;
  featured: number;
  item_count: number;
  created_at: string;
};

/** Collections always serialise their tracks; the list view needs the covers. */
function toCollection(row: CollectionRow, items: Track[]): Collection {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    description: row.description,
    image: row.image || items[0]?.image || "",
    itemCount: Number(row.item_count ?? items.length),
    curator: row.curator,
    kind: row.kind as Collection["kind"],
    tone: row.tone,
    items,
  };
}

const collectionSelect = `
  c.id, c.title, c.slug, c.description, c.image, c.kind, c.tone, c.curator, c.featured,
  c.item_count, c.created_at
`;

/**
 * Loads the ordered tracks for many collections in one query.
 *
 * A per-collection `WHERE collection_id IN (...)` beats N round trips, and the
 * `ROW_NUMBER`-free `GROUP_CONCAT` trick would lose the row→collection mapping,
 * so the rows are simply bucketed in JS.
 */
function tracksForCollections(collectionIds: string[]): Map<string, Track[]> {
  const map = new Map<string, Track[]>();
  if (collectionIds.length === 0) return map;
  const rows = all<TrackRow & { position: number }>(
    `SELECT t.id, t.title, t.artist, t.album, t.album_id, t.image, t.audio_url, t.video_url, t.stream_url,
            t.duration_seconds, t.language, t.kind, t.genre, t.mood, t.is_live, t.live_status,
            t.captions_available, t.downloadable, t.is_explicit, t.featured, t.play_count, t.like_count,
            t.release_date, t.lyrics, t.credits, t.view_count, t.status, t.published_at,
            t.created_at, t.updated_at, ci.collection_id
     FROM collection_items ci
     JOIN tracks t ON t.id = ci.track_id AND t.deleted_at IS NULL
     WHERE ci.collection_id IN (${placeholders(collectionIds.length)})
     ORDER BY ci.collection_id, ci.position`,
    collectionIds,
  );
  for (const row of rows) {
    const key = String(row.collection_id);
    const bucket = map.get(key);
    if (bucket) bucket.push(toTrack(row));
    else map.set(key, [toTrack(row)]);
  }
  return map;
}

export function listCollections(req: Request): { items: Collection[]; meta: ListMeta } {
  const query = listQueryFrom(req);
  const where = new WhereBuilder();
  const kind = typeof req.query.kind === "string" ? req.query.kind : undefined;
  const tone = typeof req.query.tone === "string" ? req.query.tone : undefined;
  where.addIf(kind, "c.kind = ?", kind);
  where.addIf(tone, "c.tone = ?", tone);
  where.addWhen(req.query.featured === "true", "c.featured = 1");
  where.addSearch(["c.title", "c.description", "c.curator", "c.tone"], query.q);
  const sortMap: Record<string, string> = { title: "c.title", created: "c.created_at", items: "c.item_count" };
  const { rows, total } = paginate<CollectionRow>({
    select: collectionSelect,
    from: "collections c",
    where,
    orderBy: orderBy(sortColumn(query.sort, sortMap, "c.created_at"), query.order),
    limit: query.limit,
    offset: query.offset,
  });
  const tracks = tracksForCollections(rows.map((row) => String(row.id)));
  const items = rows.map((row) => toCollection(row, tracks.get(String(row.id)) ?? []));
  return { items, meta: buildMeta(total, query.limit, query.offset) };
}

/** Resolves a collection by slug first, then by id — the frontend links by slug. */
export function findCollection(idOrSlug: string): Collection {
  const row = get<CollectionRow>(`SELECT ${collectionSelect} FROM collections c WHERE c.id = ? OR c.slug = ?`, [idOrSlug, idOrSlug]);
  if (!row) throw notFound("Collection");
  const tracks = tracksForCollections([String(row.id)]);
  return toCollection(row, tracks.get(String(row.id)) ?? []);
}

export const collectionInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(4000).nullable().optional(),
  image: z.string().trim().max(400).default(""),
  kind: z.enum(["music", "video", "mixed"]).default("music"),
  tone: z.string().trim().max(80).nullable().optional(),
  curator: z.string().trim().max(160).nullable().optional(),
  featured: z.boolean().default(false),
  trackIds: z.array(z.string().trim().max(120)).max(200).default([]),
  id: z.string().trim().max(120).optional(),
});

export type CollectionInput = z.output<typeof collectionInputSchema>;

function syncItems(collectionId: string, trackIds: string[]): void {
  run("DELETE FROM collection_items WHERE collection_id = ?", [collectionId]);
  const unique = [...new Set(trackIds)];
  unique.forEach((trackId, position) => {
    run(
      "INSERT INTO collection_items (id, collection_id, track_id, position) VALUES (?, ?, ?, ?)",
      [newId(), collectionId, trackId, position],
    );
  });
  run("UPDATE collections SET item_count = ? WHERE id = ?", [unique.length, collectionId]);
}

export function createCollection(input: CollectionInput): Collection {
  const id = input.id ?? newId();
  const slug = slugify(input.title);
  if (!slug) throw unprocessable("The title must contain at least one letter or digit", { field: "title" });
  if (get("SELECT 1 FROM collections WHERE id = ? OR slug = ?", [id, slug])) {
    throw unprocessable("A collection with that title or id already exists", { field: "title" });
  }
  run(
    `INSERT INTO collections (id, title, slug, description, image, kind, tone, curator, featured, item_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    [id, input.title, slug, input.description ?? null, input.image, input.kind, input.tone ?? null, input.curator ?? null, input.featured ? 1 : 0],
  );
  syncItems(id, input.trackIds);
  return findCollection(id);
}

export function updateCollection(id: string, input: Partial<CollectionInput>): Collection {
  findCollection(id);
  const map: Record<string, string> = {
    title: "title",
    description: "description",
    image: "image",
    kind: "kind",
    tone: "tone",
    curator: "curator",
  };
  const assignments: string[] = [];
  const params: (string | number | null)[] = [];
  for (const [key, value] of Object.entries(input)) {
    if (key === "id" || key === "trackIds" || value === undefined) continue;
    if (key === "featured") {
      assignments.push("featured = ?");
      params.push(value ? 1 : 0);
      continue;
    }
    const column = map[key];
    if (!column) continue;
    assignments.push(`${column} = ?`);
    params.push(value as string | null);
  }
  if (input.title !== undefined) {
    const slug = slugify(input.title);
    if (!slug) throw unprocessable("The title must contain at least one letter or digit", { field: "title" });
    assignments.push("slug = ?");
    params.push(slug);
  }
  if (assignments.length > 0) {
    params.push(id);
    run(`UPDATE collections SET ${assignments.join(", ")}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`, params);
  }
  if (input.trackIds !== undefined) syncItems(id, input.trackIds);
  return findCollection(id);
}

export function deleteCollection(id: string): void {
  const result = run("DELETE FROM collections WHERE id = ?", [id]);
  if (result.changes === 0) throw notFound("Collection");
}

export function addTrackToCollection(idOrSlug: string, trackId: string): Collection {
  const collection = get<{ id: string }>("SELECT id FROM collections WHERE id = ? OR slug = ?", [idOrSlug, idOrSlug]);
  if (!collection) throw notFound("Collection");
  if (!get("SELECT 1 FROM tracks WHERE id = ? AND deleted_at IS NULL", [trackId])) throw notFound("Track");
  const next = Number(
    pluckPosition(collection.id) ?? 0,
  );
  run(
    `INSERT INTO collection_items (id, collection_id, track_id, position) VALUES (?, ?, ?, ?)
     ON CONFLICT(collection_id, track_id) DO NOTHING`,
    [newId(), collection.id, trackId, next],
  );
  recount(collection.id);
  return findCollection(collection.id);
}

function pluckPosition(collectionId: string): number | null {
  const row = get<{ next: number | null }>("SELECT MAX(position) + 1 AS next FROM collection_items WHERE collection_id = ?", [collectionId]);
  return row?.next ?? null;
}

function recount(collectionId: string): void {
  run("UPDATE collections SET item_count = (SELECT COUNT(*) FROM collection_items WHERE collection_id = ?) WHERE id = ?", [
    collectionId,
    collectionId,
  ]);
}

export function removeTrackFromCollection(idOrSlug: string, trackId: string): Collection {
  const collection = get<{ id: string }>("SELECT id FROM collections WHERE id = ? OR slug = ?", [idOrSlug, idOrSlug]);
  if (!collection) throw notFound("Collection");
  run("DELETE FROM collection_items WHERE collection_id = ? AND track_id = ?", [collection.id, trackId]);
  recount(collection.id);
  return findCollection(collection.id);
}

// ─── Videos ──────────────────────────────────────────────────────────────────

/**
 * Videos are tracks with `kind = 'video'`, not a separate table.
 *
 * The player page and the `/videos` tab both query the same rows, so a video is
 * a filtered view over `tracks` rather than a parallel entity that would drift.
 */
export function listVideos(req: Request): { items: TrackDetail[]; meta: ListMeta } {
  const query = listQueryFrom(req);
  const where = new WhereBuilder().addPublished("t", query.includeDrafts === true);
  where.add("t.kind = 'video'");
  where.addIf(query.language, "t.language = ?", query.language);
  const category = typeof req.query.category === "string" ? req.query.category : undefined;
  where.addIf(category, "t.genre = ?", category);
  where.addWhen(req.query.live === "true", "t.is_live = 1");
  where.addSearch(["t.title", "t.artist", "t.album", "t.genre", "t.lyrics"], query.q);
  const sortMap: Record<string, string> = {
    title: "t.title",
    artist: "t.artist",
    duration: "t.duration_seconds",
    views: "t.view_count",
    plays: "t.play_count",
    release: "t.release_date",
    created: "t.created_at",
  };
  const select = `
    t.id, t.title, t.artist, t.album, t.album_id, t.image, t.audio_url, t.video_url, t.stream_url,
    t.duration_seconds, t.language, t.kind, t.genre, t.mood, t.is_live, t.live_status,
    t.captions_available, t.downloadable, t.is_explicit, t.featured, t.play_count, t.like_count,
    t.release_date, t.lyrics, t.credits, t.view_count, t.status, t.published_at,
    t.created_at, t.updated_at
  `;
  const { rows, total } = paginate<TrackRow>({
    select,
    from: "tracks t",
    where,
    orderBy: orderBy(sortColumn(query.sort, sortMap, "t.created_at"), query.order),
    limit: query.limit,
    offset: query.offset,
  });
  return { items: rows.map(toTrackDetail), meta: buildMeta(total, query.limit, query.offset) };
}

/** `GET /api/videos/:id` — a single video, or 404 when the id is audio-only. */
export function findVideo(id: string, includeDrafts = false): TrackDetail {
  const row = get<TrackRow>(
    `SELECT t.id, t.title, t.artist, t.album, t.album_id, t.image, t.audio_url, t.video_url, t.stream_url,
            t.duration_seconds, t.language, t.kind, t.genre, t.mood, t.is_live, t.live_status,
            t.captions_available, t.downloadable, t.is_explicit, t.featured, t.play_count, t.like_count,
            t.release_date, t.lyrics, t.credits, t.view_count, t.status, t.published_at,
            t.created_at, t.updated_at
     FROM tracks t
     WHERE t.id = ? AND t.kind = 'video' AND t.deleted_at IS NULL ${includeDrafts ? "" : "AND t.status = 'published'"}`,
    [id],
  );
  if (!row) throw notFound("Video");
  return toTrackDetail(row);
}

export function videoFacets(): { categories: string[]; languages: string[] } {
  const distinct = (column: string) =>
    all<{ value: string }>(
      `SELECT DISTINCT ${column} AS value FROM tracks
       WHERE kind = 'video' AND deleted_at IS NULL AND status = 'published'
         AND ${column} IS NOT NULL AND ${column} != '' ORDER BY ${column}`,
    ).map((row) => row.value);
  return { categories: distinct("genre"), languages: distinct("language") };
}

/** Duration helper re-exported so routes can format without importing `time`. */
export { formatDuration };
