import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../lib/async.ts";
import { validateParams, param, idSchema } from "../../lib/validate.ts";
import { responseFormat, sendList } from "../../lib/http.ts";
import { optionalAuth } from "../../middleware/auth.ts";
import { attachCrud, partialOf } from "../admin/crud.ts";
import {
  createTrack,
  deleteTrack,
  findTrack,
  findTrackRow,
  incrementPlays,
  incrementViews,
  listTracks,
  relatedTracks,
  restoreTrack,
  trackFacets,
  trackInputSchema,
  updateTrack,
} from "./service.ts";

export const tracksRouter: Router = Router();

const trackPatchSchema = partialOf(trackInputSchema);

/**
 * `GET /api/tracks` — powers the music page, the home "continue listening" rail
 * and the player queue. Returns a bare `Track[]`, exactly what the frontend's
 * `fetchJson<Track[]>()` already expects.
 *
 * Filters: kind, language, artist, albumId, genre, mood, downloadable, featured,
 * live, collectionId, q. Sorting: title, artist, album, duration, plays, likes,
 * release, created.
 */
tracksRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { items, meta } = listTracks(req);
    sendList(res, items, meta, responseFormat(req));
  }),
);

tracksRouter.get(
  "/facets",
  asyncHandler(async (_req, res) => {
    res.json(trackFacets());
  }),
);

/**
 * Registered before `/:id` — a literal segment must win over the param route,
 * otherwise `/tracks/detail` would be read as a track with id `"detail"`.
 * Editor view that always includes drafts.
 */
tracksRouter.get(
  "/:id/detail",
  validateParams(z.object({ id: idSchema })),
  asyncHandler(async (req, res) => {
    res.json(findTrack(param(req, "id"), true));
  }),
);

tracksRouter.get(
  "/:id",
  optionalAuth,
  validateParams(z.object({ id: idSchema })),
  asyncHandler(async (req, res) => {
    const role = req.auth?.role;
    const includeDrafts = role === "editor" || role === "admin" || role === "moderator";
    res.json(findTrack(param(req, "id"), includeDrafts));
  }),
);

tracksRouter.get(
  "/:id/related",
  validateParams(z.object({ id: idSchema })),
  asyncHandler(async (req, res) => {
    const requested = Number.parseInt(String(req.query.limit ?? "8"), 10);
    const limit = Number.isFinite(requested) ? Math.min(24, Math.max(1, requested)) : 8;
    res.json(relatedTracks(param(req, "id"), limit));
  }),
);

tracksRouter.post(
  "/:id/play",
  validateParams(z.object({ id: idSchema })),
  asyncHandler(async (req, res) => {
    findTrackRow(param(req, "id"));
    incrementPlays(param(req, "id"));
    res.status(202).json({ recorded: true });
  }),
);

tracksRouter.post(
  "/:id/view",
  validateParams(z.object({ id: idSchema })),
  asyncHandler(async (req, res) => {
    findTrackRow(param(req, "id"));
    incrementViews(param(req, "id"));
    res.status(202).json({ recorded: true });
  }),
);

attachCrud({
  router: tracksRouter,
  path: "/",
  createSchema: trackInputSchema,
  updateSchema: trackPatchSchema,
  create: (input, req) => createTrack(input, req.auth?.id ?? null),
  update: (id, input) => updateTrack(id, input),
  remove: deleteTrack,
  restore: restoreTrack,
});
