import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../lib/async.ts";
import { validateQuery, validateParams, param } from "../../lib/validate.ts";
import { notFound } from "../../lib/errors.ts";
import { listVideosPage, videoDetail, videoFacetsPage } from "./service.ts";

export const videoPageRouter: Router = Router();

/**
 * `GET /api/video`
 *
 * The video grid. Deliberately a different URL from `/api/videos`, which is the
 * legacy `kind = 'video'` view and returns nothing for ingested content; this
 * one answers "what is watchable" across both tables.
 */
videoPageRouter.get(
  "/",
  validateQuery(
    z.object({
      category: z.string().trim().max(40).optional(),
      region: z.string().trim().max(40).optional(),
      q: z.string().trim().max(120).optional(),
      sort: z.enum(["newest", "views", "oldest", "added"]).optional(),
      limit: z.coerce.number().int().min(1).max(48).optional(),
      offset: z.coerce.number().int().min(0).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const query = req.query as Record<string, string | undefined>;
    const { items, total } = listVideosPage({
      category: query.category,
      region: query.region,
      q: query.q,
      sort: query.sort as never,
      limit: query.limit ? Number(query.limit) : undefined,
      offset: query.offset ? Number(query.offset) : undefined,
    });
    res.setHeader("X-Total-Count", String(total));
    res.json({ items, total });
  }),
);

/** `GET /api/video/facets` — the filter chips, with counts. */
videoPageRouter.get(
  "/facets",
  asyncHandler(async (_req, res) => {
    res.json(videoFacetsPage());
  }),
);

/**
 * `GET /api/video/:id` — the player page.
 *
 * Accepts either our row id (`yt-<videoId>`) or the bare YouTube id, because
 * that is what a link from the grid, a share sheet, or a search result will
 * carry.
 */
videoPageRouter.get(
  "/:id",
  validateParams(z.object({ id: z.string().trim().min(3).max(64) })),
  asyncHandler(async (req, res) => {
    const detail = videoDetail(param(req, "id"));
    if (!detail) throw notFound("Video");
    res.json(detail);
  }),
);
