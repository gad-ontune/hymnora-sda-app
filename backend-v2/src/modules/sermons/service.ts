import { z } from "zod";
import type { Request } from "express";
import { all, get, run, type Row } from "../../db/client.ts";
import { notFound, unprocessable } from "../../lib/errors.ts";
import { WhereBuilder, orderBy, paginate, selectList } from "../../lib/sql.ts";
import { listQueryFrom, sortColumn } from "../../lib/query.ts";
import { buildMeta, newId, slugify } from "../../lib/http.ts";
import { formatDuration, formatMinutes } from "../../lib/time.ts";
import { parseJson } from "../../lib/text.ts";
import type { Sermon, SermonChapter, SermonDetail, SermonSeries } from "../../types/domain.ts";
import type { ListMeta } from "../../types/api.ts";

type SermonRow = Row & {
  id: string;
  title: string;
  speaker_id: string | null;
  speaker: string;
  speaker_bio: string | null;
  topic: string;
  series_id: string | null;
  series: string;
  image: string;
  duration_seconds: number;
  language: string;
  description: string | null;
  scripture_reference: string | null;
  transcript: string | null;
  chapters: string;
  audio_url: string | null;
  video_url: string | null;
  downloadable: number;
  captions_available: number;
  play_count: number;
  status: string;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

function toSermon(row: SermonRow): Sermon {
  return {
    id: row.id,
    title: row.title,
    speaker: row.speaker,
    topic: row.topic,
    duration: formatMinutes(row.duration_seconds),
    image: row.image,
    series: row.series,
    language: row.language,
  };
}

function toSermonDetail(row: SermonRow): SermonDetail {
  return {
    ...toSermon(row),
    speakerBio: row.speaker_bio,
    seriesId: row.series_id,
    description: row.description,
    scriptureReference: row.scripture_reference,
    durationSeconds: row.duration_seconds,
    audioUrl: row.audio_url,
    videoUrl: row.video_url,
    downloadable: row.downloadable === 1,
    captionsAvailable: row.captions_available === 1,
    transcript: row.transcript,
    chapters: parseJson<SermonChapter[]>(row.chapters, []),
    playCount: row.play_count,
    publishedAt: row.published_at,
    status: row.status as SermonDetail["status"],
  };
}

const selectColumns = `
  s.id, s.title, s.speaker_id, s.speaker, s.speaker_bio, s.topic, s.series_id, s.series, s.image,
  s.duration_seconds, s.language, s.description, s.scripture_reference, s.transcript, s.chapters,
  s.audio_url, s.video_url, s.downloadable, s.captions_available, s.play_count, s.status,
  s.published_at, s.created_at, s.updated_at
`;

const table = "sermons s";

function buildWhere(query: ReturnType<typeof listQueryFrom>, req: Request) {
  const where = new WhereBuilder().addPublished("s", query.includeDrafts === true);
  where.addIf(query.language, "s.language = ?", query.language);
  const speakerId = typeof req.query.speaker === "string" ? req.query.speaker : undefined;
  where.addIf(speakerId, "s.speaker_id = ?", speakerId);
  const seriesId = typeof req.query.series === "string" ? req.query.series : undefined;
  where.addIf(seriesId, "s.series_id = ?", seriesId);
  const topic = typeof req.query.topic === "string" ? req.query.topic : undefined;
  where.addIf(topic, "s.topic = ?", topic);
  where.addWhen(req.query.downloadable === "true", "s.downloadable = 1");
  where.addSearch(["s.title", "s.speaker", "s.topic", "s.series", "s.description", "s.transcript", "s.scripture_reference"], query.q);
  return where;
}

const sortMap: Record<string, string> = {
  title: "s.title",
  speaker: "s.speaker",
  topic: "s.topic",
  duration: "s.duration_seconds",
  plays: "s.play_count",
  published: "s.published_at",
  created: "s.created_at",
};

/** `GET /api/sermons` — bare `Sermon[]` for the frontend sermons page. */
export function listSermons(req: Request): { items: Sermon[]; meta: ListMeta } {
  const query = listQueryFrom(req);
  const where = buildWhere(query, req);
  const { rows, total } = paginate<SermonRow>({
    select: selectColumns,
    from: table,
    where,
    orderBy: orderBy(sortColumn(query.sort, sortMap, "s.published_at"), query.order),
    limit: query.limit,
    offset: query.offset,
  });
  return { items: rows.map(toSermon), meta: buildMeta(total, query.limit, query.offset) };
}

export function listSermonDetails(req: Request): { items: SermonDetail[]; meta: ListMeta } {
  const query = listQueryFrom(req);
  const where = buildWhere(query, req);
  const { rows, total } = paginate<SermonRow>({
    select: selectColumns,
    from: table,
    where,
    orderBy: orderBy(sortColumn(query.sort, sortMap, "s.published_at"), query.order),
    limit: query.limit,
    offset: query.offset,
  });
  return { items: rows.map(toSermonDetail), meta: buildMeta(total, query.limit, query.offset) };
}

export function findSermon(id: string, includeDrafts = false): SermonDetail {
  const row = get<SermonRow>(
    `${selectList(selectColumns)}
     FROM ${table} WHERE s.id = ? AND s.deleted_at IS NULL ${includeDrafts ? "" : "AND s.status = 'published'"}`,
    [id],
  );
  if (!row) throw notFound("Sermon");
  return toSermonDetail(row);
}

export function incrementPlays(id: string): void {
  run("UPDATE sermons SET play_count = play_count + 1 WHERE id = ?", [id]);
}

// ─── Series & speakers ───────────────────────────────────────────────────────

type SeriesRow = Row & {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  cover_url: string | null;
  speaker: string | null;
  episode_count: number;
};

function toSeries(row: SeriesRow): SermonSeries {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    coverUrl: row.cover_url,
    speaker: row.speaker,
    episodeCount: Number(row.episode_count ?? 0),
  };
}

const seriesSelect = `
  ss.id, ss.name, ss.slug, ss.description, ss.cover_url, sp.name AS speaker,
  (SELECT COUNT(*) FROM sermons s WHERE s.series_id = ss.id AND s.deleted_at IS NULL AND s.status = 'published') AS episode_count
`;

export function listSeries(): SermonSeries[] {
  return all<SeriesRow>(
    `SELECT ${seriesSelect} FROM sermon_series ss
     LEFT JOIN speakers sp ON sp.id = ss.speaker_id
     ORDER BY episode_count DESC, ss.name`,
  ).map(toSeries);
}

export function findSeries(idOrSlug: string): SermonSeries {
  const row = get<SeriesRow>(
    `SELECT ${seriesSelect} FROM sermon_series ss
     LEFT JOIN speakers sp ON sp.id = ss.speaker_id
     WHERE ss.id = ? OR ss.slug = ?`,
    [idOrSlug, idOrSlug],
  );
  if (!row) throw notFound("Sermon series");
  return toSeries(row);
}

type SpeakerRow = Row & {
  id: string;
  name: string;
  slug: string;
  title: string | null;
  image: string;
  bio: string | null;
  sermon_count: number;
};

export function listSpeakers(): { id: string; name: string; slug: string; title: string | null; image: string; bio: string | null; sermonCount: number }[] {
  return all<SpeakerRow>(
    `SELECT sp.id, sp.name, sp.slug, sp.title, sp.image, sp.bio,
            (SELECT COUNT(*) FROM sermons s WHERE s.speaker_id = sp.id AND s.deleted_at IS NULL AND s.status = 'published') AS sermon_count
     FROM speakers sp ORDER BY sermon_count DESC, sp.name`,
  ).map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    title: row.title,
    image: row.image,
    bio: row.bio,
    sermonCount: Number(row.sermon_count ?? 0),
  }));
}

// ─── Write operations ────────────────────────────────────────────────────────

export const sermonInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  speaker: z.string().trim().max(160).default(""),
  speakerId: z.string().trim().max(120).nullable().optional(),
  topic: z.string().trim().max(160).default(""),
  series: z.string().trim().max(160).default(""),
  seriesId: z.string().trim().max(120).nullable().optional(),
  image: z.string().trim().max(400).default(""),
  duration: z.string().trim().max(20).optional(),
  durationSeconds: z.number().int().min(0).max(86_400).optional(),
  language: z.string().trim().min(2).max(40).default("English"),
  description: z.string().max(8000).nullable().optional(),
  scriptureReference: z.string().trim().max(120).nullable().optional(),
  transcript: z.string().max(200_000).nullable().optional(),
  chapters: z
    .array(z.object({ at: z.number().int().min(0), label: z.string().trim().min(1).max(160) }))
    .max(200)
    .default([]),
  audioUrl: z.string().trim().max(600).nullable().optional(),
  videoUrl: z.string().trim().max(600).nullable().optional(),
  downloadable: z.boolean().default(false),
  captionsAvailable: z.boolean().default(false),
  status: z.enum(["draft", "published", "archived"]).default("published"),
  id: z.string().trim().max(120).optional(),
});

export type SermonInput = z.output<typeof sermonInputSchema>;

function resolveDuration(input: SermonInput): number {
  if (input.durationSeconds !== undefined) return input.durationSeconds;
  if (!input.duration) return 0;
  const [minutes, seconds] = input.duration.split(":");
  const total = Number.parseInt(minutes ?? "0", 10) * 60 + Number.parseInt(seconds ?? "0", 10);
  return Number.isFinite(total) ? total : 0;
}

export function createSermon(input: SermonInput, createdBy: string | null): SermonDetail {
  const id = input.id ?? newId();
  if (get("SELECT 1 FROM sermons WHERE id = ?", [id])) {
    throw unprocessable(`A sermon with the id "${id}" already exists`, { field: "id" });
  }
  run(
    `INSERT INTO sermons (id, title, speaker_id, speaker, topic, series_id, series, image, duration_seconds,
                          language, description, scripture_reference, transcript, chapters, audio_url,
                          video_url, downloadable, captions_available, status, published_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.title,
      input.speakerId ?? null,
      input.speaker,
      input.topic,
      input.seriesId ?? null,
      input.series,
      input.image,
      resolveDuration(input),
      input.language,
      input.description ?? null,
      input.scriptureReference ?? null,
      input.transcript ?? null,
      JSON.stringify(input.chapters),
      input.audioUrl ?? null,
      input.videoUrl ?? null,
      input.downloadable ? 1 : 0,
      input.captionsAvailable ? 1 : 0,
      input.status,
      input.status === "published" ? new Date().toISOString() : null,
      createdBy,
    ],
  );
  return findSermon(id, true);
}

export function updateSermon(id: string, input: Partial<SermonInput>): SermonDetail {
  findSermon(id, true);
  const map: Record<string, string> = {
    title: "title",
    speakerId: "speaker_id",
    speaker: "speaker",
    topic: "topic",
    seriesId: "series_id",
    series: "series",
    image: "image",
    language: "language",
    description: "description",
    scriptureReference: "scripture_reference",
    transcript: "transcript",
    audioUrl: "audio_url",
    videoUrl: "video_url",
    status: "status",
  };
  const booleanMap: Record<string, string> = { downloadable: "downloadable", captionsAvailable: "captions_available" };
  const assignments: string[] = [];
  const params: (string | number | null)[] = [];

  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || key === "id" || key === "duration" || key === "durationSeconds") continue;
    if (key === "chapters") {
      assignments.push("chapters = ?");
      params.push(JSON.stringify(value));
      continue;
    }
    if (booleanMap[key]) {
      assignments.push(`${booleanMap[key]} = ?`);
      params.push(value ? 1 : 0);
      continue;
    }
    const column = map[key];
    if (!column) continue;
    assignments.push(`${column} = ?`);
    params.push(value as string | null);
  }

  if (input.duration !== undefined || input.durationSeconds !== undefined) {
    const seconds = input.durationSeconds ?? (input.duration ? (Number.parseInt(input.duration.split(":")[0] ?? "0", 10) || 0) * 60 + (Number.parseInt(input.duration.split(":")[1] ?? "0", 10) || 0) : null);
    if (seconds !== null) {
      assignments.push("duration_seconds = ?");
      params.push(seconds);
    }
  }
  if (input.status === "published") {
    assignments.push("published_at = COALESCE(published_at, strftime('%Y-%m-%dT%H:%M:%fZ','now'))");
  }

  if (assignments.length > 0) {
    params.push(id);
    run(`UPDATE sermons SET ${assignments.join(", ")}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`, params);
  }
  return findSermon(id, true);
}

export function deleteSermon(id: string): void {
  const result = run("UPDATE sermons SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND deleted_at IS NULL", [id]);
  if (result.changes === 0) throw notFound("Sermon");
}

export function restoreSermon(id: string): void {
  const result = run("UPDATE sermons SET deleted_at = NULL WHERE id = ?", [id]);
  if (result.changes === 0) throw notFound("Sermon");
}

// ─── Series / speaker CRUD ───────────────────────────────────────────────────

export const seriesInputSchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().max(4000).nullable().optional(),
  coverUrl: z.string().trim().max(400).nullable().optional(),
  speakerId: z.string().trim().max(120).nullable().optional(),
  id: z.string().trim().max(120).optional(),
});

export type SeriesInput = z.output<typeof seriesInputSchema>;

export function createSeries(input: SeriesInput): SermonSeries {
  const id = input.id ?? newId();
  const slug = slugify(input.name);
  if (!slug) throw unprocessable("The name must contain at least one letter or digit", { field: "name" });
  if (get("SELECT 1 FROM sermon_series WHERE id = ? OR slug = ?", [id, slug])) {
    throw unprocessable("A series with that name or id already exists", { field: "name" });
  }
  run(
    "INSERT INTO sermon_series (id, name, slug, description, cover_url, speaker_id) VALUES (?, ?, ?, ?, ?, ?)",
    [id, input.name, slug, input.description ?? null, input.coverUrl ?? null, input.speakerId ?? null],
  );
  return findSeries(id);
}

export function updateSeries(idOrSlug: string, input: Partial<SeriesInput>): SermonSeries {
  const existing = get<{ id: string }>("SELECT id FROM sermon_series WHERE id = ? OR slug = ?", [idOrSlug, idOrSlug]);
  if (!existing) throw notFound("Sermon series");
  const map: Record<string, string> = { name: "name", description: "description", coverUrl: "cover_url", speakerId: "speaker_id" };
  const assignments: string[] = [];
  const params: (string | null)[] = [];
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || key === "id") continue;
    const column = map[key];
    if (!column) continue;
    assignments.push(`${column} = ?`);
    params.push(value as string | null);
  }
  if (input.name !== undefined) {
    assignments.push("slug = ?");
    params.push(slugify(input.name));
  }
  if (assignments.length > 0) {
    params.push(existing.id);
    run(`UPDATE sermon_series SET ${assignments.join(", ")} WHERE id = ?`, params);
  }
  return findSeries(existing.id);
}

export function deleteSeries(idOrSlug: string): void {
  const result = run("DELETE FROM sermon_series WHERE id = ? OR slug = ?", [idOrSlug, idOrSlug]);
  if (result.changes === 0) throw notFound("Sermon series");
}
