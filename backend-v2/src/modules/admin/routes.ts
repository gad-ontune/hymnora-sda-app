import { Router } from "express";
import { z } from "zod";
import { createHash } from "node:crypto";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { asyncHandler } from "../../lib/async.ts";
import { validateBody, validateParams, param, idSchema } from "../../lib/validate.ts";
import { requireAuth, requireAdmin, requireEditor } from "../../middleware/auth.ts";
import { writeLimiter } from "../../middleware/rate-limit.ts";
import { badRequest } from "../../lib/errors.ts";
import { env } from "../../config/env.ts";
import { reindex } from "../search/service.ts";
import {
  allowedMimeTypes,
  deleteAsset,
  findAsset,
  followTopic,
  getPreferences,
  listAssets,
  listNotifications,
  markNotificationsRead,
  platformStats,
  recordAsset,
  subscribe,
  subscribeSchema,
  unfollowTopic,
  unsubscribe,
  updatePreferences,
  preferencesInputSchema,
} from "./service.ts";

export const adminRouter: Router = Router();
export const newsletterRouter: Router = Router();
export const uploadsRouter: Router = Router();
export const preferencesRouter: Router = Router();

// ─── Newsletter (public) ─────────────────────────────────────────────────────

/**
 * `POST /api/newsletter/subscribe` — public signup.
 *
 * Open registration is rate limited rather than authenticated, because the
 * signup form is the primary email-capture surface on a marketing page.
 */
newsletterRouter.post(
  "/subscribe",
  writeLimiter,
  validateBody(subscribeSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(subscribe(req.body));
  }),
);

newsletterRouter.post(
  "/unsubscribe",
  writeLimiter,
  validateBody(z.object({ email: z.string().trim().toLowerCase().email().max(200) })),
  asyncHandler(async (req, res) => {
    res.json(unsubscribe(req.body.email));
  }),
);

// ─── Uploads ─────────────────────────────────────────────────────────────────

/**
 * `POST /api/uploads` — accepts a single multipart file and records it in
 * `media_assets`.
 *
 * Files land under `env.uploadDir` in a per-kind subdirectory and are served
 * back from `/uploads`. The MIME allowlist is enforced server-side against the
 * declared part's content type — never against the client-supplied filename.
 */
uploadsRouter.post(
  "/",
  requireEditor,
  writeLimiter,
  asyncHandler(async (req, res) => {
    const file = (req as unknown as { file?: { originalname: string; mimetype: string; size: number; buffer: Buffer } }).file;
    if (!file) throw badRequest("Attach a file as multipart/form-data under the `file` field");

    const kind = typeof req.query.kind === "string" ? req.query.kind : kindForMime(file.mimetype);
    if (!kind) throw badRequest(`Could not infer an asset kind from "${file.mimetype}"; pass ?kind=`);

    if (file.size > env.maxUploadBytes) {
      throw badRequest(`"${file.originalname}" is ${formatBytes(file.size)}; the limit is ${formatBytes(env.maxUploadBytes)}`);
    }

    // Filenames are attacker-controlled, so only the extension is trusted and
    // the stem is replaced with a random token.
    const extension = (extname(file.originalname) || "").slice(0, 12).replace(/[^A-Za-z0-9.]/g, "");
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${extension}`;
    const directory = resolve(env.uploadDir, kind);
    await mkdir(directory, { recursive: true });
    const storagePath = join(directory, filename);
    await writeFile(storagePath, file.buffer);

    const asset = recordAsset({
      ownerId: req.auth?.id ?? null,
      kind,
      filename,
      originalName: file.originalname.slice(0, 200),
      mimeType: file.mimetype,
      sizeBytes: file.size,
      storagePath,
      url: `/uploads/${kind}/${filename}`,
      checksum: createHash("sha256").update(file.buffer).digest("hex"),
    });
    res.status(201).json(asset);
  }),
);

function kindForMime(mimeType: string): string | null {
  for (const [kind, mimes] of Object.entries(allowedMimeTypes())) {
    if (mimes.includes(mimeType)) return kind;
  }
  return null;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

uploadsRouter.get(
  "/",
  requireEditor,
  asyncHandler(async (req, res) => {
    const kind = typeof req.query.kind === "string" ? req.query.kind : undefined;
    const limit = Number.parseInt(String(req.query.limit ?? "50"), 10);
    res.json(listAssets(kind, Number.isFinite(limit) ? limit : 50));
  }),
);

uploadsRouter.get(
  "/:id",
  requireEditor,
  validateParams(z.object({ id: idSchema })),
  asyncHandler(async (req, res) => {
    res.json(findAsset(param(req, "id")));
  }),
);

uploadsRouter.delete(
  "/:id",
  requireAdmin,
  writeLimiter,
  validateParams(z.object({ id: idSchema })),
  asyncHandler(async (req, res) => {
    const asset = findAsset(param(req, "id"));
    // Best effort: the row is the source of truth, a missing file is not an error.
    await unlink(asset.filename ? join(env.uploadDir, asset.kind, asset.filename) : "").catch(() => undefined);
    deleteAsset(asset.id);
    res.status(204).end();
  }),
);

// ─── Preferences ─────────────────────────────────────────────────────────────

preferencesRouter.use(requireAuth);

preferencesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    res.json(getPreferences(req.auth!.id));
  }),
);

preferencesRouter.patch(
  "/",
  writeLimiter,
  validateBody(preferencesInputSchema),
  asyncHandler(async (req, res) => {
    res.json(updatePreferences(req.auth!.id, req.body));
  }),
);

preferencesRouter.get(
  "/topics",
  asyncHandler(async (req, res) => {
    res.json(getPreferences(req.auth!.id).followedTopics);
  }),
);

preferencesRouter.post(
  "/topics",
  writeLimiter,
  validateBody(z.object({ topic: z.string().trim().min(1).max(60), topicType: z.string().trim().max(40).default("news") })),
  asyncHandler(async (req, res) => {
    res.status(201).json(followTopic(req.auth!.id, req.body.topic, req.body.topicType));
  }),
);

preferencesRouter.delete(
  "/topics/:topic",
  writeLimiter,
  validateParams(z.object({ topic: z.string().trim().min(1).max(60) })),
  asyncHandler(async (req, res) => {
    res.json(unfollowTopic(req.auth!.id, param(req, "topic")));
  }),
);

preferencesRouter.get(
  "/notifications",
  asyncHandler(async (req, res) => {
    const limit = Number.parseInt(String(req.query.limit ?? "30"), 10);
    res.json(listNotifications(req.auth!.id, Number.isFinite(limit) ? limit : 30));
  }),
);

preferencesRouter.post(
  "/notifications/read",
  writeLimiter,
  asyncHandler(async (req, res) => {
    res.json(markNotificationsRead(req.auth!.id));
  }),
);

// ─── Platform admin ──────────────────────────────────────────────────────────

adminRouter.use(requireEditor);

/** `GET /api/admin/stats` — content counters for the admin overview. */
adminRouter.get(
  "/stats",
  asyncHandler(async (_req, res) => {
    res.json(platformStats());
  }),
);

/**
 * `POST /api/admin/search/reindex` — rebuilds the derived `search_index`.
 *
 * A full rebuild is intentional: the index is denormalised across seven source
 * tables, and incremental upkeep there would need triggers on all of them.
 */
adminRouter.post(
  "/search/reindex",
  requireAdmin,
  writeLimiter,
  asyncHandler(async (_req, res) => {
    res.json(reindex());
  }),
);
