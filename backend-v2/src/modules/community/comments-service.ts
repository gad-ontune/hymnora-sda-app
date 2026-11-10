/**
 * Comment threads on anything that can be discussed.
 *
 * There was no comment table in this backend at all, which is why every comment
 * box in the app was writing to `localStorage`: the thread you saw was only ever
 * on that device. This is the server-side thread — a reel, an article, a
 * church, a track — with the three things a thread needs to survive a refresh:
 * a real author, a real timestamp, and a delete a moderator can enforce.
 *
 * Two decisions worth stating. Threads are two levels, not an arbitrary tree:
 * `parent_id` is either `null` or the id of a top-level comment, so a reply
 * cannot be replied to and no client has to render unbounded nesting. And
 * deletes are soft — a thread is a public conversation, and a comment other
 * people have replied to should not vanish from under them.
 */

import { z } from "zod";
import { all, count, get, run, transaction } from "../../db/client.ts";
import { forbidden, notFound } from "../../lib/errors.ts";
import { newId } from "../../lib/http.ts";

export const commentTargetTypes = ["reel", "article", "church", "track", "sermon", "event"] as const;
export type CommentTargetType = (typeof commentTargetTypes)[number];

export type CommentAuthor = {
  id: string;
  name: string;
  avatarUrl: string | null;
};

export type Comment = {
  id: string;
  targetType: CommentTargetType;
  targetId: string;
  body: string;
  likeCount: number;
  liked: boolean;
  createdAt: string;
  author: CommentAuthor;
  replies: Comment[];
  replyCount: number;
};

export type CommentThread = {
  items: Comment[];
  total: number;
  summary: { comments: number; likes: number; participants: number };
};

export const commentBodySchema = z.object({
  targetType: z.enum(commentTargetTypes),
  targetId: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1, "Write something first").max(2000),
  parentId: z.string().trim().max(64).nullable().optional(),
});

export const commentParamsSchema = z.object({ id: z.string().trim().min(1).max(64) });

type CommentRow = {
  id: string;
  target_type: string;
  target_id: string;
  body: string;
  like_count: number;
  created_at: string;
  parent_id: string | null;
  status: string;
  deleted_at: string | null;
  author_id: string;
  author_name: string;
  author_avatar: string | null;
  reply_count: number;
};

/**
 * The display name every other part of the app shows for a member, so a comment
 * and the account behind it are recognisably the same person.
 */
const authorName = `COALESCE(NULLIF(TRIM(u.display_name), ''), NULLIF(TRIM(u.first_name || ' ' || u.last_name), ''), 'Hymnora member')`;

const selectComments = `
  SELECT c.id, c.target_type, c.target_id, c.body, c.like_count, c.created_at, c.parent_id,
         c.status, c.deleted_at,
         u.id AS author_id, ${authorName} AS author_name, u.avatar_url AS author_avatar,
         (SELECT COUNT(*) FROM content_comments r
          WHERE r.parent_id = c.id AND r.status = 'published' AND r.deleted_at IS NULL) AS reply_count
  FROM content_comments c
  JOIN users u ON u.id = c.user_id
`;

function toComment(row: CommentRow, liked: boolean, replies: Comment[] = []): Comment {
  return {
    id: row.id,
    targetType: row.target_type as CommentTargetType,
    targetId: row.target_id,
    body: row.body,
    likeCount: Number(row.like_count),
    liked,
    createdAt: row.created_at,
    author: { id: row.author_id, name: row.author_name, avatarUrl: row.author_avatar },
    replies,
    replyCount: Number(row.reply_count),
  };
}

/**
 * `liked` is resolved after the fact rather than with a correlated subquery in
 * the select list: a `?` inside the list would have to be bound before the
 * `WHERE` parameters, and that ordering is invisible at the call site and easy
 * to break the next time someone adds a filter.
 */
function likedSet(viewerId: string | null, ids: string[]): Set<string> {
  if (!viewerId || ids.length === 0) return new Set();
  const placeholders = ids.map(() => "?").join(",");
  return new Set(
    all<{ comment_id: string }>(`SELECT comment_id FROM comment_likes WHERE user_id = ? AND comment_id IN (${placeholders})`, [
      viewerId,
      ...ids,
    ]).map((row) => row.comment_id),
  );
}

/**
 * One page of a thread, with every reply inlined under its parent.
 *
 * Replies come back in the same response as the comment they answer: someone who
 * opens a thread to reply should not need a second request to discover they have
 * already been answered, and the same replies listed flat at the bottom would be
 * a worse conversation than the same replies in place.
 */
export function listComments(
  targetType: CommentTargetType,
  targetId: string,
  viewerId: string | null,
  limit = 20,
  offset = 0,
): CommentThread {
  const topLevel = all<CommentRow>(
    `${selectComments}
     WHERE c.target_type = ? AND c.target_id = ? AND c.parent_id IS NULL
       AND c.status = 'published' AND c.deleted_at IS NULL
     ORDER BY c.created_at DESC
     LIMIT ? OFFSET ?`,
    [targetType, targetId, limit, offset],
  );
  const parents = topLevel.map((row) => row.id);
  const replyRows = parents.length
    ? all<CommentRow>(
        `${selectComments}
         WHERE c.parent_id IN (${parents.map(() => "?").join(",")})
           AND c.status = 'published' AND c.deleted_at IS NULL
         ORDER BY c.created_at`,
        parents,
      )
    : [];
  const liked = likedSet(viewerId, [...parents, ...replyRows.map((row) => row.id)]);
  const repliesByParent = new Map<string, Comment[]>();
  for (const row of replyRows) {
    const bucket = repliesByParent.get(row.parent_id ?? "") ?? [];
    bucket.push(toComment(row, liked.has(row.id)));
    repliesByParent.set(row.parent_id ?? "", bucket);
  }

  return {
    items: topLevel.map((row) => toComment(row, liked.has(row.id), repliesByParent.get(row.id) ?? [])),
    total: count(
      `SELECT COUNT(*) AS total FROM content_comments
       WHERE target_type = ? AND target_id = ? AND parent_id IS NULL AND status = 'published' AND deleted_at IS NULL`,
      [targetType, targetId],
    ),
    summary: threadSummary(targetType, targetId),
  };
}

/** Comment and like counts for a whole surface, for a card that is not a thread. */
export function threadSummary(
  targetType: CommentTargetType,
  targetId: string,
): { comments: number; likes: number; participants: number } {
  const row = get<{ comments: number; likes: number; participants: number }>(
    `SELECT COUNT(*) AS comments,
            COALESCE(SUM(like_count), 0) AS likes,
            COUNT(DISTINCT user_id) AS participants
     FROM content_comments
     WHERE target_type = ? AND target_id = ? AND status = 'published' AND deleted_at IS NULL`,
    [targetType, targetId],
  );
  return {
    comments: Number(row?.comments ?? 0),
    likes: Number(row?.likes ?? 0),
    participants: Number(row?.participants ?? 0),
  };
}

/** Counts for many targets at once, so a feed of 40 reels is not 40 queries. */
export function threadSummaries(
  targetType: CommentTargetType,
  targetIds: string[],
): Map<string, { comments: number; likes: number; participants: number }> {
  const summaries = new Map<string, { comments: number; likes: number; participants: number }>();
  if (targetIds.length === 0) return summaries;
  const rows = all<{ target_id: string; comments: number; likes: number; participants: number }>(
    `SELECT target_id, COUNT(*) AS comments, COALESCE(SUM(like_count), 0) AS likes,
            COUNT(DISTINCT user_id) AS participants
     FROM content_comments
     WHERE target_type = ? AND target_id IN (${targetIds.map(() => "?").join(",")})
       AND status = 'published' AND deleted_at IS NULL
     GROUP BY target_id`,
    [targetType, ...targetIds],
  );
  for (const row of rows) {
    summaries.set(row.target_id, {
      comments: Number(row.comments),
      likes: Number(row.likes),
      participants: Number(row.participants),
    });
  }
  return summaries;
}

function findComment(id: string): CommentRow {
  const row = get<CommentRow>(`${selectComments} WHERE c.id = ?`, [id]);
  if (!row) throw notFound("Comment");
  return row;
}

export function createComment(
  authorId: string,
  input: { targetType: CommentTargetType; targetId: string; body: string; parentId?: string | null },
): Comment {
  const body = input.body.trim();
  let parentId: string | null = null;
  if (input.parentId) {
    const parent = findComment(input.parentId);
    // A reply to a reply is flattened onto the thread it belongs to: two levels
    // is a rendering contract the clients already rely on.
    parentId = parent.parent_id ?? parent.id;
  }
  const id = newId();
  run(
    `INSERT INTO content_comments (id, target_type, target_id, user_id, parent_id, body)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, input.targetType, input.targetId, authorId, parentId, body],
  );
  return toComment(findComment(id), false);
}

export function likeComment(commentId: string, userId: string): { liked: boolean; likeCount: number } {
  const row = findComment(commentId);
  const existing = get<{ found: number }>("SELECT 1 AS found FROM comment_likes WHERE comment_id = ? AND user_id = ?", [
    commentId,
    userId,
  ]);
  transaction(() => {
    if (existing) {
      run("DELETE FROM comment_likes WHERE comment_id = ? AND user_id = ?", [commentId, userId]);
      run("UPDATE content_comments SET like_count = MAX(like_count - 1, 0) WHERE id = ?", [commentId]);
    } else {
      run("INSERT INTO comment_likes (comment_id, user_id) VALUES (?, ?)", [commentId, userId]);
      run("UPDATE content_comments SET like_count = like_count + 1 WHERE id = ?", [commentId]);
    }
  });
  const updated = get<{ like_count: number }>("SELECT like_count FROM content_comments WHERE id = ?", [row.id]);
  return { liked: !existing, likeCount: Number(updated?.like_count ?? 0) };
}

export function deleteComment(commentId: string, userId: string, role: string): { deleted: boolean } {
  const row = findComment(commentId);
  const isModerator = role === "moderator" || role === "admin" || role === "editor";
  if (row.author_id !== userId && !isModerator) throw forbidden("You can only delete your own comments");
  run("UPDATE content_comments SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?", [commentId]);
  return { deleted: true };
}
