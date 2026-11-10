import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../lib/async.ts";
import { validateParams, param, idSchema } from "../../lib/validate.ts";
import { responseFormat, sendList } from "../../lib/http.ts";
import { attachCrud, partialOf } from "../admin/crud.ts";
import {
  albumInputSchema,
  addTrackToCollection,
  collectionInputSchema,
  createAlbum,
  createCollection,
  deleteAlbum,
  deleteCollection,
  findAlbum,
  findCollection,
  findVideo,
  listAlbums,
  listCollections,
  listVideos,
  removeTrackFromCollection,
  updateAlbum,
  updateCollection,
  videoFacets,
} from "./service.ts";

export const albumsRouter: Router = Router();
export const collectionsRouter: Router = Router();
export const videosRouter: Router = Router();

// ─── Albums ──────────────────────────────────────────────────────────────────

albumsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { items, meta } = listAlbums(req);
    sendList(res, items, meta, responseFormat(req));
  }),
);

albumsRouter.get(
  "/:id",
  validateParams(z.object({ id: idSchema })),
  asyncHandler(async (req, res) => {
    res.json(findAlbum(param(req, "id")));
  }),
);

attachCrud({
  router: albumsRouter,
  path: "/",
  createSchema: albumInputSchema,
  updateSchema: partialOf(albumInputSchema),
  create: (input) => createAlbum(input),
  update: (id, input) => updateAlbum(id, input),
  remove: deleteAlbum,
});

// ─── Collections ─────────────────────────────────────────────────────────────

collectionsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { items, meta } = listCollections(req);
    sendList(res, items, meta, responseFormat(req));
  }),
);

collectionsRouter.get(
  "/:idOrSlug",
  validateParams(z.object({ idOrSlug: idSchema })),
  asyncHandler(async (req, res) => {
    res.json(findCollection(param(req, "idOrSlug")));
  }),
);

collectionsRouter.post(
  "/:idOrSlug/tracks/:trackId",
  validateParams(z.object({ idOrSlug: idSchema, trackId: idSchema })),
  asyncHandler(async (req, res) => {
    res.status(201).json(addTrackToCollection(param(req, "idOrSlug"), param(req, "trackId")));
  }),
);

collectionsRouter.delete(
  "/:idOrSlug/tracks/:trackId",
  validateParams(z.object({ idOrSlug: idSchema, trackId: idSchema })),
  asyncHandler(async (req, res) => {
    res.json(removeTrackFromCollection(param(req, "idOrSlug"), param(req, "trackId")));
  }),
);

attachCrud({
  router: collectionsRouter,
  path: "/",
  createSchema: collectionInputSchema,
  updateSchema: partialOf(collectionInputSchema),
  create: (input) => createCollection(input),
  update: (id, input) => updateCollection(id, input),
  remove: deleteCollection,
});

// ─── Videos ──────────────────────────────────────────────────────────────────

/**
 * `GET /api/videos` — a filtered view over `tracks` where `kind = 'video'`.
 *
 * Registered on its own router (rather than inside `tracksRouter`) so the
 * frontend can keep a stable `/api/videos` URL while the storage stays unified.
 */
videosRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { items, meta } = listVideos(req);
    sendList(res, items, meta, responseFormat(req));
  }),
);

videosRouter.get(
  "/facets",
  asyncHandler(async (_req, res) => {
    res.json(videoFacets());
  }),
);

videosRouter.get(
  "/:id",
  validateParams(z.object({ id: idSchema })),
  asyncHandler(async (req, res) => {
    const role = req.auth?.role;
    res.json(findVideo(param(req, "id"), role === "editor" || role === "admin" || role === "moderator"));
  }),
);
