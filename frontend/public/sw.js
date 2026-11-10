/*
 * The Hymnora service worker.
 *
 * It exists for one reason: to receive Web Push. There is deliberately no
 * fetch handler here — caching app routes behind a service worker produces the
 * "the site is serving me yesterday's HTML" class of bug, and the app is
 * server-rendered and already cached at the framework layer.
 *
 * The payload is decrypted by the browser (`event.data.json()` works because the
 * server sends it as `aes128gcm` and the browser holds the matching keys), so
 * this file never handles cryptography.
 */

self.addEventListener("install", () => {
  // Take over immediately: a reminder should reach a worker that is already
  // installed rather than waiting for every old tab to close.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

/** Tapping a reminder should focus an existing tab rather than open a second one. */
async function focusOrOpen(url) {
  const target = new URL(url, self.location.origin).href;
  const clientList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of clientList) {
    if (new URL(client.url).origin === self.location.origin) {
      await client.focus();
      if ("navigate" in client) await client.navigate(target).catch(() => undefined);
      return;
    }
  }
  await self.clients.openWindow(target);
}

self.addEventListener("push", (event) => {
  let payload = { title: "Hymnora", body: "", url: "/", tag: "hymnora" };

  // A push with no body is still a valid push; the browser requires a
  // `showNotification` call either way, so fall back rather than dropping it.
  if (event.data) {
    try {
      payload = { ...payload, ...event.data.json() };
    } catch {
      payload.body = event.data.text();
    }
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      // A tag replaces an existing notification of the same name, so a reminder
      // that re-fires updates in place instead of stacking up.
      tag: payload.tag,
      renotify: false,
      icon: "/icons/icon-192.png",
      badge: "/icons/badge.png",
      timestamp: Date.now(),
      data: { url: payload.url },
      // A reminder that needs no action should still be dismissible.
      requireInteraction: false,
      vibrate: [80, 40, 80],
      actions: [{ action: "open", title: "Open" }],
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(focusOrOpen(url));
});

/** Lets the page ask a notification to close, e.g. after the user reads it in-app. */
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "close-notification" && event.data.tag) {
    self.registration.getNotifications({ tag: event.data.tag }).then((list) => {
      for (const notification of list) notification.close();
    });
  }
});
