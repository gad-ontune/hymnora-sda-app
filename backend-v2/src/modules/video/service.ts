/**
 * The video page's read model.
 *
 * This is deliberately *not* `listVideos` in `modules/media/service.ts`, which
 * filters `tracks.kind = 'video'` and therefore returns nothing at all: every
 * ingested YouTube upload is written as `kind = 'audio'`, because the music page
 * plays it as audio. The video page is a different question about the same rows
 * — "what is watchable" — and the two filters have to be allowed to disagree.
 *
 * So the queries below union `tracks` and `sermons` over the shared predicate
 * `youtube_video_id IS NOT NULL`. That is what makes the page's filters honest:
 * a Kurasini choir video and a Starehe camp meeting are both watchable, and
 * both appear.
 *
 * The music page keeps `kind = 'audio'` and keeps out of this file's way.
 */

import { all, get } from "../../db/client.ts";
import { regionName } from "../youtube/whitelist.ts";

export type VideoCategory = "choirs" | "hymns" | "instrumentals" | "acapella" | "worship" | "sermons";

/** A card in the video grid. */
export type VideoCard = {
  id: string;
  /** The YouTube id — what the player and the embed both key off. */
  videoId: string;
  title: string;
  /** The channel, which is a choir or a church and not a performer. */
  channel: string;
  thumbnail: string;
  /** `mm:ss` or `h:mm:ss`, already formatted. */
  duration: string;
  /** The raw length in seconds, for rules that must not parse the label. */
  durationSeconds: number;
  views: number;
  likes: number;
  publishedAt: string;
  language: string;
  region: string;
  regionLabel: string;
  category: VideoCategory;
  isLive: boolean;
  /** Drives the "Watch on YouTube" link; the in-app player is an embed. */
  watchUrl: string;
};

export type VideoSort = "newest" | "views" | "oldest" | "added";

export type VideoQuery = {
  category?: string;
  region?: string;
  q?: string;
  sort?: VideoSort;
  limit?: number;
  offset?: number;
};

/**
 * The union of every watchable upload, as a subquery.
 *
 * `sermons` has no `sub_category` and `tracks` has no `category`, so `bucket` is
 * added here as a literal on each side — that is what tells a sermon apart from
 * a song, since the classification gives every excluded video a null category.
 */
const BASE = `
  SELECT t.id, t.youtube_video_id AS videoId, t.title, t.artist AS channel, t.image AS thumbnail,
         t.duration_seconds AS duration, t.view_count AS views, t.like_count AS likes,
         t.published_at AS publishedAt, t.created_at AS createdAt, t.language, t.region,
         t.sub_category AS category, t.is_live AS isLive,
         'tracks' AS bucket
    FROM tracks t
   WHERE t.deleted_at IS NULL AND t.status = 'published' AND t.youtube_video_id IS NOT NULL
  UNION ALL
  SELECT s.id, s.youtube_video_id AS videoId, s.title, s.speaker AS channel, s.image AS thumbnail,
         s.duration_seconds AS duration, s.view_count AS views, s.like_count AS likes,
         s.published_at AS publishedAt, s.created_at AS createdAt, s.language, s.region,
         s.category, s.is_live AS isLive,
         'sermons' AS bucket
    FROM sermons s
   WHERE s.deleted_at IS NULL AND s.status = 'published' AND s.youtube_video_id IS NOT NULL`;
const ORDER_BY: Record<VideoSort, string> = {
  newest: "publishedAt DESC",
  views: "views DESC, publishedAt DESC",
  oldest: "publishedAt ASC",
  // Deliberately a different ordering from `newest`, and not a synonym for it:
  // `newest` ranks by when the video was published, `added` by when this app
  // first saw it. A channel uploading a five-year-old sermon today is newly
  // added and not newly published, and only one of those is what you want when
  // you are checking what the poller just found.
  added: "createdAt DESC, publishedAt DESC",
};

export function listVideosPage(query: VideoQuery = {}): { items: VideoCard[]; total: number } {
  const limit = Math.min(48, Math.max(1, query.limit ?? 18));
  const offset = Math.max(0, query.offset ?? 0);
  const clauses: string[] = [];
  const params: (string | number)[] = [];

  if (query.category && query.category !== "all") {
    if (query.category === "live") {
      clauses.push("isLive = 1");
    } else if (query.category === "sermons") {
      clauses.push("bucket = 'sermons'");
    } else {
      clauses.push("(category = ? AND bucket = 'tracks')");
      params.push(query.category);
    }
  }
  if (query.region && query.region !== "all") {
    clauses.push("region = ?");
    params.push(query.region);
  }
  if (query.q) {
    clauses.push("(lower(title) LIKE ? OR lower(channel) LIKE ?)");
    const needle = `%${query.q.toLowerCase()}%`;
    params.push(needle, needle);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = all<Record<string, unknown>>(
    `SELECT * FROM (${BASE}) ${where}
     ORDER BY ${ORDER_BY[query.sort ?? "newest"]}
     LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );

  return {
    items: rows.map(toCard),
    total: Number(
      get<{ total: number }>(`SELECT COUNT(*) AS total FROM (${BASE}) ${where}`, params)?.total ?? 0,
    ),
  };
}

/**
 * Every watchable video, unpaginated.
 *
 * `listVideosPage` caps a page at 48 because that is a page. The reels feed is
 * not a page — it reorders the whole catalogue to decide what to show next, and
 * capping the input would silently shrink the feed to whatever the first 48
 * rows happened to be, which is why the feed showed 48 of 86 videos and no
 * category totals that added up.
 */
export function videoCatalogue(sort: VideoSort = "newest"): VideoCard[] {
  return all<Record<string, unknown>>(
    `SELECT * FROM (${BASE}) ORDER BY ${ORDER_BY[sort]}`,
  ).map(toCard);
}

function toCard(row: Record<string, unknown>): VideoCard {
  const bucket = String(row.bucket ?? "tracks");
  const rawCategory = row.category == null ? null : String(row.category);
  return {
    id: String(row.id),
    videoId: String(row.videoId),
    title: String(row.title ?? "Untitled"),
    channel: String(row.channel ?? ""),
    thumbnail: String(row.thumbnail ?? ""),
    duration: formatSeconds(Number(row.duration ?? 0)),
    durationSeconds: Number(row.duration ?? 0),
    views: Number(row.views ?? 0),
    likes: Number(row.likes ?? 0),
    publishedAt: String(row.publishedAt ?? ""),
    language: String(row.language ?? ""),
    region: String(row.region ?? "global"),
    regionLabel: regionName(row.region == null ? null : String(row.region)),
    category: (bucket === "sermons" ? "sermons" : (rawCategory ?? "hymns")) as VideoCategory,
    isLive: Number(row.isLive ?? 0) === 1,
    watchUrl: `https://www.youtube.com/watch?v=${String(row.videoId)}`,
  };
}

/** Chip counts, so a filter that would return nothing does not get offered. */
export function videoFacetsPage(): {
  categories: { id: string; label: string; count: number }[];
  regions: { id: string; label: string; count: number }[];
  total: number;
} {
  // A live broadcast is shown under "Live" rather than under whichever bucket
  // it happened to match, because that is the thing a viewer filters for.
  const categoryRows = all<{ key: string; total: number }>(
    `SELECT CASE WHEN bucket = 'sermons' THEN 'sermons'
                  WHEN isLive = 1 THEN 'live'
                  ELSE category END AS key,
            COUNT(*) AS total
       FROM (${BASE})
      GROUP BY key ORDER BY total DESC`,
  );
  const labels: Record<string, string> = {
    choirs: "Choirs",
    hymns: "Hymns",
    worship: "Worship",
    instrumentals: "Instrumentals",
    acapella: "Acapella",
    sermons: "Sermons",
    live: "Live",
  };
  const categories = categoryRows
    .filter((row) => row.key && row.key !== "null")
    .map((row) => ({ id: row.key, label: labels[row.key] ?? row.key, count: Number(row.total) }));

  const regionRows = all<{ region: string; total: number }>(
    `SELECT region, COUNT(*) AS total FROM (${BASE})
      WHERE region IS NOT NULL AND region != '' GROUP BY region ORDER BY total DESC`,
  );
  const regions = regionRows.map((row) => ({
    id: row.region,
    label: regionName(row.region),
    count: Number(row.total),
  }));

  return {
    categories,
    regions,
    total: Number(get<{ total: number }>(`SELECT COUNT(*) AS total FROM (${BASE})`)?.total ?? 0),
  };
}

/**
 * One video plus what to show around it.
 *
 * The player page needs three things the grid cannot provide: the description,
 * the channel's identity, and more from that channel. Resolved together because
 * the page makes three round trips otherwise.
 */
export function videoDetail(idOrVideoId: string): {
  video: VideoCard;
  description: string;
  channel: { id: string; title: string; handle: string | null; country: string | null };
  more: VideoCard[];
} | null {
  // The row is selected directly from the union rather than being searched for
  // inside a `listVideosPage` result: that call caps a page at 48 rows, so any
  // video outside the newest 48 used to 404 here.
  const row = get<Record<string, unknown>>(
    `SELECT * FROM (${BASE}) WHERE id = ? OR videoId = ? LIMIT 1`,
    [idOrVideoId, idOrVideoId],
  );
  if (!row) return null;
  const byId = toCard(row);

  // `tracks` has no description column — the description lives once, in the
  // ingest registry, and is the better source for both tables anyway because it
  // is the text YouTube actually returned rather than a copy of it.
  const description =
    get<{ description: string | null }>(
      "SELECT description FROM youtube_videos WHERE video_id = ?",
      [byId.videoId],
    )?.description ?? "";

  const channelRow = get<{ title: string; handle: string | null; country: string | null }>(
    "SELECT title, handle, country FROM youtube_channels WHERE channel_id = ?",
    [channelIdFor(byId)],
  ) ?? { title: byId.channel, handle: null, country: null };

  const more = all<Record<string, unknown>>(
    `SELECT * FROM (${BASE}) WHERE channel = ? AND id != ? ORDER BY publishedAt DESC LIMIT 8`,
    [byId.channel, byId.id],
  ).map(toCard);

  return {
    video: byId,
    description: description.slice(0, 4_000),
    channel: { id: channelIdFor(byId), title: channelRow.title, handle: channelRow.handle, country: channelRow.country },
    more,
  };
}

function channelIdFor(card: VideoCard): string {
  const row = get<{ source_channel_id: string | null }>(
    "SELECT source_channel_id FROM tracks WHERE id = ? UNION ALL SELECT source_channel_id FROM sermons WHERE id = ? LIMIT 1",
    [card.id, card.id],
  );
  return row?.source_channel_id ?? "";
}

export function formatSeconds(total: number): string {
  if (!Number.isFinite(total) || total <= 0) return "";
  const seconds = Math.floor(total % 60);
  const minutes = Math.floor((total / 60) % 60);
  const hours = Math.floor(total / 3600);
  const pad = (n: number) => String(n).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}
