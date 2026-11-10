import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../lib/async.ts";
import { validateBody, validateParams, param, idSchema } from "../../lib/validate.ts";
import { requireAuth } from "../../middleware/auth.ts";
import { writeLimiter } from "../../middleware/rate-limit.ts";
import { badRequest } from "../../lib/errors.ts";
import { CONTENT_TYPES, type ContentType } from "../../types/domain.ts";
import {
  addFavorite,
  addPlaylistItem,
  clearHistory,
  createNote,
  createPlaylist,
  deleteNote,
  deletePlaylist,
  favoriteIds,
  findPlaylist,
  isFavorite,
  listDownloads,
  listFavorites,
  listHistory,
  listNotes,
  listPlaylists,
  noteInputSchema,
  playlistInputSchema,
  recordDownload,
  recordPlay,
  removeFavorite,
  removePlaylistItem,
  reorderPlaylist,
  updateNote,
  updatePlaylist,
} from "./service.ts";

export const libraryRouter: Router = Router();

/** Every library route is user-scoped, so the whole router requires a session. */
libraryRouter.use(requireAuth);

/** Body/query validator for the polymorphic `itemType` field. */
const itemTypeSchema = z.enum(CONTENT_TYPES as [ContentType, ...ContentType[]]);

// ─── Favorites ───────────────────────────────────────────────────────────────

libraryRouter.get(
  "/favorites",
  asyncHandler(async (req, res) => {
    const limit = Math.min(100, Math.max(1, Number.parseInt(String(req.query.limit ?? "50"), 10) || 50));
    const offset = Math.max(0, Number.parseInt(String(req.query.offset ?? "0"), 10) || 0);
    const itemType = typeof req.query.itemType === "string" ? req.query.itemType : undefined;
    const { items, total } = listFavorites(req.auth!.id, itemType, limit, offset);
    res.setHeader("X-Total-Count", String(total));
    res.json(items);
  }),
);

libraryRouter.post(
  "/favorites",
  writeLimiter,
  validateBody(z.object({ itemType: itemTypeSchema, itemId: z.string().trim().min(1).max(120) })),
  asyncHandler(async (req, res) => {
    res.status(201).json(addFavorite(req.auth!.id, req.body.itemType, req.body.itemId));
  }),
);

libraryRouter.delete(
  "/favorites/:itemType/:itemId",
  writeLimiter,
  validateParams(z.object({ itemType: itemTypeSchema, itemId: idSchema })),
  asyncHandler(async (req, res) => {
    res.json(removeFavorite(req.auth!.id, param(req, "itemType"), param(req, "itemId")));
  }),
);

/**
 * `GET /api/library/favorites/ids?itemType=track&ids=a,b,c` — batch favourite
 * lookup. A list page needs this to render hearts without N calls, so it lives
 * on the library rather than each content module.
 */
libraryRouter.get(
  "/favorites/ids",
  asyncHandler(async (req, res) => {
    const itemType = typeof req.query.itemType === "string" ? req.query.itemType : undefined;
    if (!itemType) throw badRequest("Provide an itemType with ?itemType=");
    const raw = typeof req.query.ids === "string" ? req.query.ids.split(",") : [];
    const ids = raw.map((id) => id.trim()).filter(Boolean).slice(0, 200);
    res.json([...favoriteIds(req.auth!.id, itemType, ids)]);
  }),
);

libraryRouter.get(
  "/favorites/:itemType/:itemId",
  asyncHandler(async (req, res) => {
    res.json({ favorited: isFavorite(req.auth!.id, param(req, "itemType"), param(req, "itemId")) });
  }),
);

// ─── Playlists ───────────────────────────────────────────────────────────────

libraryRouter.get(
  "/playlists",
  asyncHandler(async (req, res) => {
    res.json(listPlaylists(req.auth!.id));
  }),
);

libraryRouter.post(
  "/playlists",
  writeLimiter,
  validateBody(playlistInputSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(createPlaylist(req.auth!.id, req.body));
  }),
);

libraryRouter.get(
  "/playlists/:id",
  validateParams(z.object({ id: idSchema })),
  asyncHandler(async (req, res) => {
    res.json(findPlaylist(req.auth!.id, param(req, "id")));
  }),
);

libraryRouter.patch(
  "/playlists/:id",
  writeLimiter,
  validateParams(z.object({ id: idSchema })),
  validateBody(playlistInputSchema.partial()),
  asyncHandler(async (req, res) => {
    res.json(updatePlaylist(req.auth!.id, param(req, "id"), req.body));
  }),
);

libraryRouter.delete(
  "/playlists/:id",
  writeLimiter,
  validateParams(z.object({ id: idSchema })),
  asyncHandler(async (req, res) => {
    deletePlaylist(req.auth!.id, param(req, "id"));
    res.status(204).end();
  }),
);

libraryRouter.post(
  "/playlists/:id/items",
  writeLimiter,
  validateParams(z.object({ id: idSchema })),
  validateBody(
    z.object({
      itemType: itemTypeSchema,
      itemId: z.string().trim().min(1).max(120),
      note: z.string().trim().max(500).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    res.status(201).json(addPlaylistItem(req.auth!.id, param(req, "id"), req.body.itemType, req.body.itemId, req.body.note));
  }),
);

/** Bulk replace — the drag-to-reorder editor posts the whole new order. */
libraryRouter.put(
  "/playlists/:id/items",
  writeLimiter,
  validateParams(z.object({ id: idSchema })),
  validateBody(z.object({ items: z.array(z.object({ itemType: itemTypeSchema, itemId: z.string().trim().min(1).max(120), note: z.string().trim().max(500).optional() })).max(500) })),
  asyncHandler(async (req, res) => {
    res.json(reorderPlaylist(req.auth!.id, param(req, "id"), req.body.items));
  }),
);

libraryRouter.delete(
  "/playlists/:id/items/:itemType/:itemId",
  writeLimiter,
  validateParams(z.object({ id: idSchema, itemType: itemTypeSchema, itemId: idSchema })),
  asyncHandler(async (req, res) => {
    res.json(removePlaylistItem(req.auth!.id, param(req, "id"), param(req, "itemType"), param(req, "itemId")));
  }),
);

// ─── History ─────────────────────────────────────────────────────────────────

libraryRouter.get(
  "/history",
  asyncHandler(async (req, res) => {
    const limit = Number.parseInt(String(req.query.limit ?? "30"), 10);
    res.json(listHistory(req.auth!.id, Number.isFinite(limit) ? limit : 30));
  }),
);

libraryRouter.post(
  "/history",
  writeLimiter,
  validateBody(
    z.object({
      itemType: itemTypeSchema,
      itemId: z.string().trim().min(1).max(120),
      progressPercent: z.number().min(0).max(100).optional(),
      secondsPlayed: z.number().int().min(0).max(86_400).optional(),
      completed: z.boolean().optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    res.status(201).json(
      recordPlay(req.auth!.id, req.body.itemType, req.body.itemId, {
        progressPercent: req.body.progressPercent,
        secondsPlayed: req.body.secondsPlayed,
        completed: req.body.completed,
      }),
    );
  }),
);

libraryRouter.delete(
  "/history",
  writeLimiter,
  asyncHandler(async (req, res) => {
    res.json(clearHistory(req.auth!.id));
  }),
);

// ─── Notes ───────────────────────────────────────────────────────────────────

libraryRouter.get(
  "/notes",
  asyncHandler(async (req, res) => {
    const itemType = typeof req.query.itemType === "string" ? req.query.itemType : undefined;
    res.json(listNotes(req.auth!.id, itemType));
  }),
);

libraryRouter.post(
  "/notes",
  writeLimiter,
  validateBody(noteInputSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(createNote(req.auth!.id, req.body));
  }),
);

libraryRouter.patch(
  "/notes/:id",
  writeLimiter,
  validateParams(z.object({ id: idSchema })),
  validateBody(noteInputSchema.partial()),
  asyncHandler(async (req, res) => {
    res.json(updateNote(req.auth!.id, param(req, "id"), req.body));
  }),
);

libraryRouter.delete(
  "/notes/:id",
  writeLimiter,
  validateParams(z.object({ id: idSchema })),
  asyncHandler(async (req, res) => {
    deleteNote(req.auth!.id, param(req, "id"));
    res.status(204).end();
  }),
);

// ─── Downloads ───────────────────────────────────────────────────────────────

libraryRouter.get(
  "/downloads",
  asyncHandler(async (req, res) => {
    res.json(listDownloads(req.auth!.id));
  }),
);

libraryRouter.post(
  "/downloads",
  writeLimiter,
  validateBody(
    z.object({
      itemType: itemTypeSchema,
      itemId: z.string().trim().min(1).max(120),
      quality: z.enum(["standard", "high", "lossless"]).default("high"),
    }),
  ),
  asyncHandler(async (req, res) => {
    res.status(201).json(recordDownload(req.auth!.id, req.body.itemType, req.body.itemId, req.body.quality));
  }),
);
