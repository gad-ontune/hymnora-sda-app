/**
 * Following, everywhere at once.
 *
 * `followed_churches` already existed and is still the source of truth for
 * churches, because it carries a `notify_live` flag the live page reads. This
 * module is the surface the rest of the app follows through: creators, choirs,
 * ministries, topics and regions live in `follows`, churches are read from
 * `followed_churches` and merged in, and the reader gets one list and one
 * summary rather than learning which table backs which button.
 *
 * The split is deliberate and only about storage. A follow is a follow: same
 * route shape, same write limiter, same 401, and `church` in `follows` is
 * rejected so that a church cannot end up followed twice under two tables and
 * then be unfollowed through the wrong one.
 */

import { z } from "zod";
import { all, get, run } from "../../db/client.ts";
import { unprocessable } from "../../lib/errors.ts";

export const followTargetTypes = ["creator", "choir", "church", "ministry", "topic", "region"] as const;
export type FollowTargetType = (typeof followTargetTypes)[number];

export type FollowEntry = {
  type: FollowTargetType;
  id: string;
  label: string;
  /** Extra shape the target needs to render itself: region, focus, followers. */
  meta: Record<string, unknown>;
  notifyNew: boolean;
  createdAt: string;
};

export type FollowsSummary = {
  total: number;
  churches: number;
  creators: number;
  topics: number;
  regions: number;
  ministries: number;
  choirs: number;
};

export const followInputSchema = z.object({
  type: z.enum(followTargetTypes),
  id: z.string().trim().min(1).max(200),
  label: z.string().trim().min(1).max(200),
  notifyNew: z.boolean().default(true),
});

export const followParamsSchema = z.object({ type: z.enum(followTargetTypes), id: z.string().trim().min(1).max(200) });

type FollowRow = {
  target_type: string;
  target_id: string;
  label: string;
  notify_new: number;
  created_at: string;
};

/**
 * Churches are stored in `followed_churches`; everything else in `follows`.
 * A `church` row in `follows` is treated as corruption and skipped rather than
 * merged, because reporting it as followed when the unfollow button clears the
 * other table is the exact bug this table was added to prevent.
 */
export function listFollows(userId: string): FollowEntry[] {
  const rows = all<FollowRow>(
    `SELECT target_type, target_id, label, notify_new, created_at
     FROM follows WHERE user_id = ? AND target_type != 'church'
     ORDER BY created_at DESC, target_type, target_id`,
    [userId],
  );
  const churches = all<{ id: string; name: string; city: string; country: string; region: string; notify_live: number; created_at: string }>(
    `SELECT c.id, c.name, c.city, c.country, c.region, f.notify_live, f.created_at
     FROM followed_churches f
     JOIN churches c ON c.id = f.church_id AND c.deleted_at IS NULL
     WHERE f.user_id = ? ORDER BY c.name`,
    [userId],
  );
  return [
    ...rows.map((row) => ({
      type: row.target_type as FollowTargetType,
      id: row.target_id,
      label: row.label,
      meta: {} as Record<string, unknown>,
      notifyNew: row.notify_new === 1,
      createdAt: row.created_at,
    })),
    ...churches.map((church) => ({
      type: "church" as FollowTargetType,
      id: church.id,
      label: church.name,
      meta: { city: church.city, country: church.country, region: church.region },
      notifyNew: church.notify_live === 1,
      createdAt: church.created_at,
    })),
  ];
}

/**
 * `follows.target_type` is singular and the summary is plural, so the two are
 * named side by side rather than derived — a pluralisation rule here would also
 * have to know that `ministries` is spelled with an `i`.
 *
 * `church` is null on purpose: churches are counted from `followed_churches`
 * below, and a stray row must not be counted in both places.
 */
const SUMMARY_KEY: Record<FollowTargetType, keyof FollowsSummary | null> = {
  creator: "creators",
  choir: "choirs",
  church: null,
  ministry: "ministries",
  topic: "topics",
  region: "regions",
};

export function followsSummary(userId: string): FollowsSummary {
  const rows = all<{ target_type: string; total: number }>(
    "SELECT target_type, COUNT(*) AS total FROM follows WHERE user_id = ? GROUP BY target_type",
    [userId],
  );
  const summary: FollowsSummary = { total: 0, churches: 0, creators: 0, topics: 0, regions: 0, ministries: 0, choirs: 0 };
  for (const row of rows) {
    const key = SUMMARY_KEY[row.target_type as FollowTargetType];
    if (!key || key === "total") continue;
    summary[key] = Number(row.total);
  }
  summary.churches = Number(
    get<{ total: number }>("SELECT COUNT(*) AS total FROM followed_churches WHERE user_id = ?", [userId])?.total ?? 0,
  );
  summary.total = summary.creators + summary.choirs + summary.ministries + summary.topics + summary.regions + summary.churches;
  return summary;
}

/** A labelled follow: the Follow buttons know the display name, and it is stored with the follow. */
export function followTarget(
  userId: string,
  type: FollowTargetType,
  targetId: string,
  label: string,
  notifyNew = true,
): { following: boolean } {
  if (type === "church") throw unprocessable("Churches are followed through /api/churches/:idOrSlug/follow");
  run(
    `INSERT INTO follows (user_id, target_type, target_id, label, notify_new) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, target_type, target_id) DO UPDATE SET label = excluded.label, notify_new = excluded.notify_new`,
    [userId, type, targetId, label, notifyNew ? 1 : 0],
  );
  return { following: true };
}

export function unfollowTarget(userId: string, type: FollowTargetType, targetId: string): { following: boolean } {
  if (type === "church") throw unprocessable("Churches are unfollowed through /api/churches/:idOrSlug/follow");
  run("DELETE FROM follows WHERE user_id = ? AND target_type = ? AND target_id = ?", [userId, type, targetId]);
  return { following: false };
}

/** The ids a user follows of one type, for a feed filter. */
export function followedIds(userId: string | null, type: FollowTargetType): string[] {
  if (!userId) return [];
  if (type === "church") {
    return all<{ church_id: string }>("SELECT church_id FROM followed_churches WHERE user_id = ?", [userId]).map(
      (row) => row.church_id,
    );
  }
  return all<{ target_id: string }>(
    "SELECT target_id FROM follows WHERE user_id = ? AND target_type = ?",
    [userId, type],
  ).map((row) => row.target_id);
}

/** Public counters for a Follow button, so it can read "1.2k following" before login. */
export function followCounts(type: FollowTargetType, targetId: string): { followers: number; following: boolean } {
  const followers =
    type === "church"
      ? Number(
          get<{ total: number }>("SELECT COUNT(*) AS total FROM followed_churches WHERE church_id = ?", [targetId])?.total ?? 0,
        )
      : Number(
          get<{ total: number }>("SELECT COUNT(*) AS total FROM follows WHERE target_type = ? AND target_id = ?", [
            type,
            targetId,
          ])?.total ?? 0,
        );
  return { followers, following: false };
}

export function isFollowing(userId: string | null, type: FollowTargetType, targetId: string): boolean {
  if (!userId) return false;
  if (type === "church") {
    return Boolean(
      get<{ found: number }>("SELECT 1 AS found FROM followed_churches WHERE user_id = ? AND church_id = ?", [
        userId,
        targetId,
      ]),
    );
  }
  return Boolean(
    get<{ found: number }>("SELECT 1 AS found FROM follows WHERE user_id = ? AND target_type = ? AND target_id = ?", [
      userId,
      type,
      targetId,
    ]),
  );
}

// ─── Likes on a reel ──────────────────────────────────────────────────────────

/**
 * A like is one row, and the count is derived from the table rather than kept as
 * a counter: a counter on `youtube_videos` drifts the moment a row is deleted,
 * and a heart that says 240 while the table says 239 is the kind of thing a
 * reader notices.
 */
export function likeReel(userId: string, videoId: string): { liked: boolean; likeCount: number } {
  const existing = get<{ found: number }>("SELECT 1 AS found FROM reel_likes WHERE user_id = ? AND video_id = ?", [
    userId,
    videoId,
  ]);
  if (existing) {
    run("DELETE FROM reel_likes WHERE user_id = ? AND video_id = ?", [userId, videoId]);
  } else {
    run("INSERT INTO reel_likes (user_id, video_id) VALUES (?, ?)", [userId, videoId]);
  }
  return { liked: !existing, likeCount: reelLikeCount(videoId) };
}

export function reelLikeCount(videoId: string): number {
  return Number(
    get<{ total: number }>("SELECT COUNT(*) AS total FROM reel_likes WHERE video_id = ?", [videoId])?.total ?? 0,
  );
}

export function reelLikeCounts(videoIds: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  if (videoIds.length === 0) return counts;
  for (const row of all<{ video_id: string; total: number }>(
    `SELECT video_id, COUNT(*) AS total FROM reel_likes WHERE video_id IN (${videoIds.map(() => "?").join(",")})
     GROUP BY video_id`,
    videoIds,
  )) {
    counts.set(row.video_id, Number(row.total));
  }
  return counts;
}

export function likedReels(userId: string | null, videoIds: string[]): Set<string> {
  if (!userId || videoIds.length === 0) return new Set();
  return new Set(
    all<{ video_id: string }>(
      `SELECT video_id FROM reel_likes WHERE user_id = ? AND video_id IN (${videoIds.map(() => "?").join(",")})`,
      [userId, ...videoIds],
    ).map((row) => row.video_id),
  );
}

// ─── "Not interested" ─────────────────────────────────────────────────────────

/**
 * Hidden reels are server-side because the promise is "this will not come back",
 * and local state cannot keep that promise across a sign-in or a new device.
 */
export function hideReel(userId: string, videoId: string, reason?: string | null): { hidden: boolean } {
  run("INSERT OR REPLACE INTO reel_hidden (user_id, video_id, reason) VALUES (?, ?, ?)", [
    userId,
    videoId,
    reason ?? null,
  ]);
  return { hidden: true };
}

export function unhideReel(userId: string, videoId: string): { hidden: boolean } {
  run("DELETE FROM reel_hidden WHERE user_id = ? AND video_id = ?", [userId, videoId]);
  return { hidden: false };
}

export function hiddenReelIds(userId: string | null): string[] {
  if (!userId) return [];
  return all<{ video_id: string }>("SELECT video_id FROM reel_hidden WHERE user_id = ?", [userId]).map(
    (row) => row.video_id,
  );
}
