/**
 * `GET /api/reels` — the feed.
 *
 * A separate router from `/api/videos` because the questions differ: the video
 * page asks "what is watchable, sorted by views", the feed asks "what do I want
 * to watch next" and answers with a shelf, a follow state and a comment count
 * on every card. The rows underneath are the same, so nothing is ingested twice.
 *
 * The response is an object rather than a bare array — unlike the other list
 * endpoints — because the feed has state of its own to report: which feed was
 * served, and whether the following feed was genuinely personalised or is
 * standing in for a reader who has not followed anything yet. The client needs
 * to be able to say so, and a header is the wrong place for a decision like that.
 */

import { Router } from "express";
import { z } from "zod";
import { get } from "../../db/client.ts";
import { asyncHandler } from "../../lib/async.ts";
import { param, validateParams, validateQuery } from "../../lib/validate.ts";
import { optionalAuth } from "../../middleware/auth.ts";
import { threadSummary } from "../community/comments-service.ts";
import { relatedContent } from "../community/links-service.ts";
import { reelCategories } from "./category.ts";
import { findReel, listReels, moreFromChannel, reelFacets } from "./service.ts";

export const reelsRouter: Router = Router();

const feedQuery = z.object({
  feed: z.enum(["for-you", "following"]).default("for-you"),
  category: z.string().trim().max(40).optional(),
  region: z.string().trim().max(60).optional(),
  limit: z.coerce.number().int().min(1).max(30).default(10),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});

reelsRouter.get(
  "/",
  optionalAuth,
  validateQuery(feedQuery),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as z.infer<typeof feedQuery>;
    const { items, total, feed, personalised } = listReels(query, req.auth?.id ?? null);
    res.json({ items, total, feed, personalised, hasMore: query.offset + query.limit < total });
  }),
);

reelsRouter.get(
  "/categories",
  optionalAuth,
  asyncHandler(async (req, res) => {
    res.json({ ...reelFacets(req.auth?.id ?? null), all: reelCategories });
  }),
);

/**
 * One reel, with what to show around it: the description, the comment summary,
 * more from the same channel, and whatever the links table and the inference
 * pass can find — the same `relatedContent` the article rail uses, so a reel and
 * an article about the same camp meeting point at each other.
 */
reelsRouter.get(
  "/:videoId",
  optionalAuth,
  validateParams(z.object({ videoId: z.string().trim().min(1).max(64) })),
  asyncHandler(async (req, res) => {
    const videoId = param(req, "videoId");
    const viewerId = req.auth?.id ?? null;
    const reel = findReel(videoId, viewerId);
    if (!reel) {
      res.status(404).json({ error: { code: "not_found", message: "Reel not found" } });
      return;
    }
    res.json({
      reel,
      description: descriptionOf(videoId),
      comments: threadSummary("reel", videoId),
      more: moreFromChannel(reel.channel, videoId, viewerId),
      related: relatedContent("reel", videoId, 8, ["article", "church", "reel"]),
    });
  }),
);

/**
 * The description lives once, in the ingest registry, and is the better source
 * for the feed because it is the text YouTube actually returned rather than the
 * copy the app stored — `tracks` and `sermons` have no description column.
 */
function descriptionOf(videoId: string): string {
  const row = get<{ description: string | null }>(
    "SELECT description FROM youtube_videos WHERE video_id = ?",
    [videoId],
  );
  return (row?.description ?? "").slice(0, 4_000);
}
