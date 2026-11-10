import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../lib/async.ts";
import { validateQuery } from "../../lib/validate.ts";
import { notFound } from "../../lib/errors.ts";
import {
  browseMusic,
  musicCategories,
  musicHome,
  musicMixTracks,
  musicRegions,
} from "./service.ts";

export const musicRouter: Router = Router();

/**
 * `GET /api/music/home` — the whole Spotify-style page in one payload.
 *
 * The frontend would otherwise need six round trips to draw a ring of bubbles
 * and eight rows, and the shapes share a hero track that has to be excluded
 * from every one of them. Resolving that on the server is the only way the
 * exclusion is correct.
 */
musicRouter.get(
  "/home",
  validateQuery(
    z.object({
      limit: z.coerce.number().int().min(4).max(24).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    res.json(musicHome({ limit: Number(req.query.limit) || undefined }));
  }),
);

/** `GET /api/music/mixes/:slug` — one bubble's track list. */
musicRouter.get(
  "/mixes/:slug",
  validateQuery(
    z.object({
      limit: z.coerce.number().int().min(1).max(50).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const { mix, tracks } = musicMixTracks(String(req.params.slug), Number(req.query.limit) || 30);
    if (!mix) throw notFound("Mix");
    res.json({ mix, tracks });
  }),
);

/** `GET /api/music/browse` — the full catalogue behind "see all". */
musicRouter.get(
  "/browse",
  validateQuery(
    z.object({
      region: z.string().trim().max(40).optional(),
      category: z.enum(["choirs", "hymns", "instrumentals", "acapella", "worship"]).optional(),
      q: z.string().trim().max(120).optional(),
      limit: z.coerce.number().int().min(1).max(100).optional(),
      offset: z.coerce.number().int().min(0).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const query = req.query as Record<string, string | undefined>;
    const { items, total } = browseMusic({
      region: query.region,
      category: query.category as never,
      q: query.q,
      limit: query.limit ? Number(query.limit) : undefined,
      offset: query.offset ? Number(query.offset) : undefined,
    });
    // `{ items, total }` rather than a bare array with a count in a header: the
    // frontend client reads a body, and a header is invisible to `res.json()`
    // consumers, so the two could not agree without one of them being wrong.
    res.json({ items, total });
  }),
);

/** `GET /api/music/facets` — region and category chips. */
musicRouter.get(
  "/facets",
  asyncHandler(async (_req, res) => {
    res.json({ regions: musicRegions(), categories: musicCategories() });
  }),
);
