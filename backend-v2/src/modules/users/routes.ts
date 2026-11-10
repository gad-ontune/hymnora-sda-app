import { Router } from "express";
import { z } from "zod";
import { all, get, run, type Row } from "../../db/client.ts";
import { asyncHandler } from "../../lib/async.ts";
import { validateBody, validateParams, param, idSchema } from "../../lib/validate.ts";
import { listQueryFrom } from "../../lib/query.ts";
import { sendList, buildMeta, responseFormat } from "../../lib/http.ts";
import { conflict, notFound, unprocessable } from "../../lib/errors.ts";
import { requireAdmin, requireAuth, optionalAuth } from "../../middleware/auth.ts";
import { writeLimiter } from "../../middleware/rate-limit.ts";
import { findUserById, toUser, userById } from "../auth/service.ts";
import type { User } from "../../types/domain.ts";

export const usersRouter: Router = Router();

const profileSchema = z
  .object({
    firstName: z.string().trim().min(1).max(80).optional(),
    lastName: z.string().trim().min(1).max(80).optional(),
    displayName: z.string().trim().max(120).optional(),
    avatarUrl: z.string().trim().max(400).nullable().optional(),
    bio: z.string().trim().max(600).nullable().optional(),
    phone: z.string().trim().max(40).nullable().optional(),
    homeChurchId: idSchema.nullable().optional(),
    city: z.string().trim().max(120).nullable().optional(),
    country: z.string().trim().max(120).nullable().optional(),
    timezone: z.string().trim().max(80).optional(),
    language: z.string().trim().min(2).max(40).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "Provide at least one field to update" });

const profileColumnMap: Record<string, string> = {
  firstName: "first_name",
  lastName: "last_name",
  displayName: "display_name",
  avatarUrl: "avatar_url",
  bio: "bio",
  phone: "phone",
  homeChurchId: "home_church_id",
  city: "city",
  country: "country",
  timezone: "timezone",
  language: "language",
};

export function updateProfile(userId: string, input: z.output<typeof profileSchema>): User {
  if (input.homeChurchId) {
    const church = get("SELECT 1 FROM churches WHERE id = ? AND deleted_at IS NULL", [input.homeChurchId]);
    if (!church) throw unprocessable("The selected home church does not exist", { field: "homeChurchId" });
  }
  const assignments: string[] = [];
  const params: (string | number | null)[] = [];
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    const column = profileColumnMap[key];
    if (!column) continue;
    assignments.push(`${column} = ?`);
    params.push(value as string | number | null);
  }
  if (assignments.length > 0) {
    params.push(userId);
    run(
      `UPDATE users SET ${assignments.join(", ")}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
      params,
    );
  }
  const user = userById(userId);
  if (!user) throw notFound("Account");
  return toUser(user);
}

// ─── Current user ────────────────────────────────────────────────────────────

usersRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = userById(req.auth!.id);
    if (!user) throw notFound("Account");
    res.json(toUser(user));
  }),
);

usersRouter.patch(
  "/me",
  requireAuth,
  writeLimiter,
  validateBody(profileSchema),
  asyncHandler(async (req, res) => {
    res.json(updateProfile(req.auth!.id, req.body));
  }),
);

usersRouter.get(
  "/me/summary",
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.auth!.id;
    const scalar = (sql: string, ...params: (string | number)[]) => Number(get<{ value: number }>(sql, params)?.value ?? 0);
    res.json({
      favorites: scalar("SELECT COUNT(*) AS value FROM favorites WHERE user_id = ?", userId),
      playlists: scalar("SELECT COUNT(*) AS value FROM playlists WHERE user_id = ?", userId),
      notes: scalar("SELECT COUNT(*) AS value FROM notes WHERE user_id = ?", userId),
      downloads: scalar("SELECT COUNT(*) AS value FROM downloads WHERE user_id = ?", userId),
      bookmarks: scalar("SELECT COUNT(*) AS value FROM bible_bookmarks WHERE user_id = ?", userId),
      savedEvents: scalar("SELECT COUNT(*) AS value FROM saved_events WHERE user_id = ?", userId),
      followedChurches: scalar("SELECT COUNT(*) AS value FROM followed_churches WHERE user_id = ?", userId),
      historyEntries: scalar("SELECT COUNT(*) AS value FROM play_history WHERE user_id = ?", userId),
      listeningSeconds: scalar("SELECT COALESCE(SUM(seconds_played), 0) AS value FROM play_history WHERE user_id = ?", userId),
      unreadNotifications: scalar("SELECT COUNT(*) AS value FROM notifications WHERE user_id = ? AND read_at IS NULL", userId),
    });
  }),
);

// ─── Public profiles ─────────────────────────────────────────────────────────

usersRouter.get(
  "/:id",
  optionalAuth,
  validateParams(z.object({ id: idSchema })),
  asyncHandler(async (req, res) => {
    const user = findUserById(param(req, "id"));
    if (!user) throw notFound("Account");
    const isSelf = req.auth?.id === user.id;
    if (!isSelf) {
      res.json({
        id: user.id,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        bio: user.bio,
        homeChurchName: user.homeChurchName,
        city: user.city,
        country: user.country,
        memberSince: user.createdAt,
      });
      return;
    }
    res.json(user);
  }),
);

// ─── Notifications ───────────────────────────────────────────────────────────

usersRouter.get(
  "/me/notifications",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { limit, offset } = listQueryFrom(req, { limit: 30 });
    const rows = all<Row>(
      "SELECT id, type, title, body, href, read_at, created_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
      [req.auth!.id, limit, offset],
    );
    const total = Number(get<{ total: number }>("SELECT COUNT(*) AS total FROM notifications WHERE user_id = ?", [req.auth!.id])?.total ?? 0);
    res.json(
      rows.map((row) => ({
        id: String(row.id),
        type: String(row.type),
        title: String(row.title),
        body: row.body === null ? null : String(row.body),
        href: row.href === null ? null : String(row.href),
        readAt: row.read_at === null ? null : String(row.read_at),
        createdAt: String(row.created_at),
      })),
    );
    res.setHeader("X-Total-Count", String(total));
  }),
);

usersRouter.post(
  "/me/notifications/:id/read",
  requireAuth,
  writeLimiter,
  validateParams(z.object({ id: idSchema })),
  asyncHandler(async (req, res) => {
    const result = run("UPDATE notifications SET read_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND user_id = ? AND read_at IS NULL", [
      param(req, "id"),
      req.auth!.id,
    ]);
    if (result.changes === 0) {
      const exists = get("SELECT 1 FROM notifications WHERE id = ? AND user_id = ?", [param(req, "id"), req.auth!.id]);
      if (!exists) throw notFound("Notification");
    }
    res.json({ id: param(req, "id"), read: true });
  }),
);

usersRouter.post(
  "/me/notifications/read-all",
  requireAuth,
  writeLimiter,
  asyncHandler(async (req, res) => {
    const result = run("UPDATE notifications SET read_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE user_id = ? AND read_at IS NULL", [req.auth!.id]);
    res.json({ updated: result.changes });
  }),
);

usersRouter.delete(
  "/me/notifications/:id",
  requireAuth,
  writeLimiter,
  validateParams(z.object({ id: idSchema })),
  asyncHandler(async (req, res) => {
    const result = run("DELETE FROM notifications WHERE id = ? AND user_id = ?", [param(req, "id"), req.auth!.id]);
    if (result.changes === 0) throw notFound("Notification");
    res.status(204).end();
  }),
);

// ─── Admin ───────────────────────────────────────────────────────────────────

usersRouter.get(
  "/",
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { limit, offset } = listQueryFrom(req, { limit: 25 });
    const role = typeof req.query.role === "string" ? req.query.role : null;
    const status = typeof req.query.status === "string" ? req.query.status : null;
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";

    const where: string[] = ["deleted_at IS NULL"];
    const params: (string | number)[] = [];
    if (role) {
      where.push("role = ?");
      params.push(role);
    }
    if (status) {
      where.push("status = ?");
      params.push(status);
    }
    if (q) {
      where.push("(email LIKE ? OR first_name LIKE ? OR last_name LIKE ? OR display_name LIKE ?)");
      const pattern = `%${q}%`;
      params.push(pattern, pattern, pattern, pattern);
    }
    const clause = where.join(" AND ");

    const total = Number(get<{ total: number }>(`SELECT COUNT(*) AS total FROM users WHERE ${clause}`, params)?.total ?? 0);
    const rows = all<Row & { id: string }>(
      `SELECT id, email, role, status, first_name, last_name, display_name, language, last_login_at, created_at
       FROM users WHERE ${clause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );

    const items = rows.map((row) => ({
      id: row.id,
      email: row.email,
      role: row.role,
      status: row.status,
      firstName: row.first_name,
      lastName: row.last_name,
      displayName: row.display_name ?? `${row.first_name} ${row.last_name}`,
      language: row.language,
      lastLoginAt: row.last_login_at,
      createdAt: row.created_at,
    }));

    sendList(res, items, buildMeta(total, limit, offset), responseFormat(req));
  }),
);

usersRouter.patch(
  "/:id/role",
  requireAuth,
  requireAdmin,
  writeLimiter,
  validateParams(z.object({ id: idSchema })),
  validateBody(z.object({ role: z.enum(["member", "moderator", "editor", "admin"]) })),
  asyncHandler(async (req, res) => {
    if (param(req, "id") === req.auth!.id) throw conflict("You cannot change your own role");
    const result = run("UPDATE users SET role = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND deleted_at IS NULL", [
      req.body.role,
      param(req, "id"),
    ]);
    if (result.changes === 0) throw notFound("Account");
    res.json(findUserById(param(req, "id")));
  }),
);

usersRouter.patch(
  "/:id/status",
  requireAuth,
  requireAdmin,
  writeLimiter,
  validateParams(z.object({ id: idSchema })),
  validateBody(z.object({ status: z.enum(["active", "invited", "suspended"]) })),
  asyncHandler(async (req, res) => {
    if (param(req, "id") === req.auth!.id) throw conflict("You cannot change your own status");
    const result = run("UPDATE users SET status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND deleted_at IS NULL", [
      req.body.status,
      param(req, "id"),
    ]);
    if (result.changes === 0) throw notFound("Account");
    res.json(findUserById(param(req, "id")));
  }),
);

usersRouter.delete(
  "/:id",
  requireAuth,
  requireAdmin,
  writeLimiter,
  validateParams(z.object({ id: idSchema })),
  asyncHandler(async (req, res) => {
    const result = run("UPDATE users SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND deleted_at IS NULL", [param(req, "id")]);
    if (result.changes === 0) throw notFound("Account");
    res.status(204).end();
  }),
);
