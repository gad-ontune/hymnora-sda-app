import { z } from "zod";
import type { Request } from "express";
import { all, get, run, type Row } from "../../db/client.ts";
import { notFound } from "../../lib/errors.ts";
import { WhereBuilder, orderBy, paginate, selectList } from "../../lib/sql.ts";
import { listQueryFrom, sortColumn } from "../../lib/query.ts";
import { buildMeta } from "../../lib/http.ts";
import { formatLiveTime, formatViewers } from "../../lib/time.ts";
import type { LiveStream, LiveStreamStatus } from "../../types/domain.ts";
import type { ListMeta } from "../../types/api.ts";

type StreamRow = Row & {
  id: string;
  title: string;
  church_id: string | null;
  church_name: string;
  status: string;
  image: string;
  stream_url: string | null;
  replay_url: string | null;
  viewer_count: number;
  captions_available: number;
  multiview_count: number;
  language: string;
  category: string;
  chat_enabled: number;
  track_id: string | null;
  starts_at: string | null;
  ends_at: string | null;
  view_count: number;
  created_at: string;
};

const selectColumns = `
  l.id, l.title, l.church_id, l.church_name, l.status, l.image, l.stream_url, l.replay_url,
  l.viewer_count, l.captions_available, l.multiview_count, l.language, l.category, l.chat_enabled,
  l.track_id, l.starts_at, l.ends_at, l.view_count, l.created_at
`;

const table = "live_streams l";

function toStream(row: StreamRow): LiveStream {
  const status = row.status as LiveStreamStatus;
  return {
    id: row.id,
    title: row.title,
    church: row.church_name,
    churchId: row.church_id,
    viewers: formatViewers(Number(row.viewer_count ?? 0)),
    image: row.image,
    status,
    time: formatLiveTime(row.starts_at, status),
    streamUrl: row.stream_url,
    replayUrl: row.replay_url,
    captionsAvailable: row.captions_available === 1,
    multiviewCount: Number(row.multiview_count ?? 1),
    viewerCount: Number(row.viewer_count ?? 0),
    language: row.language,
    category: row.category,
    chatEnabled: row.chat_enabled === 1,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    trackId: row.track_id,
  };
}

function buildWhere(query: ReturnType<typeof listQueryFrom>, req: Request) {
  const where = new WhereBuilder();
  where.addIf(query.language, "l.language = ?", query.language);
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  where.addIf(status, "l.status = ?", status);
  const churchId = typeof req.query.church === "string" ? req.query.church : undefined;
  where.addIf(churchId, "l.church_id = ?", churchId);
  const category = typeof req.query.category === "string" ? req.query.category : undefined;
  where.addIf(category, "l.category = ?", category);
  where.addWhen(req.query.live === "true", "l.status = 'Live now'");
  where.addWhen(req.query.replay === "true", "l.replay_url IS NOT NULL");
  where.addSearch(["l.title", "l.church_name", "l.category", "l.language"], query.q);
  return where;
}

const sortMap: Record<string, string> = {
  title: "l.title",
  viewers: "l.viewer_count",
  starts: "l.starts_at",
  status: "l.status",
  created: "l.created_at",
};

/**
 * `GET /api/live` — the live page.
 *
 * Ordered by the stream's own lifecycle rather than a timestamp: live first,
 * then starting soon, then upcoming, then replays.
 */
export function listStreams(req: Request): { items: LiveStream[]; meta: ListMeta } {
  const query = listQueryFrom(req);
  const where = buildWhere(query, req);
  const { rows, total } = paginate<StreamRow>({
    select: selectColumns,
    from: table,
    where,
    orderBy: orderBy(
      sortColumn(
        query.sort,
        sortMap,
        "CASE l.status WHEN 'Live now' THEN 0 WHEN 'Starting soon' THEN 1 WHEN 'Upcoming' THEN 2 ELSE 3 END, l.starts_at DESC",
      ),
      "asc",
    ),
    limit: query.limit,
    offset: query.offset,
  });
  return { items: rows.map(toStream), meta: buildMeta(total, query.limit, query.offset) };
}

export function findStream(id: string): LiveStream {
  const row = get<StreamRow>(`${selectList(selectColumns)} FROM ${table} WHERE l.id = ?`, [id]);
  if (!row) throw notFound("Stream");
  return toStream(row);
}

/** `GET /api/live/now` — just the streams currently on air, for the home badge. */
export function liveNow(limit = 10): LiveStream[] {
  return all<StreamRow>(
    `${selectList(selectColumns)} FROM ${table} WHERE l.status = 'Live now'
     ORDER BY l.viewer_count DESC LIMIT ?`,
    [Math.min(50, Math.max(1, limit))],
  ).map(toStream);
}

export function streamFacets(): { statuses: string[]; categories: string[]; languages: string[] } {
  const distinct = (column: string) =>
    all<{ value: string }>(`SELECT DISTINCT ${column} AS value FROM ${table} WHERE ${column} IS NOT NULL AND ${column} != '' ORDER BY ${column}`).map(
      (row) => row.value,
    );
  return { statuses: distinct("status"), categories: distinct("category"), languages: distinct("language") };
}

export function incrementViewers(id: string): void {
  run("UPDATE live_streams SET viewer_count = viewer_count + 1, view_count = view_count + 1 WHERE id = ?", [id]);
}
