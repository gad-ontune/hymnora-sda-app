import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../lib/async.ts";
import { validateBody, validateParams, param, idSchema } from "../../lib/validate.ts";
import { requireAuth } from "../../middleware/auth.ts";
import {
  pushPublicKey,
  pushStatus,
  recentDeliveries,
  subscribe,
  unsubscribe,
  type PushPurpose,
} from "./service.ts";
import { deliver, subscriptionsForUser } from "./service.ts";
import { timezoneFor } from "./reminders.ts";
import { pushConfigured } from "../../config/env.ts";

export const pushRouter: Router = Router();

/**
 * `GET /api/push/config`
 *
 * Public on purpose: the Reminders modal has to be able to tell the user
 * "reminders are not available on this device" *before* they log in, and the
 * VAPID public key is public by design.
 */
pushRouter.get(
  "/config",
  asyncHandler(async (_req, res) => {
    res.json({ configured: pushConfigured(), publicKey: pushPublicKey() });
  }),
);

const subscribeSchema = z.object({
  endpoint: z.string().trim().url().max(1_000),
  keys: z.object({
    p256dh: z.string().trim().min(20).max(200),
    auth: z.string().trim().min(10).max(100),
  }),
  contentEncoding: z.string().trim().max(40).optional(),
  deviceLabel: z.string().trim().max(80).nullable().optional(),
  timezone: z.string().trim().max(60).optional(),
});

/**
 * `POST /api/push/subscriptions` — register this device.
 *
 * A subscription outlives a session, so this is the one push endpoint that
 * accepts a signed-in user without a fresh token check beyond the usual
 * `requireAuth`: the browser calls it immediately after `pushManager.subscribe`,
 * and the user is normally still holding a valid access token at that point.
 */
pushRouter.post(
  "/subscriptions",
  requireAuth,
  validateBody(subscribeSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.output<typeof subscribeSchema>;
    const subscription = subscribe(req.auth!.id, {
      endpoint: body.endpoint,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
      contentEncoding: body.contentEncoding ?? "aes128gcm",
      deviceLabel: body.deviceLabel ?? null,
      userAgent: String(req.get("user-agent") ?? "").slice(0, 200) || null,
      timezone: body.timezone ?? timezoneFor(req.auth!.id),
    });
    res.status(201).json({ id: subscription.id, createdAt: subscription.created_at });
  }),
);

/** `GET /api/push/subscriptions` — this account's devices, plus the VAPID key. */
pushRouter.get(
  "/subscriptions",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(pushStatus(req.auth!.id));
  }),
);

/** `DELETE /api/push/subscriptions/:id` — forget one device. */
pushRouter.delete(
  "/subscriptions/:id",
  requireAuth,
  validateParams(z.object({ id: idSchema })),
  asyncHandler(async (req, res) => {
    const removed = unsubscribe(req.auth!.id, param(req, "id"));
    res.status(removed ? 204 : 404).end();
  }),
);

/** `GET /api/push/history` — what this phone has actually been told. */
pushRouter.get(
  "/history",
  requireAuth,
  asyncHandler(async (req, res) => {
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
    res.json(recentDeliveries(req.auth!.id, limit));
  }),
);

const testSchema = z.object({
  purpose: z
    .enum(["daily_verse", "reading_streak", "live_worship", "event_reminder", "new_content", "weekly_letter", "test"])
    .default("test"),
  title: z.string().trim().min(1).max(120).optional(),
  body: z.string().trim().min(1).max(400).optional(),
});

/**
 * `POST /api/push/test` — prove delivery works before trusting it.
 *
 * The Reminders modal's "Send me a test" button. Deliberately bypasses the
 * per-purpose preference check: a user who just turned reminders off still
 * needs to know whether the thing they just turned off is even wired up, and a
 * test that respects the preference it is testing is a test that always passes.
 */
pushRouter.post(
  "/test",
  requireAuth,
  validateBody(testSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.output<typeof testSchema>;
    const purpose: PushPurpose = body.purpose;
    const result = await deliver(subscriptionsForUser(req.auth!.id), {
      purpose,
      // A unique key per press, so pressing twice really does send twice —
      // the dedupe index should protect the daily verse, not a manual test.
      dedupeKey: `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      message: {
        title: body.title ?? "Hymnora reminders are on",
        body: body.body ?? "This is what a reminder will look like on your phone.",
        url: "/settings",
        tag: `hymnora-test-${purpose}`,
      },
    });
    res.json({ ...result, configured: pushConfigured() });
  }),
);
