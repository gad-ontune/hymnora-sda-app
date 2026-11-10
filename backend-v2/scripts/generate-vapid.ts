#!/usr/bin/env node --experimental-strip-types
/**
 * Prints a VAPID key pair for `.env`, and explains what to do with it.
 *
 *     npm run vapid:new
 *
 * Run this once per environment. The private key is what lets the server sign a
 * push request, and it is the one value in `.env` that cannot be replaced without
 * every already-subscribed browser having to subscribe again — so it is printed
 * once and never stored by this script.
 */

import { generateVapidKeys, vapidPublicKeyBase64 } from "../src/lib/web-push.ts";

const vapid = generateVapidKeys();
const publicKeyBase64 = vapidPublicKeyBase64(vapid.privateKey);

const pem = (value: string) => value.replace(/\n/g, "\\n");

process.stdout.write(
  [
    "",
    "VAPID key pair generated. Add these to backend-v2/.env:",
    "",
    `VAPID_PUBLIC_KEY="${pem(vapid.publicKey)}"`,
    `VAPID_PRIVATE_KEY="${pem(vapid.privateKey)}"`,
    "",
    "The browser is handed the public key as base64url, which is:",
    "",
    `  ${publicKeyBase64}`,
    "",
    "That 87-character string is what the Reminders modal subscribes with; the",
    "PEM above is only ever used by the server to sign. /api/push/config returns",
    "the base64url form so nothing has to convert it in the client.",
    "",
    "Rotating the pair invalidates every existing subscription. Subscribers will",
    "re-subscribe the next time they open the Reminders modal, but nobody is",
    "notified until then — do not rotate casually.",
    "",
  ].join("\n"),
);
