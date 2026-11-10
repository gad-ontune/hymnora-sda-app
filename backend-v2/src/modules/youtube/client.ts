/**
 * The YouTube Data API client.
 *
 * One rule shapes this entire file: there is no `search.list` call anywhere.
 * Open-ended search is 100 quota units per query and returns whatever the
 * relevance model felt like that day, which is how a backend ends up both
 * expensive and wrong. Instead every request here is addressed at a specific,
 * pre-verified channel, and the cheapest possible call is used:
 *
 *   - `playlistItems.list` against a channel's uploads playlist: 1 unit,
 *     regardless of how many items come back. This is the "ping the channel
 *     for new uploads" step.
 *   - `videos.list` in batches of 50: 1 unit per batch, and the only call that
 *     ever touches a specific video.
 *
 * A full poll of 60 channels is 61 units. The default quota is 10,000/day, so
 * the poller could run every five minutes and still use under 2% of it.
 *
 * Every call is recorded in `youtube_quota_usage` before it is made, so the
 * budget is enforced against a number rather than a hope.
 */

import { all, get, run } from "../../db/client.ts";
import { env } from "../../config/env.ts";

const API_BASE = "https://www.googleapis.com/youtube/v3";

/** `search.list` costs this much. The pipeline never spends it; the constant exists so that if someone adds it, the number is written down. */
export const SEARCH_UNIT_COST = 100;

/** `channels.list` costs this much regardless of how many ids go in one call. */
export const CHANNELS_LIST_UNIT_COST = 1;

/**
 * Writes a spend made outside this module, so the daily audit accounts for it.
 *
 * `scripts/verify-channels.ts` fetches with plain `fetch` rather than through
 * `request()`, because it must report a bad key as a bad key instead of a quota
 * error. It still costs a unit, and a quota table that silently omits it would
 * overstate what is left for the poller.
 */
export function recordQuotaUse(endpoint: string, units: number, itemsSeen: number, channelId: string | null = null): void {
  run(
    "INSERT INTO youtube_quota_usage (endpoint, units, channel_id, items_seen, quota_day) VALUES (?, ?, ?, ?, ?)",
    [endpoint, units, channelId, itemsSeen, quotaDay()],
  );
}

export type YouTubeThumbnail = { url: string; width: number; height: number };

export type YouTubeVideo = {
  videoId: string;
  title: string;
  description: string;
  channelId: string;
  channelTitle: string;
  publishedAt: string;
  durationSeconds: number;
  thumbnailUrl: string | null;
  tags: string[];
  isLive: boolean;
  /** From `statistics`. 0 when YouTube withheld them (a video still processing). */
  viewCount: number;
  likeCount: number;
};

export type YouTubeChannelInfo = {
  channelId: string;
  title: string;
  description: string;
  thumbnails: YouTubeThumbnail[];
  country: string | null;
};

export class YouTubeError extends Error {
  readonly status: number;
  readonly reason: string;

  constructor(message: string, status = 0, reason = "unknown") {
    super(message);
    this.name = "YouTubeError";
    this.status = status;
    this.reason = reason;
  }
}

// ─── Quota accounting ───────────────────────────────────────────────────────

export function quotaDay(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function unitsSpentToday(day = quotaDay()): number {
  const row = get<{ total: number }>(
    "SELECT COALESCE(SUM(units), 0) AS total FROM youtube_quota_usage WHERE quota_day = ?",
    [day],
  );
  return Number(row?.total ?? 0);
}

export function remainingQuota(day = quotaDay()): number {
  return Math.max(0, env.youtubeDailyQuota - unitsSpentToday(day) - env.youtubeQuotaSafetyMargin);
}

/** Records the spend, then refuses the call if the day's budget is gone. */
function spend(endpoint: string, units: number, channelId: string | null = null): void {
  const day = quotaDay();
  const spent = unitsSpentToday(day);
  if (spent + units + env.youtubeQuotaSafetyMargin > env.youtubeDailyQuota) {
    throw new YouTubeError(
      `Daily YouTube quota exhausted (${spent}/${env.youtubeDailyQuota} used). Skipping ${endpoint}.`,
      0,
      "quotaExceeded",
    );
  }
  run(
    "INSERT INTO youtube_quota_usage (endpoint, units, channel_id, items_seen, quota_day) VALUES (?, ?, ?, 0, ?)",
    [endpoint, units, channelId, day],
  );
}

function recordItems(endpoint: string, seen: number, channelId: string | null): void {
  run(
    `UPDATE youtube_quota_usage SET items_seen = ?
     WHERE id = (SELECT id FROM youtube_quota_usage WHERE endpoint = ? AND channel_id IS ? ORDER BY id DESC LIMIT 1)`,
    [seen, endpoint, channelId],
  );
}

// ─── Transport ──────────────────────────────────────────────────────────────

async function request<T>(endpoint: string, params: Record<string, string>, units: number, channelId: string | null): Promise<T> {
  if (!env.youtubeApiKey) {
    throw new YouTubeError("YOUTUBE_API_KEY is not configured. The ingest pipeline is disabled.", 0, "notConfigured");
  }
  spend(endpoint, units, channelId);

  const url = new URL(`${API_BASE}/${endpoint}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.searchParams.set("key", env.youtubeApiKey);

  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  } catch (error) {
    throw new YouTubeError(`YouTube ${endpoint} request failed: ${describe(error)}`, 0, "network");
  }

  const body = (await response.json().catch(() => ({}))) as {
    error?: { message?: string; errors?: { reason?: string }[] };
    items?: unknown[];
  };

  if (!response.ok) {
    const reason = body.error?.errors?.[0]?.reason ?? "httpError";
    const message = body.error?.message ?? `YouTube ${endpoint} returned ${response.status}`;
    // quotaExceeded and dailyLimitExceeded are recorded above and will also be
    // refused on the next call, so there is nothing to undo here.
    throw new YouTubeError(message, response.status, reason);
  }

  recordItems(endpoint, body.items?.length ?? 0, channelId);
  return body as T;
}

// ─── Channel reads ──────────────────────────────────────────────────────────

/**
 * The uploads playlist for a channel.
 *
 * YouTube derives it from the channel id: `UC` + the rest becomes `UU` + the
 * rest. This saves a `channels.list` round trip per channel per poll, and it is
 * the reason the poller costs one unit per channel instead of two.
 */
export function uploadsPlaylistId(channelId: string): string {
  if (!channelId.startsWith("UC") || channelId.length !== 24) {
    throw new YouTubeError(`"${channelId}" is not a YouTube channel id`, 0, "badChannelId");
  }
  return `UU${channelId.slice(2)}`;
}

type PlaylistItemsResponse = {
  items?: {
    contentDetails?: { videoId?: string };
    snippet?: {
      title?: string;
      description?: string;
      channelId?: string;
      channelTitle?: string;
      publishedAt?: string;
      tags?: string[];
      thumbnails?: Record<string, YouTubeThumbnail>;
    };
  }[];
  nextPageToken?: string;
};

/** The newest uploads for one whitelisted channel. 1 quota unit per call. */
export async function listRecentUploads(channelId: string, limit: number): Promise<YouTubeVideo[]> {
  if (limit <= 0) return [];
  const wanted = Math.min(50, limit);
  const body = await request<PlaylistItemsResponse>(
    "playlistItems",
    {
      // `contentDetails` is what carries the videoId. With `part=snippet` alone
      // YouTube returns 200 with the item metadata and no contentDetails block
      // at all, so every upload was skipped as "no videoId" and the poll
      // reported 0 uploads seen. Still 1 quota unit — parts are not priced.
      part: "snippet,contentDetails",
      playlistId: uploadsPlaylistId(channelId),
      maxResults: String(wanted),
    },
    1,
    channelId,
  );

  const videos: YouTubeVideo[] = [];
  for (const item of body.items ?? []) {
    const videoId = item.contentDetails?.videoId;
    if (!videoId) continue;
    const snippet = item.snippet ?? {};
    const thumbnails = snippet.thumbnails ?? {};
    // `maxres` is absent on Shorts and on uploads still processing.
    const thumbnail = thumbnails.maxres ?? thumbnails.standard ?? thumbnails.high ?? thumbnails.medium ?? thumbnails.default;
    videos.push({
      videoId,
      title: snippet.title ?? "",
      description: snippet.description ?? "",
      channelId: snippet.channelId ?? channelId,
      channelTitle: snippet.channelTitle ?? "",
      publishedAt: snippet.publishedAt ?? new Date(0).toISOString(),
      durationSeconds: 0, // playlistItems does not carry duration; filled in by hydrate()
      thumbnailUrl: thumbnail?.url ?? null,
      tags: (snippet.tags ?? []).slice(0, 10),
      isLive: false,
      viewCount: 0,
      likeCount: 0,
    });
  }
  return videos;
}

type VideosResponse = {
  items?: {
    id?: string;
    snippet?: {
      title?: string;
      description?: string;
      channelId?: string;
      channelTitle?: string;
      publishedAt?: string;
      tags?: string[];
      thumbnails?: Record<string, YouTubeThumbnail>;
      liveBroadcastContent?: string;
    };
    contentDetails?: { duration?: string };
    statistics?: { viewCount?: string; likeCount?: string };
  }[];
};

/**
 * Fills in the fields `playlistItems` does not carry — duration above all,
 * which Step C of the classifier needs to reject a clip.
 *
 * 1 unit per 50 videos, so a 12-video-per-channel budget costs one call.
 */
export async function hydrateVideos(videoIds: string[]): Promise<Map<string, YouTubeVideo>> {
  const hydrated = new Map<string, YouTubeVideo>();
  if (videoIds.length === 0) return hydrated;

  for (let index = 0; index < videoIds.length; index += 50) {
    const batch = videoIds.slice(index, index + 50);
    const body = await request<VideosResponse>(
      "videos",
      // `statistics` is free here: videos.list is a list operation, 1 unit per
      // 50 ids whatever parts are asked for. Without it every ingested video
      // had view_count = 0, so the video page could not show a view count at
      // all even though the call was already being paid for.
      { part: "snippet,contentDetails,status,statistics", id: batch.join(","), maxResults: "50" },
      1,
      null,
    );
    for (const item of body.items ?? []) {
      const videoId = item.id;
      if (!videoId) continue;
      const snippet = item.snippet ?? {};
      const thumbnails = snippet.thumbnails ?? {};
      const thumbnail = thumbnails.maxres ?? thumbnails.standard ?? thumbnails.high ?? thumbnails.medium ?? thumbnails.default;
      const statistics = item.statistics ?? {};
      hydrated.set(videoId, {
        videoId,
        title: snippet.title ?? "",
        description: snippet.description ?? "",
        channelId: snippet.channelId ?? "",
        channelTitle: snippet.channelTitle ?? "",
        publishedAt: snippet.publishedAt ?? new Date(0).toISOString(),
        durationSeconds: parseIsoDuration(item.contentDetails?.duration),
        thumbnailUrl: thumbnail?.url ?? null,
        tags: (snippet.tags ?? []).slice(0, 10),
        isLive: snippet.liveBroadcastContent === "live",
        viewCount: Number.parseInt(statistics.viewCount ?? "", 10) || 0,
        likeCount: Number.parseInt(statistics.likeCount ?? "", 10) || 0,
      });
    }
  }
  return hydrated;
}

/** Full channel metadata. 1 unit. Used when an admin whitelists a new channel. */
export async function getChannelInfo(channelIdOrHandle: string): Promise<YouTubeChannelInfo> {
  const selector: Record<string, string> = channelIdOrHandle.startsWith("@")
    ? { forHandle: channelIdOrHandle.replace(/^@/, "") }
    : { id: channelIdOrHandle };
  const body = await request<{ items?: { id?: string; snippet?: { title?: string; description?: string; country?: string; thumbnails?: Record<string, YouTubeThumbnail> } }[] }>(
    "channels",
    { part: "snippet", ...selector },
    1,
    null,
  );
  const item = body.items?.[0];
  if (!item?.id) throw new YouTubeError(`No YouTube channel matched "${channelIdOrHandle}"`, 404, "notFound");
  const thumbnails = item.snippet?.thumbnails ?? {};
  const thumbnail = thumbnails.standard ?? thumbnails.default;
  return {
    channelId: item.id,
    title: item.snippet?.title ?? "",
    description: item.snippet?.description ?? "",
    thumbnails: thumbnails.default ? [thumbnails.default, ...Object.values(thumbnails)] : [],
    country: item.snippet?.country ?? null,
  };
}

/** `PT1H2M10S` → 3730. Returns 0 for the `P0D` that live streams report. */
export function parseIsoDuration(iso: string | null | undefined): number {
  if (!iso) return 0;
  const match = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!match) return 0;
  const [, days, hours, minutes, seconds] = match;
  return (
    Number(days ?? 0) * 86_400 +
    Number(hours ?? 0) * 3_600 +
    Number(minutes ?? 0) * 60 +
    Number(seconds ?? 0)
  );
}

// ─── Whitelist lookups ──────────────────────────────────────────────────────

export type WhitelistedChannel = {
  id: string;
  title: string;
  handle: string | null;
  channel_id: string;
  country: string;
  region: string;
  language: string;
  focus: "music" | "preaching" | "mixed";
  denomination: string;
  is_active: number;
  max_new_per_run: number;
  last_polled_at: string | null;
  last_upload_seen: string | null;
};

/**
 * Channels the poller is allowed to touch. This is the quota firewall, and it
 * is also the affiliation gate: `denomination = 'sda'` is hard-baked here so
 * that a non-SDA channel cannot reach the ingest no matter how the list is
 * seeded — the classifier only ever sees channels that already passed this
 * WHERE clause.
 */
export function activeChannels(): WhitelistedChannel[] {
  return all<WhitelistedChannel>(
    "SELECT * FROM youtube_channels WHERE is_active = 1 AND denomination = 'sda' ORDER BY region, title",
  );
}

export function findChannelByVideoId(videoId: string): WhitelistedChannel | undefined {
  return get<WhitelistedChannel>("SELECT * FROM youtube_channels WHERE channel_id = ?", [videoId]);
}

export function markPolled(channelId: string, latestUploadId: string | null, latestPublishedAt: string | null): void {
  run(
    `UPDATE youtube_channels
        SET last_polled_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
            last_item_at = COALESCE(?, last_item_at),
            last_upload_seen = COALESCE(?, last_upload_seen),
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE channel_id = ?`,
    [latestPublishedAt, latestUploadId, channelId],
  );
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
