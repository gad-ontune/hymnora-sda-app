import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../lib/async.ts";
import { validateBody, validateParams, param, idSchema, slugSchema } from "../../lib/validate.ts";
import { responseFormat, sendList } from "../../lib/http.ts";
import { requireAuth } from "../../middleware/auth.ts";
import { writeLimiter } from "../../middleware/rate-limit.ts";
import { attachCrud, partialOf } from "../admin/crud.ts";
import {
  churchFacets,
  churchInputSchema,
  createChurch,
  deleteChurch,
  findChurch,
  followChurch,
  followedChurches,
  listChurches,
  restoreChurch,
  unfollowChurch,
  updateChurch,
} from "./service.ts";

export const churchesRouter: Router = Router();

/**
 * `GET /api/churches` — bare `Church[]`, matching the frontend's `getChurches()`.
 *
 * `?lat=&lng=&radius=` switches to a distance-ordered nearby search; without a
 * centre the list is alphabetical, which is what the browse page wants.
 */
churchesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { items, meta } = listChurches(req);
    sendList(res, items, meta, responseFormat(req));
  }),
);

churchesRouter.get(
  "/facets",
  asyncHandler(async (_req, res) => {
    res.json(churchFacets());
  }),
);

churchesRouter.get(
  "/followed",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(followedChurches(req.auth!.id));
  }),
);

churchesRouter.post(
  "/:idOrSlug/follow",
  requireAuth,
  writeLimiter,
  validateParams(z.object({ idOrSlug: z.union([idSchema, slugSchema]) })),
  validateBody(z.object({ notifyLive: z.boolean().default(true) })),
  asyncHandler(async (req, res) => {
    res.json(followChurch(req.auth!.id, param(req, "idOrSlug"), req.body.notifyLive));
  }),
);

churchesRouter.delete(
  "/:idOrSlug/follow",
  requireAuth,
  writeLimiter,
  validateParams(z.object({ idOrSlug: z.union([idSchema, slugSchema]) })),
  asyncHandler(async (req, res) => {
    res.json(unfollowChurch(req.auth!.id, param(req, "idOrSlug")));
  }),
);

churchesRouter.get(
  "/:idOrSlug",
  validateParams(z.object({ idOrSlug: z.union([idSchema, slugSchema]) })),
  asyncHandler(async (req, res) => {
    res.json(findChurch(param(req, "idOrSlug")));
  }),
);

attachCrud({
  router: churchesRouter,
  path: "/",
  createSchema: churchInputSchema,
  updateSchema: partialOf(churchInputSchema),
  create: (input, req) => createChurch(input, req.auth?.id ?? null),
  update: (id, input) => updateChurch(id, input),
  remove: deleteChurch,
  restore: restoreChurch,
});
