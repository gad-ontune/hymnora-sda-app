"use client";

/**
 * Web Push, from the browser's side.
 *
 * The three states a browser can be in, which the Reminders modal has to tell
 * apart because each one is a different thing to say to the user:
 *
 *   unsupported — no `PushManager`, or not a secure context. Nothing to do.
 *   denied      — permission already refused. Re-prompting is impossible, so
 *                 the UI has to explain rather than ask again.
 *   granted     — subscribable, and the only state where the toggle means
 *                 "turn on", as opposed to "you cannot turn this on".
 *
 * Subscribing is a two-part operation and both parts must succeed: the browser
 * gives us an `endpoint`, and the server only starts sending if it has that
 * endpoint *and* the matching keys. Unsubscribing has to go the other way too,
 * or the server keeps sending to a dead subscription until it 410s.
 */

export type PushState =
  | { status: "unsupported"; reason: "no-push-manager" | "insecure-context" }
  | { status: "denied" }
  | { status: "default" }
  | { status: "granted"; subscription: PushSubscription }
  | { status: "subscribing" }
  | { status: "error"; message: string };

export const SERVICE_WORKER_PATH = "/sw.js";

/** `true` when the browser can do Web Push at all. */
export function pushSupported(): boolean {
  if (typeof window === "undefined") return false;
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return false;
  // Push only works over HTTPS, except on localhost. A reminder toggle that
  // silently does nothing over plain http is worse than one that says why.
  return window.isSecureContext;
}

/**
 * Why push is unavailable, when it is.
 *
 * Worth distinguishing: "open this over HTTPS" is something a user can act on,
 * and "this browser cannot do it" is not.
 */
export function pushBlockedReason(): "no-push-manager" | "insecure-context" | null {
  if (typeof window === "undefined") return "insecure-context";
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return "no-push-manager";
  if (!window.isSecureContext) return "insecure-context";
  return null;
}

export async function urlBase64ToUint8Array(base64: string): Promise<Uint8Array<ArrayBuffer>> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalised = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalised);
  // Built into a fresh ArrayBuffer explicitly: `Uint8Array.from` can be handed a
  // shared buffer, which `applicationServerKey` does not accept.
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  return bytes;
}

/** Registers (or reuses) the service worker. Must be called before `subscribe`. */
export async function registerWorker(): Promise<ServiceWorkerRegistration> {
  if (!("serviceWorker" in navigator)) throw new Error("This browser has no service worker support");
  return navigator.serviceWorker.register(SERVICE_WORKER_PATH, { scope: "/" });
}

/** The current permission, without prompting. */
export async function currentPermission(): Promise<NotificationPermission | "unsupported"> {
  if (!pushSupported()) return "unsupported";
  if (!("Notification" in window)) return "unsupported";
  return Notification.permission;
}

/** The browser's own subscription for this origin, if it already has one. */
export async function existingSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

/**
 * Asks for permission and subscribes.
 *
 * `applicationServerKey` must be the VAPID *public* key from
 * `GET /api/push/config` — the private half never leaves the server, and the
 * browser rejects the subscription if it is ever used here.
 */
export async function subscribe(vapidPublicKey: string): Promise<PushSubscription> {
  if (!pushSupported()) throw new Error("Push is not available in this browser");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error(permission === "denied" ? "Permission was denied" : "Permission was dismissed");

  const registration = await registerWorker();
  const existing = await registration.pushManager.getSubscription();
  if (existing) return existing;

  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: await urlBase64ToUint8Array(vapidPublicKey),
  });
}

export async function unsubscribe(): Promise<boolean> {
  const subscription = await existingSubscription();
  if (!subscription) return false;
  return subscription.unsubscribe();
}

/** The POST body shape the server's `subscribeSchema` expects. */
export function subscriptionPayload(subscription: PushSubscription, deviceLabel: string | null, timezone: string) {
  const json = subscription.toJSON();
  return {
    endpoint: subscription.endpoint,
    keys: { p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" },
    contentEncoding: "aes128gcm",
    deviceLabel,
    timezone,
  };
}

/**
 * The user's timezone, for scheduling a reminder at "07:00 local".
 *
 * `Intl` is the only source of truth available in a browser, and it is right
 * far more often than an IP-derived guess. The server falls back to
 * Africa/Nairobi when this is missing.
 */
export function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Africa/Nairobi";
  } catch {
    return "Africa/Nairobi";
  }
}

/** A short human label for the device list: "Chrome on macOS". */
export function deviceLabel(): string {
  if (typeof navigator === "undefined") return "This device";
  const ua = navigator.userAgent;
  const browser =
    /Edg\//.test(ua) ? "Edge"
    : /OPR\//.test(ua) ? "Opera"
    : /Firefox\//.test(ua) ? "Firefox"
    : /Chrome\//.test(ua) ? "Chrome"
    : /Safari\//.test(ua) ? "Safari"
    : "Browser";
  const platform = /iPhone|iPad/.test(ua) ? "iOS"
    : /Android/.test(ua) ? "Android"
    : /Mac OS X/.test(ua) ? "macOS"
    : /Windows/.test(ua) ? "Windows"
    : /Linux/.test(ua) ? "Linux"
    : "";
  return platform ? `${browser} on ${platform}` : browser;
}

// ─── The server side ──────────────────────────────────────────────────────────

import { authedFetch } from "./session";
import type { PushConfig, PushStatus } from "./types";

/**
 * `GET /api/push/config`. The only push endpoint that is public, because the
 * Reminders modal has to be able to say "this server cannot deliver anything"
 * before anyone has signed in.
 */
export async function getPushConfig(fetcher: typeof fetch = fetch): Promise<PushConfig> {
  const base = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
  const res = await fetcher(`${base}/api/push/config`);
  if (!res.ok) return { configured: false, publicKey: null };
  return res.json();
}

/** `GET /api/push/subscriptions` — this account's devices. */
export async function getPushStatus(fetcher: typeof fetch = fetch): Promise<PushStatus> {
  const res = await authedFetch("/api/push/subscriptions", {}, fetcher);
  if (!res.ok) throw new Error(`push status failed: ${res.status}`);
  return res.json();
}

/** `POST /api/push/subscriptions` — hand the server this device's endpoint. */
export async function registerDevice(
  subscription: PushSubscription,
  fetcher: typeof fetch = fetch,
): Promise<{ id: string; createdAt: string }> {
  const res = await authedFetch(
    "/api/push/subscriptions",
    {
      method: "POST",
      body: JSON.stringify(subscriptionPayload(subscription, deviceLabel(), deviceTimezone())),
    },
    fetcher,
  );
  if (!res.ok) throw new Error(`subscribe failed: ${res.status}`);
  return res.json();
}

/** `DELETE /api/push/subscriptions/:id` — forget one device. */
export async function removeDevice(id: string, fetcher: typeof fetch = fetch): Promise<void> {
  const res = await authedFetch(`/api/push/subscriptions/${id}`, { method: "DELETE" }, fetcher);
  // 404 is the same outcome as 204 from here: the row is gone either way.
  if (!res.ok && res.status !== 404) throw new Error(`unsubscribe failed: ${res.status}`);
}

/** `POST /api/push/test` — proof of delivery, not a preference-gated send. */
export async function sendTestPush(fetcher: typeof fetch = fetch): Promise<{ sent: number; failed: number; skipped: number }> {
  const res = await authedFetch("/api/push/test", { method: "POST", body: JSON.stringify({ purpose: "test" }) }, fetcher);
  if (!res.ok) throw new Error(`test push failed: ${res.status}`);
  return res.json();
}

/** SHA-256 prefix of this browser's endpoint, matching the server's own digest. */
export async function endpointFingerprint(subscription: PushSubscription): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(subscription.endpoint));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}
