/**
 * Follows, comments and content links.
 *
 * Three surfaces that used to be client-side only, now with routes. Reads are
 * public — a reel's comment count and a church's follower count are shown to
 * people who have not signed in — so this router is mounted without a blanket
 * `requireAuth` and gates the writes instead, exactly as `churches` does.
 */

import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../lib/async.ts";
import { param, validateBody, validateParams, validateQuery } from "../../lib/validate.ts";
import { currentUserId, optionalAuth, requireAuth, requireEditor } from "../../middleware/auth.ts";
import { writeLimiter } from "../../middleware/rate-limit.ts";
import {
  commentBodySchema,
  commentParamsSchema,
  commentTargetTypes,
  createComment,
  deleteComment,
  likeComment,
  listComments,
} from "./comments-service.ts";
import {
  followCounts,
  followInputSchema,
  followParamsSchema,
  followsSummary,
  followTarget,
  hideReel,
  isFollowing,
  likeReel,
  listFollows,
  unfollowTarget,
  unhideReel,
} from "./follows-service.ts";
import { createLink, deleteLink, linkBodySchema, linkQuerySchema, listLinks } from "./links-service.ts";

export const communityRouter: Router = Router();

// ─── Follows ──────────────────────────────────────────────────────────────────

/**
 * Everything this account follows, in one list.
 *
 * Churches come from `followed_churches` and the rest from `follows`, merged
 * here rather than in the client, so the "Following" tab and the
 * "Followed churches" bar read the same thing.
 */
communityRouter.get(
  "/follows",
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.auth!.id;
    res.json({ items: listFollows(userId), summary: followsSummary(userId) });
  }),
);

communityRouter.get(
  "/follows/summary",
  asyncHandler(async (req, res) => {
    res.json(followsSummary(req.auth?.id ?? ""));
  }),
);

/** Public counters, so a Follow button can read "1.2k following" before sign-in. */
communityRouter.get(
  "/follows/count",
  validateQuery(z.object({ type: followParamsSchema.shape.type, id: followParamsSchema.shape.id })),
  asyncHandler(async (req, res) => {
    const viewerId = currentUserId(req);
    const { type, id } = req.query as { type: "creator" | "choir" | "church" | "ministry" | "topic" | "region"; id: string };
    res.json({ ...followCounts(type, id), following: isFollowing(viewerId, type, id) });
  }),
);

communityRouter.post(
  "/follows",
  requireAuth,
  writeLimiter,
  validateBody(followInputSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(followTarget(req.auth!.id, req.body.type, req.body.id, req.body.label, req.body.notifyNew));
  }),
);

communityRouter.delete(
  "/follows/:type/:id",
  requireAuth,
  writeLimiter,
  validateParams(followParamsSchema),
  asyncHandler(async (req, res) => {
    const { type, id } = req.params as { type: "creator" | "choir" | "church" | "ministry" | "topic" | "region"; id: string };
    res.json(unfollowTarget(req.auth!.id, type, id));
  }),
);

// ─── "Not interested" ─────────────────────────────────────────────────────────

communityRouter.post(
  "/reels/:videoId/like",
  requireAuth,
  writeLimiter,
  validateParams(z.object({ videoId: z.string().trim().min(1).max(64) })),
  asyncHandler(async (req, res) => {
    res.json(likeReel(req.auth!.id, param(req, "videoId")));
  }),
);

communityRouter.delete(
  "/reels/:videoId/like",
  requireAuth,
  writeLimiter,
  validateParams(z.object({ videoId: z.string().trim().min(1).max(64) })),
  asyncHandler(async (req, res) => {
    // The same handler, because "unlike" and "like" are one fact about the pair
    // (user, video) and a DELETE that inserts would be a lie about the method.
    res.json(likeReel(req.auth!.id, param(req, "videoId")));
  }),
);

communityRouter.post(
  "/reels/:videoId/hide",
  requireAuth,
  writeLimiter,
  validateParams(z.object({ videoId: z.string().trim().min(1).max(64) })),
  validateBody(z.object({ reason: z.string().trim().max(120).optional() })),
  asyncHandler(async (req, res) => {
    res.json(hideReel(req.auth!.id, param(req, "videoId"), req.body.reason));
  }),
);

communityRouter.delete(
  "/reels/:videoId/hide",
  requireAuth,
  writeLimiter,
  validateParams(z.object({ videoId: z.string().trim().min(1).max(64) })),
  asyncHandler(async (req, res) => {
    res.json(unhideReel(req.auth!.id, param(req, "videoId")));
  }),
);

// ─── Comments ─────────────────────────────────────────────────────────────────

const commentQuery = z.object({
  targetType: z.enum(commentTargetTypes),
  targetId: z.string().trim().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

communityRouter.get(
  "/comments",
  optionalAuth,
  validateQuery(commentQuery),
  asyncHandler(async (req, res) => {
    const { targetType, targetId, limit, offset } = req.query as unknown as z.infer<typeof commentQuery>;
    res.json(listComments(targetType, targetId, currentUserId(req), limit, offset));
  }),
);

communityRouter.post(
  "/comments",
  requireAuth,
  writeLimiter,
  validateBody(commentBodySchema),
  asyncHandler(async (req, res) => {
    const comment = createComment(req.auth!.id, {
      targetType: req.body.targetType,
      targetId: req.body.targetId,
      body: req.body.body,
      parentId: req.body.parentId ?? null,
    });
    res.status(201).json(comment);
  }),
);

communityRouter.post(
  "/comments/:id/like",
  requireAuth,
  writeLimiter,
  validateParams(commentParamsSchema),
  asyncHandler(async (req, res) => {
    res.json(likeComment(param(req, "id"), req.auth!.id));
  }),
);

communityRouter.delete(
  "/comments/:id",
  requireAuth,
  writeLimiter,
  validateParams(commentParamsSchema),
  asyncHandler(async (req, res) => {
    res.json(deleteComment(param(req, "id"), req.auth!.id, req.auth!.role));
  }),
);

// ─── Content links ────────────────────────────────────────────────────────────

communityRouter.get(
  "/links",
  validateQuery(linkQuerySchema),
  asyncHandler(async (req, res) => {
    const { fromType, fromId, direction, limit } = req.query as unknown as z.infer<typeof linkQuerySchema>;
    res.json({ items: listLinks(fromType, fromId, direction, limit) });
  }),
);

communityRouter.post(
  "/links",
  // Editorial surface: a link decides what an article points at, so it is
  // gated on the content role rather than on being signed in — the old
  // `requireAuth` let any member repoint or (below) delete any link.
  requireEditor,
  writeLimiter,
  validateBody(linkBodySchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(createLink(req.body));
  }),
);

communityRouter.delete(
  "/links/:id",
  requireEditor,
  writeLimiter,
  validateParams(z.object({ id: z.string().trim().min(1).max(64) })),
  asyncHandler(async (req, res) => {
    res.json(deleteLink(param(req, "id")));
  }),
);
