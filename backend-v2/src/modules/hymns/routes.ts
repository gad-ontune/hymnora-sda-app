import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../lib/async.ts";
import { validateParams, param, idSchema } from "../../lib/validate.ts";
import { responseFormat, sendList } from "../../lib/http.ts";
import { attachCrud, partialOf } from "../admin/crud.ts";
import {
  createHymn,
  deleteHymn,
  findHymn,
  findHymnRow,
  hymnInputSchema,
  incrementPlays,
  listEditions,
  listHymnDetails,
  listHymns,
  listThemes,
  listTunes,
  findEdition,
  restoreHymn,
  updateHymn,
} from "./service.ts";

export const hymnsRouter: Router = Router();
export const hymnEditionsRouter: Router = Router();

/**
 * `GET /api/hymns` — powers the hymns page. Returns a bare `Hymn[]`, which is
 * exactly what the frontend's `getHymns()` already expects.
 *
 * The literal sub-routes below are declared before `/:id` so `/hymns/themes`
 * is never parsed as a hymn whose number happens to be "themes".
 */
hymnsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { items, meta } = listHymns(req);
    sendList(res, items, meta, responseFormat(req));
  }),
);

hymnsRouter.get(
  "/detail",
  asyncHandler(async (req, res) => {
    const { items, meta } = listHymnDetails(req);
    sendList(res, items, meta, responseFormat(req));
  }),
);

hymnsRouter.get(
  "/themes",
  asyncHandler(async (req, res) => {
    const language = typeof req.query.language === "string" ? req.query.language : undefined;
    res.json(listThemes(language));
  }),
);

hymnsRouter.get(
  "/tunes",
  asyncHandler(async (_req, res) => {
    res.json(listTunes());
  }),
);

hymnsRouter.get(
  "/editions",
  asyncHandler(async (_req, res) => {
    res.json(listEditions());
  }),
);

hymnsRouter.get(
  "/:id",
  validateParams(z.object({ id: idSchema })),
  asyncHandler(async (req, res) => {
    const role = req.auth?.role;
    res.json(findHymn(param(req, "id"), role === "editor" || role === "admin" || role === "moderator"));
  }),
);

hymnsRouter.post(
  "/:id/play",
  validateParams(z.object({ id: idSchema })),
  asyncHandler(async (req, res) => {
    findHymnRow(param(req, "id"));
    incrementPlays(param(req, "id"));
    res.status(202).json({ recorded: true });
  }),
);

attachCrud({
  router: hymnsRouter,
  path: "/",
  createSchema: hymnInputSchema,
  updateSchema: partialOf(hymnInputSchema),
  create: (input) => createHymn(input),
  update: (id, input) => updateHymn(id, input),
  remove: deleteHymn,
  restore: restoreHymn,
});

hymnEditionsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.json(listEditions());
  }),
);

hymnEditionsRouter.get(
  "/:idOrCode",
  validateParams(z.object({ idOrCode: idSchema })),
  asyncHandler(async (req, res) => {
    res.json(findEdition(param(req, "idOrCode")));
  }),
);
