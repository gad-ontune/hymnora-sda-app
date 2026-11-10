/**
 * Push subscriptions and delivery.
 *
 * The design constraint from the product side: there is no in-app inbox. A
 * notification is something the *phone* raises, so the only durable record the
 * platform keeps is the subscription and the fact that we sent to it.
 * `push_deliveries` exists purely so that "one morning verse per day per
 * device" is enforced by a unique index rather than by hoping the worker runs
 * once.
 *
 * Nothing here reads the `notifications` table. That table predates the decision
 * to move reminders to the device level; it is left in place for the editorial
 * feed (`/api/admin/notifications`) and is not the delivery path.
 */

import { all, get, run, placeholders } from "../../db/client.ts";
import { env, pushConfigured } from "../../config/env.ts";
import { newId, stableId } from "../../lib/http.ts";
import { notFound } from "../../lib/errors.ts";
import { endpointFingerprint, sendPush, vapidPublicKeyBase64, type PushMessage } from "../../lib/web-push.ts";

export type PushPurpose =
  | "daily_verse"
  | "reading_streak"
  | "live_worship"
  | "event_reminder"
  | "new_content"
  | "weekly_letter"
  | "test";

export type PushSubscriptionRow = {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  content_encoding: string;
  user_agent: string | null;
  device_label: string | null;
  timezone: string;
  failure_count: number;
  last_success_at: string | null;
  created_at: string;
  last_seen_at: string;
};

export type PushStatus = {
  /** False when no VAPID key pair is configured — the honest "it cannot work yet" case. */
  configured: boolean;
  publicKey: string | null;
  permission: "default" | "granted" | "denied" | "unsupported";
  subscriptionCount: number;
  devices: {
    id: string;
    label: string | null;
    createdAt: string;
    lastSuccessAt: string | null;
    /** SHA-256 prefix of the endpoint, so a client can recognise its own device. */
    endpointFingerprint: string;
  }[];
};

/** The public key the browser needs. `null` until VAPID is configured. */
export function pushPublicKey(): string | null {
  if (!pushConfigured()) return null;
  try {
    return vapidPublicKeyBase64(env.vapidPrivateKey!);
  } catch {
    return null;
  }
}

export function pushStatus(userId: string): PushStatus {
  return {
    configured: pushConfigured(),
    publicKey: pushPublicKey(),
    permission: "default", // The browser owns this; the client overwrites it.
    subscriptionCount: countSubscriptions(userId),
    devices: listDevices(userId).map((row) => ({
      id: row.id,
      label: row.device_label,
      createdAt: row.created_at,
      lastSuccessAt: row.last_success_at,
      endpointFingerprint: endpointFingerprint(row.endpoint),
    })),
  };
}



function countSubscriptions(userId: string): number {
  return Number(
    get<{ total: number }>("SELECT COUNT(*) AS total FROM push_subscriptions WHERE user_id = ?", [userId])?.total ?? 0,
  );
}

function listDevices(userId: string): PushSubscriptionRow[] {
  return all<PushSubscriptionRow>(
    "SELECT * FROM push_subscriptions WHERE user_id = ? ORDER BY last_seen_at DESC",
    [userId],
  );
}

/**
 * Registers a device.
 *
 * The endpoint is the natural key, not the id: a browser that clears and
 * re-creates its subscription for the same push service endpoint gets its row
 * updated rather than accumulating dead ones, and a user signing in on a second
 * device takes over the row instead of silently sharing a subscription with
 * whoever was there before.
 */
export function subscribe(userId: string, input: SubscribeInput): PushSubscriptionRow {
  const existing = get<PushSubscriptionRow>("SELECT * FROM push_subscriptions WHERE endpoint = ?", [input.endpoint]);

  if (existing && existing.user_id !== userId) {
    run(
      `UPDATE push_subscriptions
          SET user_id = ?, p256dh = ?, auth = ?, content_encoding = ?, user_agent = ?,
              device_label = ?, timezone = ?, failure_count = 0,
              last_seen_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id = ?`,
      [
        userId,
        input.p256dh,
        input.auth,
        input.contentEncoding ?? "aes128gcm",
        input.userAgent ?? null,
        input.deviceLabel ?? null,
        input.timezone ?? "Africa/Nairobi",
        existing.id,
      ],
    );
  } else if (existing) {
    run(
      `UPDATE push_subscriptions
          SET p256dh = ?, auth = ?, content_encoding = ?, user_agent = ?, device_label = ?,
              timezone = ?, failure_count = 0,
              last_seen_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id = ?`,
      [
        input.p256dh,
        input.auth,
        input.contentEncoding ?? "aes128gcm",
        input.userAgent ?? null,
        input.deviceLabel ?? null,
        input.timezone ?? "Africa/Nairobi",
        existing.id,
      ],
    );
  } else {
    run(
      `INSERT INTO push_subscriptions
         (id, user_id, endpoint, p256dh, auth, content_encoding, user_agent, device_label, timezone)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        newId(),
        userId,
        input.endpoint,
        input.p256dh,
        input.auth,
        input.contentEncoding ?? "aes128gcm",
        input.userAgent ?? null,
        input.deviceLabel ?? null,
        input.timezone ?? "Africa/Nairobi",
      ],
    );
  }

  const row = get<PushSubscriptionRow>("SELECT * FROM push_subscriptions WHERE endpoint = ?", [input.endpoint]);
  if (!row) throw notFound("Subscription");
  return row;
}

export type SubscribeInput = {
  endpoint: string;
  p256dh: string;
  auth: string;
  contentEncoding?: string;
  userAgent?: string | null;
  deviceLabel?: string | null;
  timezone?: string;
};

/** Removes a device. The browser calls this on logout, not the server. */
export function unsubscribe(userId: string, subscriptionId?: string, endpoint?: string): boolean {
  if (subscriptionId) {
    return run("DELETE FROM push_subscriptions WHERE id = ? AND user_id = ?", [subscriptionId, userId]).changes > 0;
  }
  if (endpoint) {
    return run("DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?", [endpoint, userId]).changes > 0;
  }
  return run("DELETE FROM push_subscriptions WHERE user_id = ?", [userId]).changes > 0;
}

/** Drops a subscription the push service has rejected permanently. */
function retire(subscriptionId: string): void {
  run("DELETE FROM push_subscriptions WHERE id = ?", [subscriptionId]);
}

export function subscriptionsForUsers(userIds: string[]): PushSubscriptionRow[] {
  if (userIds.length === 0) return [];
  return all<PushSubscriptionRow>(
    `SELECT * FROM push_subscriptions WHERE user_id IN (${placeholders(userIds.length)}) AND failure_count < ?`,
    [...userIds, env.pushMaxFailures],
  );
}

export function subscriptionsForUser(userId: string): PushSubscriptionRow[] {
  return all<PushSubscriptionRow>(
    "SELECT * FROM push_subscriptions WHERE user_id = ? AND failure_count < ?",
    [userId, env.pushMaxFailures],
  );
}

/**
 * The dedupe key.
 *
 * Whatever it is, it has to be *stable across retries within the same day* and
 * *different the next day*, because `UNIQUE (subscription_id, purpose,
 * dedupe_key)` is what makes a double-sent verse impossible. Callers pass the
 * local calendar day for anything daily and the entity id for anything
 * one-off (`live-42`, `event-kijani-2026-03-08`).
 */
function deliveryExists(subscriptionId: string, purpose: PushPurpose, dedupeKey: string): boolean {
  return Boolean(
    get(
      "SELECT 1 FROM push_deliveries WHERE subscription_id = ? AND purpose = ? AND dedupe_key = ?",
      [subscriptionId, purpose, dedupeKey],
    ),
  );
}

export type DeliveryResult = {
  attempted: number;
  sent: number;
  skipped: number;
  failed: number;
  retired: number;
  skippedReason?: "notConfigured";
};

export type DeliverOptions = {
  purpose: PushPurpose;
  dedupeKey: string;
  message: PushMessage;
  /** Only send if the user's preference for this purpose is on. */
  filter?: (subscription: PushSubscriptionRow) => boolean;
};

/**
 * Sends one message to a set of subscriptions.
 *
 * A push service outage must not stop the sweep, so every failure is recorded
 * and the loop continues. A 404/410 retires the device immediately (the browser
 * has thrown the subscription away); anything else just increments a counter, so
 * a device that is merely offline for a week does not get deleted.
 */
export async function deliver(subscriptions: PushSubscriptionRow[], options: DeliverOptions): Promise<DeliveryResult> {
  const result: DeliveryResult = { attempted: 0, sent: 0, skipped: 0, failed: 0, retired: 0 };

  if (!pushConfigured()) {
    return { ...result, skippedReason: "notConfigured" };
  }

  const publicKey = pushPublicKey();
  if (!publicKey) return { ...result, skippedReason: "notConfigured" };

  for (const subscription of subscriptions) {
    if (options.filter && !options.filter(subscription)) {
      result.skipped += 1;
      continue;
    }
    if (deliveryExists(subscription.id, options.purpose, options.dedupeKey)) {
      result.skipped += 1;
      continue;
    }

    result.attempted += 1;
    const outcome = await sendPush(
      { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
      { ...options.message, purpose: options.purpose },
      {
        audience: originOf(subscription.endpoint),
        subject: env.vapidSubject,
        publicKeyBase64: publicKey,
        privateKeyPem: env.vapidPrivateKey!,
        timeoutMs: env.pushTimeoutMs,
      },
    );

    if (outcome.ok) {
      result.sent += 1;
      recordDelivery(subscription.id, options, options.message);
      run(
        `UPDATE push_subscriptions
            SET last_success_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                last_seen_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                failure_count = 0
          WHERE id = ?`,
        [subscription.id],
      );
      continue;
    }

    result.failed += 1;
    if (outcome.expired) {
      retire(subscription.id);
      result.retired += 1;
      continue;
    }
    run("UPDATE push_subscriptions SET failure_count = failure_count + 1 WHERE id = ?", [subscription.id]);
  }

  return result;
}

function recordDelivery(subscriptionId: string, options: DeliverOptions, message: PushMessage): void {
  run(
    `INSERT OR IGNORE INTO push_deliveries (id, subscription_id, purpose, dedupe_key, title, body, url)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      stableId("push", subscriptionId, options.purpose, options.dedupeKey),
      subscriptionId,
      options.purpose,
      options.dedupeKey,
      message.title,
      message.body,
      message.url ?? null,
    ],
  );
}

/**
 * The `aud` claim is the origin of the *push resource*, not of our site.
 *
 * RFC 8292 §2 wants the audience the push service is going to see, which is the
 * endpoint's own host (`https://fcm.googleapis.com`, `https://updates.push.services.mozilla.com`).
 * Getting this wrong produces a 401 from the push service with a body that
 * reads "invalid audience", which is a miserable thing to debug.
 */
function originOf(endpoint: string): string {
  try {
    return new URL(endpoint).origin;
  } catch {
    return env.vapidOrigin;
  }
}

/** Delivery history for the Reminders modal's "recent" list. */
export function recentDeliveries(userId: string, limit = 20) {
  return all<{
    purpose: string;
    title: string;
    body: string;
    url: string | null;
    delivered_at: string;
  }>(
    `SELECT d.purpose, d.title, d.body, d.url, d.delivered_at
       FROM push_deliveries d
       JOIN push_subscriptions s ON s.id = d.subscription_id
      WHERE s.user_id = ?
      ORDER BY d.delivered_at DESC
      LIMIT ?`,
    [userId, limit],
  );
}

/** Housekeeping: drop delivery rows for devices that no longer exist. */
export function pruneDeliveries(olderThanDays = 30): number {
  return run(
    `DELETE FROM push_deliveries
      WHERE delivered_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?)`,
    [`-${olderThanDays} days`],
  ).changes;
}
