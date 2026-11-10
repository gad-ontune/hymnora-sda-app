import { z } from "zod";
import { all, get, run, type Params, type Row } from "../../db/client.ts";
import { notFound, unprocessable } from "../../lib/errors.ts";
import { WhereBuilder, orderBy, paginate, selectList } from "../../lib/sql.ts";
import { listQueryFrom, sortColumn } from "../../lib/query.ts";
import { buildMeta, newId } from "../../lib/http.ts";
import { formatDuration, parseDurationToSeconds } from "../../lib/time.ts";
import { parseJson, toBoolean } from "../../lib/text.ts";
import { placeholders } from "../../db/client.ts";
import type { Request } from "express";
import type { Track, TrackDetail, MediaKind, PublishStatus } from "../../types/domain.ts";
import type { ListMeta, TrackFilters } from "../../types/api.ts";

export type TrackRow = Row & {
  id: string;
  title: string;
  artist: string;
  album: string;
  album_id: string | null;
  image: string;
  audio_url: string | null;
  video_url: string | null;
  stream_url: string | null;
  duration_seconds: number;
  language: string;
  kind: string;
  genre: string | null;
  mood: string | null;
  is_live: number;
  live_status: string | null;
  captions_available: number;
  downloadable: number;
  is_explicit: number;
  featured: number;
  play_count: number;
  like_count: number;
  release_date: string | null;
  lyrics: string | null;
  credits: string;
  view_count: number;
  status: string;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  youtube_video_id: string | null;
  sub_category: string | null;
};

/** Column list only — callers supply their own `SELECT` / pass to `paginate`. */
const selectColumns = `
  t.id, t.title, t.artist, t.album, t.album_id, t.image, t.audio_url, t.video_url, t.stream_url,
  t.duration_seconds, t.language, t.kind, t.genre, t.mood, t.is_live, t.live_status,
  t.captions_available, t.downloadable, t.is_explicit, t.featured, t.play_count, t.like_count,
  t.release_date, t.lyrics, t.credits, t.view_count, t.status, t.published_at,
  t.created_at, t.updated_at, t.youtube_video_id, t.sub_category
`;

const table = "tracks t";

/** The shape the frontend consumes — identical to `lib/types.ts` in the app. */
export function toTrack(row: TrackRow): Track {
  return {
    id: row.id,
    title: row.title,
    artist: row.artist,
    album: row.album,
    image: row.image,
    duration: formatDuration(row.duration_seconds),
    language: row.language,
    kind: row.kind as MediaKind,
    youtubeVideoId: row.youtube_video_id,
    subCategory: row.sub_category,
  };
}

export function toTrackDetail(row: TrackRow): TrackDetail {
  return {
    ...toTrack(row),
    albumId: row.album_id,
    audioUrl: row.audio_url,
    videoUrl: row.video_url,
    streamUrl: row.stream_url,
    durationSeconds: row.duration_seconds,
    genre: row.genre,
    mood: row.mood,
    isLive: row.is_live === 1,
    liveStatus: row.live_status,
    captionsAvailable: row.captions_available === 1,
    downloadable: row.downloadable === 1,
    isExplicit: row.is_explicit === 1,
    featured: row.featured === 1,
    playCount: row.play_count,
    likeCount: row.like_count,
    releaseDate: row.release_date,
    lyrics: row.lyrics,
    credits: parseJson<{ role: string; name: string }[]>(row.credits, []),
    status: row.status as PublishStatus,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Adds a `progress` hint so the home page can show "continue listening". */
export function toTrackWithProgress(row: TrackRow, progress = 0): Track {
  return { ...toTrack(row), progress: Math.max(0, Math.min(100, Math.round(progress))) };
}

const sortMap: Record<string, string> = {
  title: "t.title",
  artist: "t.artist",
  album: "t.album",
  duration: "t.duration_seconds",
  language: "t.language",
  kind: "t.kind",
  plays: "t.play_count",
  likes: "t.like_count",
  views: "t.view_count",
  release: "t.release_date",
  created: "t.created_at",
  updated: "t.updated_at",
};

function buildWhere(req: Request, filters: TrackFilters): WhereBuilder {
  const where = new WhereBuilder().addPublished("t", filters.includeDrafts === true);
  where.addIf(filters.kind, "t.kind = ?", filters.kind);
  where.addIf(filters.language, "t.language = ?", filters.language);
  where.addIf(filters.artist, "t.artist = ?", filters.artist);
  where.addIf(filters.albumId, "t.album_id = ?", filters.albumId);
  where.addIf(filters.genre, "t.genre = ?", filters.genre);
  where.addIf(filters.mood, "t.mood = ?", filters.mood);
  where.addWhen(filters.downloadable === true, "t.downloadable = 1");
  if (filters.downloadable === false) where.add("t.downloadable = 0");
  where.addWhen(filters.featured === true, "t.featured = 1");
  if (filters.featured === false) where.add("t.featured = 0");
  where.addWhen(filters.live === true, "t.is_live = 1");
  if (filters.live === false) where.add("t.is_live = 0");
  if (filters.collectionId) {
    where.add("t.id IN (SELECT track_id FROM collection_items WHERE collection_id = ?)", filters.collectionId);
  }
  where.addSearch(["t.title", "t.artist", "t.album", "t.genre", "t.mood", "t.lyrics"], filters.q);
  return where;
}

function parseFilters(req: Request) {
  const base = listQueryFrom(req);
  const flag = (value: unknown) => (value === undefined || value === "" ? undefined : toBoolean(value));
  return {
    ...base,
    kind: typeof req.query.kind === "string" ? (req.query.kind as MediaKind) : undefined,
    albumId: typeof req.query.albumId === "string" ? req.query.albumId : undefined,
    artist: typeof req.query.artist === "string" ? req.query.artist : undefined,
    genre: typeof req.query.genre === "string" ? req.query.genre : undefined,
    mood: typeof req.query.mood === "string" ? req.query.mood : undefined,
    collectionId: typeof req.query.collectionId === "string" ? req.query.collectionId : undefined,
    downloadable: flag(req.query.downloadable),
    featured: flag(req.query.featured),
    live: flag(req.query.live),
  } satisfies TrackFilters;
}

export function listTracks(req: Request): { items: Track[]; meta: ListMeta } {
  const filters = parseFilters(req);
  const where = buildWhere(req, filters);
  const column = sortColumn(filters.sort, sortMap, "t.created_at");
  const { rows, total } = paginate<TrackRow>({
    select: selectColumns,
    from: table,
    where,
    orderBy: orderBy(column, filters.order),
    limit: filters.limit,
    offset: filters.offset,
    countExpression: `SELECT 1`,
  });
  return { items: rows.map(toTrack), meta: buildMeta(total, filters.limit, filters.offset) };
}

export function listTrackDetails(req: Request): { items: TrackDetail[]; meta: ListMeta } {
  const filters = parseFilters(req);
  const where = buildWhere(req, filters);
  const column = sortColumn(filters.sort, sortMap, "t.created_at");
  const { rows, total } = paginate<TrackRow>({
    select: selectColumns,
    from: table,
    where,
    orderBy: orderBy(column, filters.order),
    limit: filters.limit,
    offset: filters.offset,
    countExpression: `SELECT 1`,
  });
  return { items: rows.map(toTrackDetail), meta: buildMeta(total, filters.limit, filters.offset) };
}

export function findTrack(id: string, includeDrafts = false): TrackDetail {
  const row = get<TrackRow>(
    `${selectList(selectColumns)} FROM ${table} WHERE t.id = ? AND t.deleted_at IS NULL ${includeDrafts ? "" : "AND t.status = 'published'"}`,
    [id],
  );
  if (!row) throw notFound("Track");
  return toTrackDetail(row);
}

export function findTrackRow(id: string): TrackRow {
  const row = get<TrackRow>(`${selectList(selectColumns)} FROM ${table} WHERE t.id = ? AND t.deleted_at IS NULL`, [id]);
  if (!row) throw notFound("Track");
  return row;
}

export function trackExists(id: string): boolean {
  return Boolean(get("SELECT 1 FROM tracks WHERE id = ? AND deleted_at IS NULL", [id]));
}

/** `/api/tracks/:id/related` — same artist, album, genre or explicit link. */
export function relatedTracks(id: string, limit = 8): Track[] {
  const anchor = get<Row & { artist: string; album_id: string | null; genre: string | null; mood: string | null }>(
    "SELECT artist, album_id, genre, mood FROM tracks WHERE id = ?",
    [id],
  );
  if (!anchor) throw notFound("Track");

  const linked = all<{ track_id: string }>(
    `SELECT to_id AS track_id FROM content_links
     WHERE from_type = 'track' AND from_id = ? AND to_type = 'track'
     ORDER BY position LIMIT ?`,
    [id, limit],
  );
  const linkedIds = linked.map((row) => row.track_id);

  const params: Params = [anchor.artist, anchor.album_id, anchor.genre, anchor.mood];
  const exclude = linkedIds.length > 0 ? ` AND t.id NOT IN (${placeholders(linkedIds.length)})` : "";
  params.push(...linkedIds);

  const rows = all<TrackRow>(
    `${selectList(selectColumns)} FROM ${table}
     WHERE t.deleted_at IS NULL AND t.status = 'published' AND t.id != ?
       AND (t.artist = ? OR t.album_id IS ? AND t.album_id IS NOT NULL OR t.genre IS ? AND t.genre IS NOT NULL OR t.mood IS ? AND t.mood IS NOT NULL)${exclude}
     ORDER BY t.play_count DESC, t.created_at DESC
     LIMIT ?`,
    [id, ...params, limit],
  );
  return rows.map(toTrack);
}

/** Content ids only — used to hydrate library items without extra round trips. */
export function trackIdsFor(ids: string[]): Set<string> {
  if (ids.length === 0) return new Set();
  const rows = all<{ id: string }>(
    `SELECT id FROM tracks WHERE deleted_at IS NULL AND id IN (${placeholders(ids.length)})`,
    ids,
  );
  return new Set(rows.map((row) => row.id));
}

export function incrementPlays(id: string): void {
  run("UPDATE tracks SET play_count = play_count + 1 WHERE id = ?", [id]);
}

export function incrementViews(id: string): void {
  run("UPDATE tracks SET view_count = view_count + 1 WHERE id = ?", [id]);
}

// ─── Write operations (admin) ────────────────────────────────────────────────

export const trackInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  artist: z.string().trim().max(200).default(""),
  album: z.string().trim().max(200).default(""),
  albumId: z.string().trim().max(120).nullable().optional(),
  image: z.string().trim().max(400).default(""),
  audioUrl: z.string().trim().max(600).nullable().optional(),
  videoUrl: z.string().trim().max(600).nullable().optional(),
  streamUrl: z.string().trim().max(600).nullable().optional(),
  duration: z.string().trim().max(20).optional(),
  durationSeconds: z.number().int().min(0).max(86_400).optional(),
  language: z.string().trim().min(2).max(40).default("English"),
  kind: z.enum(["audio", "video", "hymn", "sermon"]).default("audio"),
  genre: z.string().trim().max(80).nullable().optional(),
  mood: z.string().trim().max(80).nullable().optional(),
  isLive: z.boolean().default(false),
  liveStatus: z.string().trim().max(40).nullable().optional(),
  captionsAvailable: z.boolean().default(false),
  downloadable: z.boolean().default(false),
  isExplicit: z.boolean().default(false),
  featured: z.boolean().default(false),
  releaseDate: z.string().trim().max(40).nullable().optional(),
  lyrics: z.string().max(20_000).nullable().optional(),
  credits: z.array(z.object({ role: z.string().max(80), name: z.string().max(120) })).max(20).default([]),
  status: z.enum(["draft", "published", "archived"]).default("published"),
  id: z.string().trim().max(120).optional(),
});

export type TrackInput = z.output<typeof trackInputSchema>;

function resolveDuration(input: TrackInput): number {
  if (input.durationSeconds !== undefined) return input.durationSeconds;
  const parsed = parseDurationToSeconds(input.duration);
  if (parsed === null) throw unprocessable("Provide durationSeconds or a duration like \"4:18\"");
  return parsed;
}

export function createTrack(input: TrackInput, createdBy: string | null): TrackDetail {
  const id = input.id ?? newId();
  if (trackExists(id)) throw unprocessable(`A track with the id "${id}" already exists`, { field: "id" });
  run(
    `INSERT INTO tracks (id, title, artist, album, album_id, image, audio_url, video_url, stream_url,
                         duration_seconds, language, kind, genre, mood, is_live, live_status,
                         captions_available, downloadable, is_explicit, featured, release_date,
                         lyrics, credits, status, published_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.title,
      input.artist,
      input.album,
      input.albumId ?? null,
      input.image,
      input.audioUrl ?? null,
      input.videoUrl ?? null,
      input.streamUrl ?? null,
      resolveDuration(input),
      input.language,
      input.kind,
      input.genre ?? null,
      input.mood ?? null,
      input.isLive ? 1 : 0,
      input.liveStatus ?? null,
      input.captionsAvailable ? 1 : 0,
      input.downloadable ? 1 : 0,
      input.isExplicit ? 1 : 0,
      input.featured ? 1 : 0,
      input.releaseDate ?? null,
      input.lyrics ?? null,
      JSON.stringify(input.credits),
      input.status,
      input.status === "published" ? new Date().toISOString() : null,
      createdBy,
    ],
  );
  return findTrack(id, true);
}

export function updateTrack(id: string, input: Partial<TrackInput>): TrackDetail {
  findTrackRow(id);
  const map: Record<string, string> = {
    title: "title",
    artist: "artist",
    album: "album",
    albumId: "album_id",
    image: "image",
    audioUrl: "audio_url",
    videoUrl: "video_url",
    streamUrl: "stream_url",
    language: "language",
    kind: "kind",
    genre: "genre",
    mood: "mood",
    liveStatus: "live_status",
    releaseDate: "release_date",
    lyrics: "lyrics",
    status: "status",
  };
  const booleanMap: Record<string, string> = {
    isLive: "is_live",
    captionsAvailable: "captions_available",
    downloadable: "downloadable",
    isExplicit: "is_explicit",
    featured: "featured",
  };

  const assignments: string[] = [];
  const params: (string | number | null)[] = [];

  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    if (key === "id") continue;
    if (key === "credits") {
      assignments.push("credits = ?");
      params.push(JSON.stringify(value));
      continue;
    }
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

  if (input.duration !== undefined || input.durationSeconds !== undefined) {
    const seconds = input.durationSeconds ?? parseDurationToSeconds(input.duration);
    if (seconds === null) throw unprocessable("Provide durationSeconds or a duration like \"4:18\"");
    assignments.push("duration_seconds = ?");
    params.push(seconds);
  }

  if (input.status === "published") {
    assignments.push("published_at = COALESCE(published_at, strftime('%Y-%m-%dT%H:%M:%fZ','now'))");
  }

  if (assignments.length > 0) {
    params.push(id);
    run(`UPDATE tracks SET ${assignments.join(", ")}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`, params);
  }

  return findTrack(id, true);
}

export function deleteTrack(id: string): void {
  const result = run("UPDATE tracks SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND deleted_at IS NULL", [id]);
  if (result.changes === 0) throw notFound("Track");
}

export function restoreTrack(id: string): void {
  const result = run("UPDATE tracks SET deleted_at = NULL WHERE id = ?", [id]);
  if (result.changes === 0) throw notFound("Track");
}

/** Distinct values for filter dropdowns. */
export function trackFacets(): { languages: string[]; artists: string[]; genres: string[]; moods: string[]; kinds: string[] } {
  const distinct = (column: string) =>
    all<{ value: string }>(`SELECT DISTINCT ${column} AS value FROM tracks WHERE deleted_at IS NULL AND status = 'published' AND ${column} IS NOT NULL AND ${column} != '' ORDER BY ${column}`).map((row) => row.value);
  return {
    languages: distinct("language"),
    artists: distinct("artist"),
    genres: distinct("genre"),
    moods: distinct("mood"),
    kinds: distinct("kind"),
  };
}
