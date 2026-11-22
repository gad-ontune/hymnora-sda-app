/**
 * The reels feed's read model.
 *
 * Reels are not a new kind of content: every one of them is a row that
 * `modules/video/service.ts` already returns, addressed by its YouTube id. What
 * is new is that they are watched rather than listened to, and that a feed
 * needs to answer four questions the video grid never had to:
 *
 *   - Which shelf is this on?  `reel_category`, from `category.ts`.
 *   - Who is talking?         A followable channel, not an artist string.
 *   - What are people saying? A real comment count, from the server.
 *   - What should come next?  A stable per-video shuffle weight.
 *
 * The feed itself is built by reordering the same 86 rows the video page shows
 * rather than by adding a second ingest path, so a video can never appear on
 * the grid and be missing from the feed.
 */

import { all, get } from "../../db/client.ts";
import { followedIds, hiddenReelIds, isFollowing, likedReels, reelLikeCounts } from "../community/follows-service.ts";
import { threadSummaries } from "../community/comments-service.ts";
import { reelCategoryLabel, reelFeedWeight, isReelLength, type ReelCategoryId } from "./category.ts";
import { videoCatalogue, type VideoCard, type VideoSort } from "../video/service.ts";
import { regionName } from "../youtube/whitelist.ts";

export type ReelCard = VideoCard & {
  /** The feed shelf, which is not the same question as `category`. */
  reelCategory: ReelCategoryId;
  reelCategoryLabel: string;
  /** The channel, as a followable target. */
  channelId: string;
  channelFollowers: number;
  isFollowingChannel: boolean;
  commentCount: number;
  /** The heart on the action rail, counted from `reel_likes` and not a stored total. */
  likeCount: number;
  liked: boolean;
  /** Share copies, for the "Send to a friend" affordance. */
  shareCount: number;
  /** 0–1, stable per video, so the feed does not replay in one fixed order. */
  weight: number;
};

export type ReelFeed = "for-you" | "following";

export type ReelQuery = {
  feed?: ReelFeed;
  category?: string;
  region?: string;
  limit?: number;
  offset?: number;
};

function sourceChannelId(card: VideoCard): string {
  return (
    get<{ source_channel_id: string | null }>(
      `SELECT source_channel_id FROM tracks WHERE id = ? UNION ALL SELECT source_channel_id FROM sermons WHERE id = ? LIMIT 1`,
      [card.id, card.id],
    )?.source_channel_id ?? ""
  );
}

/** A reel's own line of the ingest registry, which is where the shelf lives. */
function storedReelCategory(videoId: string): { category: ReelCategoryId | null; channelId: string } {
  const row = get<{ reel_category: string | null; channel_id: string }>(
    "SELECT reel_category, channel_id FROM youtube_videos WHERE video_id = ?",
    [videoId],
  );
  return { category: (row?.reel_category as ReelCategoryId | null) ?? null, channelId: row?.channel_id ?? "" };
}

function followersOf(channelId: string): number {
  if (!channelId) return 0;
  return Number(
    get<{ total: number }>("SELECT COUNT(*) AS total FROM follows WHERE target_type = 'creator' AND target_id = ?", [
      channelId,
    ])?.total ?? 0,
  );
}

function shareCounts(videoIds: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  if (videoIds.length === 0) return counts;
  for (const row of all<{ to_id: string; total: number }>(
    `SELECT to_id, COUNT(*) AS total FROM content_links
     WHERE to_type = 'reel' AND relation = 'shared' AND to_id IN (${videoIds.map(() => "?").join(",")})
     GROUP BY to_id`,
    videoIds,
  )) {
    counts.set(row.to_id, Number(row.total));
  }
  return counts;
}

/**
 * The following feed.
 *
 * Everything a reader follows is reduced to two tests — is this reel's channel
 * one I follow, and does its shelf or region match something I follow — because
 * a feed that needs all of a person's follows to agree will usually show nothing
 * at all, and an empty feed reads as a broken one. A reader with nothing
 * followed at all gets the top of the general feed instead of a blank page.
 */
function followingFilter(viewerId: string): {
  channels: string[];
  shelves: string[];
  regions: string[];
  words: string[];
} {
  const channels = [
    ...followedIds(viewerId, "creator"),
    ...followedIds(viewerId, "choir"),
    ...followedIds(viewerId, "ministry"),
  ];
  const shelves: string[] = [];
  const words: string[] = [];
  for (const topic of followedIds(viewerId, "topic")) {
    const slug = topic.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (reelCategoryLabel(slug) !== "For you") shelves.push(slug);
    else words.push(topic);
  }
  for (const choir of followedIds(viewerId, "choir")) words.push(choir);
  for (const church of followedIds(viewerId, "church")) {
    const row = get<{ name: string; region: string | null }>("SELECT name, region FROM churches WHERE id = ?", [church]);
    if (row) {
      words.push(row.name);
      if (row.region) shelves.push(row.region);
    }
  }
  return { channels, shelves, words, regions: followedIds(viewerId, "region") };
}

export function listReels(query: ReelQuery = {}, viewerId: string | null = null): {
  items: ReelCard[];
  total: number;
  feed: ReelFeed;
  /** False when the reader follows nobody yet and the general feed is standing in. */
  personalised: boolean;
} {
  const limit = Math.min(30, Math.max(1, query.limit ?? 10));
  const offset = Math.max(0, query.offset ?? 0);
  const hidden = new Set(hiddenReelIds(viewerId));
  const sort: VideoSort = "newest";

  const catalogue = videoCatalogue(sort)
    .filter((card) => isReelLength(card.durationSeconds))
    .filter((card) => !hidden.has(card.videoId))
    .map((card) => {
      const stored = storedReelCategory(card.videoId);
      const category = stored.category ?? (card.category as ReelCategoryId);
      const channelId = stored.channelId || sourceChannelId(card);
      return { card, category, channelId, weight: reelFeedWeight(card.videoId) };
    });

  const scoped = catalogue.filter(({ card, category }) => {
    if (query.category && query.category !== "all" && category !== query.category) return false;
    if (query.region && query.region !== "all" && card.region !== query.region) return false;
    return true;
  });

  const feed = query.feed === "following" ? "following" : "for-you";
  const shuffled = [...scoped].sort((a, b) => b.weight - a.weight);
  let ordered = shuffled;
  let personalised = false;

  if (feed === "following" && viewerId) {
    const { channels, shelves, regions, words } = followingFilter(viewerId);
    const followed = scoped.filter(({ card, category, channelId }) => {
      if (channels.includes(channelId)) return true;
      if (regions.includes(card.region)) return true;
      if (shelves.includes(category) || shelves.includes(card.region)) return true;
      const haystack = `${card.title} ${card.channel}`.toLowerCase();
      return words.some((word) => word.length > 2 && haystack.includes(word.toLowerCase()));
    });
    ordered = followed.length > 0 ? followed.sort((a, b) => b.weight - a.weight) : shuffled;
    // Reported, not assumed: a reader who follows a channel that has published
    // nothing, or a topic with no shelf on it, is served the general feed, and
    // the client says so rather than showing an empty page and looking broken.
    personalised = followed.length > 0;
  }

  const page = ordered.slice(offset, offset + limit);
  const videoIds = page.map(({ card }) => card.videoId);
  const summaries = threadSummaries("reel", videoIds);
  const shares = shareCounts(videoIds);
  const likes = reelLikeCounts(videoIds);
  const liked = likedReels(viewerId, videoIds);

  return {
    items: page.map(({ card, category, channelId }) => ({
      ...card,
      reelCategory: category,
      reelCategoryLabel: reelCategoryLabel(category),
      channelId,
      channelFollowers: followersOf(channelId),
      isFollowingChannel: isFollowing(viewerId, "creator", channelId),
      commentCount: summaries.get(card.videoId)?.comments ?? 0,
      likeCount: likes.get(card.videoId) ?? 0,
      liked: liked.has(card.videoId),
      shareCount: shares.get(card.videoId) ?? 0,
      weight: reelFeedWeight(card.videoId),
    })),
    total: ordered.length,
    feed,
    personalised,
  };
}

/**
 * One reel by its YouTube id, shaped exactly like a feed card.
 *
 * The feed slices the catalogue to 30 rows per page, so the old
 * `listReels({ limit: 30 }).find(...)` 404'd every reel that did not happen to
 * land in the first page of a shuffled feed — a shared deep link to any other
 * reel was dead. The catalogue itself is unpaginated, so the lookup goes there.
 */
export function findReel(videoId: string, viewerId: string | null): ReelCard | null {
  const card = videoCatalogue("newest").find((entry) => entry.videoId === videoId && isReelLength(entry.durationSeconds));
  if (!card) return null;
  return reelCardFrom(card, viewerId, shareCounts([videoId]).get(videoId) ?? 0);
}

/** A single card carrying the same follow, comment and like state the feed serves. */
function reelCardFrom(card: VideoCard, viewerId: string | null, shareCount: number): ReelCard {
  const stored = storedReelCategory(card.videoId);
  const channelId = stored.channelId || sourceChannelId(card);
  const category = stored.category ?? (card.category as ReelCategoryId);
  return {
    ...card,
    reelCategory: category,
    reelCategoryLabel: reelCategoryLabel(category),
    channelId,
    channelFollowers: followersOf(channelId),
    isFollowingChannel: isFollowing(viewerId, "creator", channelId),
    commentCount: threadSummaries("reel", [card.videoId]).get(card.videoId)?.comments ?? 0,
    likeCount: reelLikeCounts([card.videoId]).get(card.videoId) ?? 0,
    liked: likedReels(viewerId, [card.videoId]).has(card.videoId),
    shareCount,
    weight: reelFeedWeight(card.videoId),
  };
}

/**
 * More from the same channel, for the rail under a single reel.
 *
 * Built through the same card builder as `findReel` so the rail carries the
 * same follow state and comment count as the feed — a rail whose buttons
 * disagree with the feed is how a user ends up following the same channel twice.
 */
export function moreFromChannel(
  channel: string,
  excludeVideoId: string,
  viewerId: string | null,
  limit = 8,
): ReelCard[] {
  return videoCatalogue("newest")
    .filter((card) => card.channel === channel && card.videoId !== excludeVideoId && isReelLength(card.durationSeconds))
    .slice(0, limit)
    .map((card) => reelCardFrom(card, viewerId, 0));
}

/** Shelf counts for the Categories tab, so an empty shelf is never offered. */
export function reelFacets(viewerId: string | null = null): {
  categories: { id: ReelCategoryId; label: string; count: number }[];
  regions: { id: string; label: string; count: number }[];
  total: number;
} {
  const hidden = new Set(hiddenReelIds(viewerId));
  const counts = new Map<ReelCategoryId, number>();
  const regionCounts = new Map<string, number>();
  let total = 0;
  for (const { card, category } of catalogueForFacets(hidden)) {
    counts.set(category, (counts.get(category) ?? 0) + 1);
    if (card.region) regionCounts.set(card.region, (regionCounts.get(card.region) ?? 0) + 1);
    total += 1;
  }
  return {
    categories: [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([id, count]) => ({ id, label: reelCategoryLabel(id), count })),
    regions: [...regionCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([id, count]) => ({ id, label: regionName(id), count })),
    total,
  };
}

function catalogueForFacets(hidden: Set<string>): { card: VideoCard; category: ReelCategoryId }[] {
  return videoCatalogue("newest")
    .filter((card) => !hidden.has(card.videoId) && isReelLength(card.durationSeconds))
    .map((card) => ({ card, category: storedReelCategory(card.videoId).category ?? (card.category as ReelCategoryId) }));
}
