/**
 * The ingest run: poll the whitelist, classify what came back, route it.
 *
 * This is the only code in the app that talks to YouTube. It is deliberately
 * written as one linear, restartable pass over a fixed list rather than as a
 * pipeline of queues, because a pass is idempotent: the unique index on
 * `tracks.youtube_video_id` means running it twice in a row does not duplicate
 * a row, and a crash halfway through loses nothing but the un-polled channels,
 * which the next run picks up.
 *
 * Ordering matters and is the reason this is a separate module from the
 * classifier:  classify first (cheap, in-process, no I/O), then persist only
 * what a human curator would agree belongs on the page.
 */

import { all, get, run, transaction } from "../../db/client.ts";
import { env } from "../../config/env.ts";
import { stableId } from "../../lib/http.ts";
import { parseJson } from "../../lib/text.ts";
import {
  activeChannels,
  hydrateVideos,
  listRecentUploads,
  markPolled,
  quotaDay,
  unitsSpentToday,
  YouTubeError,
  type WhitelistedChannel,
  type YouTubeVideo,
} from "./client.ts";
import { classify, normalizeText, type Classification, type MusicCategory } from "./classify.ts";
import { REEL_MAX_SECONDS, isReelLength } from "../reels/category.ts";

export type IngestSummary = {
  ranAt: string;
  channelsPolled: number;
  channelsSkipped: number;
  videosSeen: number;
  alreadyKnown: number;
  classified: Record<VerdictCount, number>;
  routed: { tracks: number; sermons: number; videos: number; reels: number };
  quotaUnitsSpent: number;
  errors: string[];
};

type VerdictCount = "music" | "sermon" | "skipped";

export type IngestOptions = {
  /** Cap on how many channels to touch in this run. Keeps a run short. */
  maxChannels?: number;
  /** Per-channel upload budget; falls back to the channel's own cap. */
  maxNewPerRun?: number;
  /** Only poll these channel ids. Used by the admin "sync now" endpoint. */
  onlyChannels?: string[];
};

/**
 * One pass over the whitelist. Safe to call concurrently with nothing else —
 * the worker owns it — and safe to call again immediately.
 */
export async function runIngest(options: IngestOptions = {}): Promise<IngestSummary> {
  const summary: IngestSummary = {
    ranAt: new Date().toISOString(),
    channelsPolled: 0,
    channelsSkipped: 0,
    videosSeen: 0,
    alreadyKnown: 0,
    classified: { music: 0, sermon: 0, skipped: 0 },
    routed: { tracks: 0, sermons: 0, videos: 0, reels: 0 },
    quotaUnitsSpent: 0,
    errors: [],
  };

  const day = quotaDay();
  const spentBefore = unitsSpentToday(day);
  let channels = activeChannels();
  if (options.onlyChannels?.length) {
    const wanted = new Set(options.onlyChannels);
    channels = channels.filter((channel) => wanted.has(channel.channel_id));
  }
  if (options.maxChannels !== undefined) channels = channels.slice(0, options.maxChannels);
  if (channels.length === 0) return summary;

  for (const channel of channels) {
    const budget = Math.min(
      options.maxNewPerRun ?? channel.max_new_per_run ?? env.youtubeMaxNewPerRun,
      50,
    );
    try {
      const uploaded = await listRecentUploads(channel.channel_id, budget);
      summary.videosSeen += uploaded.length;

      // Stop at the first item we already hold. The uploads playlist is newest
      // first, so everything past this point was seen on a previous run and
      // re-requesting metadata for it would be pure quota waste.
      const fresh = takeUntilSeen(uploaded, channel);
      summary.alreadyKnown += uploaded.length - fresh.length;

      const hydrated = fresh.length > 0 ? await hydrateVideos(fresh.map((video) => video.videoId)) : new Map<string, YouTubeVideo>();

      for (const candidate of fresh) {
        // `playlistItems` gives title/description already; `videos.list` adds
        // duration, which Step C needs. Prefer the hydrated copy, fall back to
        // the playlist copy so one missing video cannot lose the whole run.
        const video = hydrated.get(candidate.videoId) ?? candidate;
        const decision = classify({
          title: normalizeText(video.title),
          description: video.description,
          channelFocus: channel.focus as "music" | "preaching" | "mixed",
          tags: video.tags,
          // Zero when the duration is unknown, which skips the "too short"
          // floor rather than tripping it. A missing duration should never
          // delete a video whose title plainly says "Acapella".
          durationSeconds: video.durationSeconds,
        });
        summary.classified[decision.verdict] += 1;
        persistVerdict(channel, video, decision, summary);
      }

      const newest = uploaded[0];
      markPolled(channel.channel_id, newest?.videoId ?? null, newest?.publishedAt ?? null);
      summary.channelsPolled += 1;
    } catch (error) {
      // A quota stop is not a per-channel failure — stop the whole run, so we
      // do not burn the remaining channels' calls finding out the same thing.
      if (error instanceof YouTubeError && error.reason === "quotaExceeded") {
        summary.errors.push(error.message);
        summary.channelsSkipped = channels.length - summary.channelsPolled;
        break;
      }
      const message = error instanceof Error ? error.message : String(error);
      summary.errors.push(`${channel.title}: ${message}`);
      summary.channelsSkipped += 1;
    }
  }

  summary.quotaUnitsSpent = unitsSpentToday(day) - spentBefore;
  return summary;
}

/**
 * A private channel's uploads carry `Private` as a visibility status. Those must
 * not be classified: the text is a placeholder and they are not playable, so
 * they would land on the music page as a song that cannot be pressed.
 */
function isUnplayable(video: YouTubeVideo): boolean {
  return video.title.trim().toLowerCase() === "private" || video.title.trim().toLowerCase() === "deleted video";
}

/**
 * Trims the batch at the first video already recorded.
 *
 * The uploads playlist is ordered newest-first and this pipeline only ever
 * appends, so the newest unprocessed video is a valid resume point. If it is
 * missing (a channel that was reactivated, or a row deleted by hand) the batch
 * is kept whole and the per-video unique index absorbs the duplicates.
 */
function takeUntilSeen(uploads: YouTubeVideo[], channel: WhitelistedChannel): YouTubeVideo[] {
  // The column on `youtube_videos` is `video_id` — the same value that lands in
  // `tracks.youtube_video_id` / `sermons.youtube_video_id`, but the registry
  // table keeps its own name for it. Reading the tracks spelling here threw
  // "no such column" for every channel and aborted the whole poll.
  const known = new Set(
    all<{ video_id: string }>(
      "SELECT video_id FROM youtube_videos WHERE channel_id = ? AND video_id IS NOT NULL",
      [channel.channel_id],
    ).map((row) => row.video_id),
  );
  const index = uploads.findIndex((video) => known.has(video.videoId));
  return index === -1 ? uploads : uploads.slice(0, index);
}

/** Writes the decision, then routes it. The verdict is stored even when skipped. */
function persistVerdict(
  channel: WhitelistedChannel,
  video: YouTubeVideo,
  decision: Classification,
  summary: IngestSummary,
): void {
  const rowId = stableId("yt", video.videoId);
  const routedTo = routeVideo(channel, video, decision);

  transaction(() => {
    run(
      `INSERT INTO youtube_videos
         (id, video_id, channel_id, title, description, thumbnail_url, duration_seconds,
          published_at, region, verdict, category, tags, confidence, reasons,
          matched_keyword, excluded_keyword, routed_to, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       ON CONFLICT (video_id) DO UPDATE SET
         title = excluded.title,
         description = excluded.description,
         thumbnail_url = excluded.thumbnail_url,
         duration_seconds = excluded.duration_seconds,
         published_at = excluded.published_at,
         verdict = excluded.verdict,
         category = excluded.category,
         tags = excluded.tags,
         confidence = excluded.confidence,
         reasons = excluded.reasons,
         matched_keyword = excluded.matched_keyword,
         excluded_keyword = excluded.excluded_keyword,
         routed_to = excluded.routed_to,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
      [
        rowId,
        video.videoId,
        video.channelId || channel.channel_id,
        video.title,
        video.description.slice(0, 4_000),
        video.thumbnailUrl,
        video.durationSeconds,
        video.publishedAt,
        channel.region,
        decision.verdict,
        decision.category,
        JSON.stringify(decision.tags),
        decision.confidence,
        JSON.stringify(decision.reasons),
        decision.matchedKeyword,
        decision.excludedKeyword,
        routedTo,
      ],
    );
  });

  if (isUnplayable(video)) return;
  if (routedTo === "tracks") {
    if (upsertTrackFromVideo(channel, video, decision)) summary.routed.tracks += 1;
  } else if (routedTo === "sermons") {
    if (upsertSermonFromVideo(channel, video)) summary.routed.sermons += 1;
  } else if (routedTo === "videos") {
    if (upsertTrackFromVideo(channel, video, decision, "video")) summary.routed.videos += 1;
  } else if (routedTo === "reels") {
    if (upsertTrackFromVideo(channel, video, decision, "video")) summary.routed.reels += 1;
  }
}

/** Duration gates, in seconds. */
const SONG_MAX_SECONDS = 600; // 10 minutes

/** Per-channel overrides, keyed by YouTube channel id. */
type Route = "tracks" | "sermons" | "videos" | "reels";

/**
 * A channel whose uploads need their own rules. The general duration gates
 * below are the default; these are the exceptions a curator asked for by name,
 * and they win because a channel's own output is a stronger signal than any
 * length threshold.
 *
 * Returning `null` means "no override", and the video falls through to the
 * general rules.
 */
const CHANNEL_OVERRIDES: Record<string, (video: YouTubeVideo) => Route | null> = {
  // Mgasa TV: its shorts are reels, every one of them.
  "UCqh9_IF0fA_35lZYX515nOQ": (video) => (isShort(video) ? "reels" : null),

  // Hope Media Network - ECD: the Safari ya Tumaini Africa series is sermons.
  "UC65_-z_teW1syhCaglrM4iw": (video) =>
    /safari ya tumaini/i.test(video.title) ? "sermons" : null,

  // 2CBN TV: shorts are reels, anything over twenty minutes is a sermon, and
  // anything under ten minutes is music.
  "UClvDH3CYZJ3euTCMYD93mnA": (video) => {
    if (isShort(video)) return "reels";
    const duration = video.durationSeconds ?? 0;
    if (duration > 1200) return "sermons";
    if (duration < 600) return "tracks";
    return null;
  },
};

/**
 * A YouTube Short: tagged `#Shorts`, or under a minute. Reels are watched, not
 * listened to, so a short never becomes a song regardless of what it contains.
 */
function isShort(video: YouTubeVideo): boolean {
  const duration = video.durationSeconds ?? 0;
  return /#shorts?/i.test(video.title) || (duration > 0 && duration <= 60);
}

/**
 * Where a video goes, by length.
 *
 * The classifier answers "is this music?"; duration answers "what shelf a music
 * video belongs on". The two are separate questions and the length rules are
 * not negotiable:
 *
 *   - Over ten minutes is never a song. A sermon-length upload is a sermon or a
 *     watchable video, not a track on a listening page.
 *   - Four minutes or less is a reel: a clip, not a piece of music.
 *   - Between the two is a song, if the classifier says it is music.
 *
 * A missing duration falls through to the classifier rather than being guessed
 * at: a video whose length the API did not report is routed on its content, so
 * a long sermon is not promoted to a song and a short clip is not deleted.
 */
function routeVideo(
  channel: WhitelistedChannel,
  video: YouTubeVideo,
  decision: Classification,
): Route | null {
  const override = CHANNEL_OVERRIDES[channel.channel_id];
  if (override) {
    const forced = override(video);
    if (forced) return forced;
  }

  const duration = video.durationSeconds ?? 0;
  if (duration > SONG_MAX_SECONDS) {
    return decision.verdict === "sermon" ? "sermons" : "videos";
  }
  if (isReelLength(duration)) {
    return "reels";
  }
  if (decision.verdict === "music") return "tracks";
  if (decision.verdict === "sermon") return "sermons";
  return null;
}

/**
 * Music becomes an audio track.
 *
 * `kind` is `audio` rather than `hymn` even for hymnal content, because
 * `kind = 'hymn'` in this schema is reserved for the app's own 9,000-entry
 * hymnal library with lyrics and a tune. A YouTube recording of a hymn is a
 * recording; it belongs on the music page, and `sub_category = 'hymns'` is what
 * puts it in the Nyimbo za Kristo row.
 */
function upsertTrackFromVideo(
  channel: WhitelistedChannel,
  video: YouTubeVideo,
  decision: Classification,
  /**
   * `audio` lands on the music page as a song; `video` is a watchable upload
   * that belongs on the video grid and the reels feed. Duration routing in
   * `routeVideo` decides which, so a ten-minute choir performance is not filed
   * as a song and a two-minute clip is not either.
   */
  kind: "audio" | "video" = "audio",
): boolean {
  const existing = get<{ id: string }>(
    "SELECT id FROM tracks WHERE youtube_video_id = ?",
    [video.videoId],
  );
  if (existing) return false;

  const id = `yt-${video.videoId}`;
  // `mood` is what the music page uses for its instrumental rows, so the
  // category is mirrored there rather than duplicating filter logic.
  const mood = decision.category === "instrumentals" ? "Devotional" : null;

  // Built as column/value pairs and rendered into one statement, because a
  // hand-written column list and a hand-written VALUES list drift apart the
  // moment a column is added — and SQLite's "N values for M columns" error
  // then silently drops every music track while the run still reports success.
  const columns: [string, string | number | null][] = [
    ["id", id],
    ["title", video.title || "Untitled"],
    ["artist", channel.title],
    // "Single" rather than an album nobody made: the music page's square art
    // falls back to the channel thumbnail, which is the honest artwork here.
    ["album", "Single"],
    ["image", video.thumbnailUrl ?? ""],
    ["audio_url", null],
    ["video_url", `https://www.youtube.com/watch?v=${video.videoId}`],
    ["duration_seconds", video.durationSeconds],
    ["language", channel.language],
    ["kind", kind],
    ["genre", decision.category === "worship" ? "Worship" : titleCase(decision.category)],
    ["mood", mood],
    ["youtube_video_id", video.videoId],
    ["source", "youtube"],
    ["sub_category", decision.category],
    ["tags", JSON.stringify(decision.tags)],
    ["region", channel.region],
    ["source_channel_id", channel.channel_id],
    ["featured", 0],
    ["play_count", 0],
    ["view_count", video.viewCount],
    ["like_count", video.likeCount],
    ["is_live", video.isLive ? 1 : 0],
    ["status", "published"],
    ["published_at", video.publishedAt],
    ["created_at", "now"],
    ["updated_at", "now"],
  ];

  run(
    `INSERT INTO tracks (${columns.map(([column]) => column).join(", ")})
     VALUES (${columns
       .map(([, value]) => (value === "now" ? "strftime('%Y-%m-%dT%H:%M:%fZ','now')" : "?"))
       .join(", ")})`,
    columns.filter(([, value]) => value !== "now").map(([, value]) => value as string | number | null),
  );
  return true;
}

/** Anything the bouncer flagged becomes a sermon, never a song. */
function upsertSermonFromVideo(channel: WhitelistedChannel, video: YouTubeVideo): boolean {
  const existing = get<{ id: string }>("SELECT id FROM sermons WHERE youtube_video_id = ?", [video.videoId]);
  if (existing) return false;

  // Same column/value construction as `upsertTrackFromVideo`, for the same
  // reason. `titleCase` is not used here: a channel is not a person, so the
  // sermon list shows the channel name and the speaker facet links to the
  // church rather than a fabricated individual.
  const columns: [string, string | number | null][] = [
    ["id", `yt-sermon-${video.videoId}`],
    ["title", video.title || "Untitled message"],
    ["speaker", channel.title],
    ["image", video.thumbnailUrl ?? ""],
    ["duration_seconds", video.durationSeconds],
    ["language", channel.language],
    ["description", video.description.slice(0, 2_000) || null],
    ["video_url", `https://www.youtube.com/watch?v=${video.videoId}`],
    ["youtube_video_id", video.videoId],
    ["source", "youtube"],
    ["source_channel_id", channel.channel_id],
    ["play_count", 0],
    ["view_count", video.viewCount],
    ["like_count", video.likeCount],
    ["is_live", video.isLive ? 1 : 0],
    // Step A returns `category: null` for everything it excludes, which is every
    // sermon — so there is no bucket to store. The video page's "Sermons" chip
    // selects on the table a row came from, not this column.
    ["category", null],
    ["region", channel.region],
    ["status", "published"],
    ["published_at", video.publishedAt],
    ["created_at", "now"],
    ["updated_at", "now"],
  ];

  run(
    `INSERT INTO sermons (${columns.map(([column]) => column).join(", ")})
     VALUES (${columns
       .map(([, value]) => (value === "now" ? "strftime('%Y-%m-%dT%H:%M:%fZ','now')" : "?"))
       .join(", ")})`,
    columns.filter(([, value]) => value !== "now").map(([, value]) => value as string | number | null),
  );
  return true;
}

function titleCase(value: MusicCategory | null): string | null {
  if (!value) return null;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Re-runs the classifier over videos already recorded. Used after the keyword
 * lists change, so tightening the exclude filter can pull a sermon off the
 * music page without waiting for that channel to upload again.
 */
export function reclassifyPending(limit = 500): { examined: number; changed: number } {
  const rows = all<{
    id: string;
    video_id: string;
    title: string;
    description: string;
    duration_seconds: number;
    channel_id: string;
    verdict: string;
    category: string | null;
  }>(
    `SELECT v.id, v.video_id, v.title, v.description, v.duration_seconds, v.channel_id, v.verdict, v.category
       FROM youtube_videos v
      WHERE v.verdict != 'pending'
      ORDER BY v.updated_at DESC
      LIMIT ?`,
    [limit],
  );

  let changed = 0;
  for (const row of rows) {
    const channel = get<WhitelistedChannel>("SELECT * FROM youtube_channels WHERE channel_id = ?", [row.channel_id]);
    if (!channel) continue;
    const decision = classify({
      title: normalizeText(row.title),
      description: row.description,
      channelFocus: channel.focus as "music" | "preaching" | "mixed",
      durationSeconds: row.duration_seconds,
    });
    if (decision.verdict === row.verdict && decision.category === row.category) continue;

    run(
      `UPDATE youtube_videos
          SET verdict = ?, category = ?, tags = ?, confidence = ?, reasons = ?,
              matched_keyword = ?, excluded_keyword = ?, reclassified_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
              updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id = ?`,
      [
        decision.verdict,
        decision.category,
        JSON.stringify(decision.tags),
        decision.confidence,
        JSON.stringify(decision.reasons),
        decision.matchedKeyword,
        decision.excludedKeyword,
        row.id,
      ],
    );

    if (decision.verdict === "music" && decision.category) {
      const video = get<{ id: string; title: string; description: string; duration_seconds: number; published_at: string; thumbnail_url: string | null }>(
        "SELECT id, title, description, duration_seconds, published_at, thumbnail_url FROM youtube_videos WHERE id = ?",
        [row.id],
      );
      if (video) {
        upsertTrackFromVideo(
          channel,
          {
            videoId: row.video_id,
            title: video.title,
            description: video.description,
            durationSeconds: video.duration_seconds,
            publishedAt: video.published_at,
            thumbnailUrl: video.thumbnail_url,
            channelId: row.channel_id,
            viewCount: 0,
            likeCount: 0,
            channelTitle: channel.title,
            tags: [],
            isLive: false,
          },
          decision,
        );
      }
      // The video is music now; if it was ever filed as a sermon, that row has
      // to go. `tracks` and `sermons` never hold the same video_id.
      run("DELETE FROM sermons WHERE youtube_video_id = ?", [row.video_id]);
    }

    if (decision.verdict === "sermon") {
      // The mirror of the music branch. The docstring above promises a
      // re-tightened filter can "pull a sermon off the music page" — that needs
      // the sermon row to exist, not just the verdict column to change.
      const video = get<{ id: string; title: string; description: string; duration_seconds: number; published_at: string; thumbnail_url: string | null }>(
        "SELECT id, title, description, duration_seconds, published_at, thumbnail_url FROM youtube_videos WHERE id = ?",
        [row.id],
      );
      if (video) {
        upsertSermonFromVideo(
          channel,
          {
            videoId: row.video_id,
            title: video.title,
            description: video.description,
            durationSeconds: video.duration_seconds,
            publishedAt: video.published_at,
            thumbnailUrl: video.thumbnail_url,
            channelId: row.channel_id,
            viewCount: 0,
            likeCount: 0,
            channelTitle: channel.title,
            tags: [],
            isLive: false,
          },
        );
      }
      run("DELETE FROM tracks WHERE youtube_video_id = ?", [row.video_id]);
    }
    changed += 1;
  }
  return { examined: rows.length, changed };
}

/** Latest verdict per video, for the admin "what did the filter decide" view. */
export function recentVerdicts(limit = 100) {
  return all<{
    id: string;
    video_id: string;
    title: string;
    verdict: string;
    category: string | null;
    confidence: number;
    reasons: string;
    matched_keyword: string | null;
    excluded_keyword: string | null;
    created_at: string;
  }>(
    `SELECT id, video_id, title, verdict, category, confidence, reasons, matched_keyword, excluded_keyword, created_at
       FROM youtube_videos
      ORDER BY created_at DESC
      LIMIT ?`,
    [limit],
  ).map((row) => ({ ...row, reasons: parseJson<string[]>(row.reasons, []) }));
}
