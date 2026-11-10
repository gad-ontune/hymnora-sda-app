#!/usr/bin/env node --experimental-strip-types
/**
 * Sends one real push to one real subscription, to prove the whole path works.
 *
 *     npm run push:test -- <userId> [purpose]
 *
 * A round trip that only encrypts and decrypts in-process (which is what
 * `tests/web-push.test.ts` does) cannot catch the three things that actually
 * break in production: a VAPID subject the push service rejects, a service
 * worker that is registered at the wrong scope, and a payload whose shape the
 * browser cannot read. This script exercises the real service.
 *
 * It uses the most recently created subscription for the user, so the
 * notification lands on whichever device they last turned reminders on for.
 */

import { env } from "../src/config/env.ts";
import { all, get, run } from "../src/db/client.ts";
import { sendPush, vapidPublicKeyBase64 } from "../src/lib/web-push.ts";
import { localNow, verseOfTheDay } from "../src/modules/push/reminders.ts";

const userId = process.argv[2];
const purpose = process.argv[3] ?? "daily_verse";

if (!userId) {
  process.stderr.write(
    "Usage: npm run push:test -- <userId> [daily_verse|reading_streak|live_worship]\n\n" +
      "  Find a user id with: sqlite3 data/hymnora.db 'SELECT id, email FROM users LIMIT 5;'\n",
  );
  process.exit(1);
}

if (!env.vapidPublicKey || !env.vapidPrivateKey) {
  process.stderr.write("VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY are not set. Run `npm run vapid:new` first.\n");
  process.exit(1);
}

const subscription = get<{
  endpoint: string;
  p256dh: string;
  auth: string;
  device_label: string | null;
  timezone: string | null;
}>(
  `SELECT endpoint, p256dh, auth, device_label, timezone
     FROM push_subscriptions
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT 1`,
  [userId],
);

if (!subscription) {
  process.stderr.write(`No push subscription on file for ${userId}.\n`);
  process.stderr.write("Open the Reminders modal in a browser and turn a reminder on first.\n");
  process.exit(1);
}

const user = get<{ email: string; full_name: string }>("SELECT email, full_name FROM users WHERE id = ?", [userId]);
if (!user) {
  process.stderr.write(`No such user: ${userId}\n`);
  process.exit(1);
}

const samples: Record<string, { title: string; body: string; url: string }> = {
  daily_verse: {
    title: "Verse of the day",
    body: verseOfTheDay(userId, localNow(subscription.timezone ?? "Africa/Nairobi")?.day ?? "2026-01-01")?.text ??
      "For God so loved the world, that he gave his only begotten Son.",
    url: "/bible",
  },
  reading_streak: {
    title: "Keep your streak",
    body: "You have not opened a chapter today. Ten minutes is enough.",
    url: "/bible",
  },
  live_worship: {
    title: "Live worship starting soon",
    body: "Adventist Choir of Kenya goes live in 15 minutes.",
    url: "/live",
  },
};

const message = samples[purpose] ?? samples.daily_verse!;

process.stdout.write(
  `\nSending a ${purpose} push to ${user.email}\n` +
    `  device   ${subscription.device_label ?? "(unlabelled)"}\n` +
    `  endpoint ${subscription.endpoint.slice(0, 60)}…\n` +
    `  zone     ${subscription.timezone ?? "unset"}\n\n`,
);

const result = await sendPush(
  { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
  { ...message, tag: `test-${purpose}`, purpose },
  {
    // The audience is the push service, derived from the endpoint's own origin —
    // FCM, Mozilla autopush and each vendor's host each have to be named
    // correctly or they reject the token.
    audience: new URL(subscription.endpoint).origin,
    subject: env.vapidSubject,
    // Derived from the private key rather than read from VAPID_PUBLIC_KEY, so a
    // mismatched pair in `.env` shows up here as a delivery failure instead of
    // as a signature the push service silently refuses.
    publicKeyBase64: vapidPublicKeyBase64(env.vapidPrivateKey),
    privateKeyPem: env.vapidPrivateKey,
    timeoutMs: env.pushTimeoutMs,
  },
);

run(
  `INSERT INTO push_deliveries (user_id, subscription_id, purpose, title, body, status, status_code, detail, sent_at, created_at)
   SELECT ?, id, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now') FROM push_subscriptions
    WHERE user_id = ? AND endpoint = ?`,
  [
    userId,
    purpose,
    message.title,
    message.body,
    result.ok ? "sent" : "failed",
    result.status,
    result.ok ? null : result.detail,
    userId,
    subscription.endpoint,
  ],
);

if (result.ok) {
  process.stdout.write(
    `Delivered (HTTP ${result.status}).\n` +
      "This proves the server can sign, encrypt and reach the push service. If nothing\n" +
      "appeared on the device, the problem is in the service worker or the browser's\n" +
      "notification permission, not in the API — check the console for the push event.\n\n",
  );
} else {
  process.stdout.write(`Failed (HTTP ${result.status}): ${result.detail}\n\n`);
  if (result.expired) {
    process.stdout.write("The subscription is dead. Open the Reminders modal to re-subscribe.\n\n");
  }
}

process.stdout.write(`Recent deliveries for this user:\n`);
for (const row of all<{ purpose: string; status: string; sent_at: string; detail: string | null }>(
  "SELECT purpose, status, sent_at, detail FROM push_deliveries WHERE user_id = ? ORDER BY id DESC LIMIT 5",
  [userId],
)) {
  process.stdout.write(`  ${row.sent_at}  ${pad(row.purpose, 16)} ${pad(row.status, 8)} ${row.detail ?? ""}\n`);
}
process.stdout.write("\n");

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}
