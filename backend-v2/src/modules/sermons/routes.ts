import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../lib/async.ts";
import { validateParams, param, idSchema, slugSchema } from "../../lib/validate.ts";
import { responseFormat, sendList } from "../../lib/http.ts";
import { attachCrud, partialOf } from "../admin/crud.ts";
import {
  createSeries,
  createSermon,
  deleteSeries,
  deleteSermon,
  findSeries,
  findSermon,
  incrementPlays,
  listSeries,
  listSermonDetails,
  listSermons,
  listSpeakers,
  restoreSermon,
  seriesInputSchema,
  sermonInputSchema,
  updateSeries,
  updateSermon,
} from "./service.ts";

export const sermonsRouter: Router = Router();
export const sermonSeriesRouter: Router = Router();

/**
 * `GET /api/sermons` — bare `Sermon[]`, matching the frontend's `getSermons()`.
 * Literal sub-routes are declared first so they are not captured by `/:id`.
 */
sermonsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { items, meta } = listSermons(req);
    sendList(res, items, meta, responseFormat(req));
  }),
);

sermonsRouter.get(
  "/detail",
  asyncHandler(async (req, res) => {
    const { items, meta } = listSermonDetails(req);
    sendList(res, items, meta, responseFormat(req));
  }),
);

sermonsRouter.get(
  "/series",
  asyncHandler(async (_req, res) => {
    res.json(listSeries());
  }),
);

sermonsRouter.get(
  "/speakers",
  asyncHandler(async (_req, res) => {
    res.json(listSpeakers());
  }),
);

sermonsRouter.get(
  "/:id",
  validateParams(z.object({ id: idSchema })),
  asyncHandler(async (req, res) => {
    const role = req.auth?.role;
    res.json(findSermon(param(req, "id"), role === "editor" || role === "admin" || role === "moderator"));
  }),
);

sermonsRouter.post(
  "/:id/play",
  validateParams(z.object({ id: idSchema })),
  asyncHandler(async (req, res) => {
    incrementPlays(param(req, "id"));
    res.status(202).json({ recorded: true });
  }),
);

attachCrud({
  router: sermonsRouter,
  path: "/",
  createSchema: sermonInputSchema,
  updateSchema: partialOf(sermonInputSchema),
  create: (input, req) => createSermon(input, req.auth?.id ?? null),
  update: (id, input) => updateSermon(id, input),
  remove: deleteSermon,
  restore: restoreSermon,
});

sermonSeriesRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.json(listSeries());
  }),
);

sermonSeriesRouter.get(
  "/:idOrSlug",
  validateParams(z.object({ idOrSlug: z.union([idSchema, slugSchema]) })),
  asyncHandler(async (req, res) => {
    res.json(findSeries(param(req, "idOrSlug")));
  }),
);

attachCrud({
  router: sermonSeriesRouter,
  path: "/",
  createSchema: seriesInputSchema,
  updateSchema: partialOf(seriesInputSchema),
  create: (input) => createSeries(input),
  update: (id, input) => updateSeries(id, input),
  remove: deleteSeries,
});
