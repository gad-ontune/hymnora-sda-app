/**
 * Web Push, implemented against RFC 8291 and RFC 8292 with nothing but
 * `node:crypto`.
 *
 * There is a `web-push` package for this. It is not used, for two reasons: the
 * delivery path is the one part of the app that has to be correct on a phone,
 * and a dependency that fails closed on a key error is worse than 200 lines of
 * arithmetic you can read. The relevant pieces:
 *
 *  - RFC 8292 (VAPID) signs the request with ES256 over P-256. Node's
 *    `crypto.sign` emits the r||s concatenation with `dsaEncoding: "ieee-p1363"`,
 *    which is exactly what the JWT ES256 header demands — DER would be rejected.
 *  - RFC 8291 (aes128gcm) encrypts the payload with a per-message ECDH key
 *    agreement, then stretches the shared secret through three HKDF rounds.
 *
 * Everything here is deterministic given its inputs, which is what makes the
 * round-trip test in `tests/web-push.test.ts` meaningful.
 */

import {
  createCipheriv,
  createDecipheriv,
  createECDH,
  createHash,
  createHmac,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as cryptoSign,
  randomBytes,
} from "node:crypto";

const VAPID_ES256 = { name: "ES256" } as const;
const MAX_PAYLOAD_BYTES = 4_096; // aes128gcm adds 86 bytes of framing.

export type PushSubscriptionKeys = {
  p256dh: string;
  auth: string;
};

export type PushTarget = {
  endpoint: string;
  keys: PushSubscriptionKeys;
};

export type PushMessage = {
  title: string;
  body: string;
  /** Relative path the notification click opens, e.g. `/bible`. */
  url?: string | null;
  tag?: string | null;
  /** `daily-verse` and friends, used by the service worker to pick an icon. */
  purpose?: string | null;
  data?: Record<string, unknown> | null;
};

export type SendResult =
  | { ok: true; status: number; expired: false }
  /** 404/410 — the browser threw the subscription away. Retire it. */
  | { ok: false; status: number; expired: true; detail: string }
  | { ok: false; status: number; expired: false; detail: string };

// ─── base64url helpers ──────────────────────────────────────────────────────

export function base64UrlEncode(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

export function base64UrlDecode(input: string): Buffer {
  return Buffer.from(input, "base64url");
}

/**
 * Uncompressed (0x04 || X || Y) P-256 point, which is the form RFC 8291 puts on
 * the wire and the form `crypto.createECDH` hands back from `generateKeys()`.
 */
export function uncompressedPoint(key: Buffer): Buffer {
  if (key.length !== 65 || key[0] !== 0x04) {
    throw new Error("Expected an uncompressed 65-byte P-256 public point");
  }
  return key;
}

/** Wraps an uncompressed point in the SubjectPublicKeyInfo a PEM needs. */
export function pointToPem(point: Buffer, isPrivate = false, privateScalar?: Buffer): string {
  const spkiPrefix = Buffer.from(
    "3059301306072a8648ce3d020106082a8648ce3d030107034200",
    "hex",
  );
  if (!isPrivate) {
    return createPublicKey({ key: Buffer.concat([spkiPrefix, point]), format: "der", type: "spki" })
      .export({ format: "pem", type: "spki" })
      .toString();
  }
  if (!privateScalar) throw new Error("A private scalar is required to build a private PEM");
  const sec1 = Buffer.concat([
    Buffer.from("3077020101302506072a8648ce3d020106082a8648ce3d030107046d306b0201010420", "hex"),
    privateScalar,
    Buffer.from("a144034200", "hex"),
    point,
  ]);
  return createPrivateKey({ key: sec1, format: "der", type: "sec1" })
    .export({ format: "pem", type: "pkcs8" })
    .toString();
}

/** The public point, base64url — this is what the browser subscribes with. */
export function vapidPublicKeyBase64(privateKeyPem: string): string {
  const key = createPrivateKey(privateKeyPem);
  const spki = createPublicKey(key).export({ format: "der", type: "spki" });
  // The last 65 bytes of a P-256 SPKI are the uncompressed point.
  return base64UrlEncode(spki.subarray(spki.length - 65));
}

/** Generates a VAPID key pair. Run once; store both PEMs outside version control. */
export function generateVapidKeys(): { publicKey: string; privateKey: string } {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return {
    privateKey: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    publicKey: publicKey.export({ format: "pem", type: "spki" }).toString(),
  };
}

// ─── VAPID (RFC 8292) ───────────────────────────────────────────────────────

/**
 * Builds the `Authorization` header value.
 *
 * `aud` is the origin that will send the request, `exp` is capped at 24 hours
 * because push services reject anything longer, and `k` is the uncompressed
 * public point base64url-encoded — not the PEM, which is the single most common
 * way to get this wrong.
 */
export function vapidHeader(
  audience: string,
  subject: string,
  publicKeyBase64: string,
  privateKeyPem: string,
  ttlSeconds = 12 * 60 * 60,
): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const payload = base64UrlEncode(
    JSON.stringify({
      aud: audience,
      exp: now + Math.max(60, Math.min(86_400, ttlSeconds)),
      sub: subject.startsWith("mailto:") || subject.startsWith("https:") ? subject : `mailto:${subject}`,
    }),
  );
  const signingInput = `${header}.${payload}`;
  const signature = cryptoSign("sha256", Buffer.from(signingInput, "utf8"), {
    key: createPrivateKey(privateKeyPem),
    dsaEncoding: "ieee-p1363",
  });
  return `vapid t=${signingInput}.${base64UrlEncode(signature)}, k=${publicKeyBase64}`;
}

// ─── aes128gcm (RFC 8291) ───────────────────────────────────────────────────

/**
 * Encrypts a payload for one subscription.
 *
 * Layout: `salt(16) || rs(4) || idlen(1) || as_public(65) || ciphertext+tag`.
 * The plaintext is `body || 0x02 || padding` — the 0x02 delimiter and the
 * padding record are what RFC 8188 requires, and browsers reject a body
 * without them.
 */
export function encryptPayload(
  message: string | Buffer,
  p256dh: string,
  auth: string,
): Buffer {
  const userPublic = uncompressedPoint(base64UrlDecode(p256dh));
  const authSecret = base64UrlDecode(auth);
  if (authSecret.length !== 16) {
    throw new Error("The subscription's `auth` key must be 16 bytes");
  }

  const plaintext = Buffer.isBuffer(message) ? message : Buffer.from(message, "utf8");
  if (plaintext.length > MAX_PAYLOAD_BYTES) {
    throw new Error(`Push payloads are capped at ${MAX_PAYLOAD_BYTES} bytes`);
  }
  // 0x02 is the "last record" delimiter, then at least one padding octet.
  const body = Buffer.concat([plaintext, Buffer.from([0x02])]);

  const salt = randomBytes(16);
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const asPublic = uncompressedPoint(ecdh.getPublicKey());
  const sharedSecret = ecdh.computeSecret(userPublic);

  // RFC 8291 §3.4, step 1. The *subscription's* auth key is the HKDF salt and
  // the ECDH shared secret is the input keying material:
  //
  //   IKM = HKDF(salt = auth_secret, ikm = shared_secret,
  //              info = "WebPush: info\0" || ua_public || as_public, 32)
  //
  // This is the part that is easy to get wrong and impossible to debug from the
  // outside: pass the wrong salt and the browser simply never decrypts
  // anything, with no error on either side.
  const ikm = hkdfExpand(
    hmacSha256(authSecret, sharedSecret),
    Buffer.from("WebPush: info\0", "utf8"),
    Buffer.concat([userPublic, asPublic]),
    32,
  );

  // Step 2 (RFC 8188 §2.2): the content keys come out of the IKM.
  const prk = hmacSha256(ikm, Buffer.from("Content-Encoding: aes128gcm\0", "utf8"));
  const cek = hkdfExpand(prk, Buffer.from("Content-Encoding: aes128gcm\0", "utf8"), null, 16);
  const nonce = hkdfExpand(prk, Buffer.from("Content-Encoding: nonce\0", "utf8"), null, 12);

  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  const ciphertext = Buffer.concat([cipher.update(body), cipher.final()]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([
    salt,
    recordSizeAsBuffer(4096),
    Buffer.from([asPublic.length]),
    asPublic,
    ciphertext,
    tag,
  ]);
}

/**
 * The inverse of `encryptPayload`, run from the *subscriber's* side.
 *
 * Note which key goes in: the browser holds `d_user` and only publishes
 * `UA = d_user·G`, so it reaches the shared secret as `d_user·QA`. Asking this
 * function for a receiver public point instead would silently produce garbage,
 * because the app never learns `d_user`.
 */
export function decryptPayload(body: Buffer, userPrivateScalar: Buffer, auth: string): Buffer {
  const salt = body.subarray(0, 16);
  const idlen = body[20];
  const asPublic = uncompressedPoint(body.subarray(21, 21 + idlen));
  const ciphertext = body.subarray(21 + idlen);
  const authSecret = base64UrlDecode(auth);
  if (authSecret.length !== 16) throw new Error("The subscription's `auth` key must be 16 bytes");

  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(userPrivateScalar);
  const sharedSecret = ecdh.computeSecret(asPublic);
  const userPublic = uncompressedPoint(ecdh.getPublicKey());

  const ikm = hkdfExpand(
    hmacSha256(authSecret, sharedSecret),
    Buffer.from("WebPush: info\0", "utf8"),
    Buffer.concat([userPublic, asPublic]),
    32,
  );
  const prk = hmacSha256(ikm, Buffer.from("Content-Encoding: aes128gcm\0", "utf8"));
  const cek = hkdfExpand(prk, Buffer.from("Content-Encoding: aes128gcm\0", "utf8"), null, 16);
  const nonce = hkdfExpand(prk, Buffer.from("Content-Encoding: nonce\0", "utf8"), null, 12);

  const tag = ciphertext.subarray(ciphertext.length - 16);
  const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ciphertext.subarray(0, ciphertext.length - 16)), decipher.final()]);

  const delimiter = plain.lastIndexOf(0x02);
  if (delimiter === -1) throw new Error("Push body is missing its 0x02 record delimiter");
  return plain.subarray(0, delimiter);
}

function hmacSha256(key: Buffer, data: Buffer): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

/**
 * RFC 5869 §2.3, the expand step only.
 *
 * `crypto.hkdfSync` always does extract-then-expand, which is the wrong
 * operation here: RFC 8291 specifies the PRK explicitly and then expands it.
 * The two-step input is `info || separator`, where RFC 8188's `separator` is
 * the `user-agent || as_public` block and RFC 8188's content keys pass `null`.
 */
function hkdfExpand(prk: Buffer, info: Buffer, separator: Buffer | null, length: number): Buffer {
  const infoWithSeparator = separator ? Buffer.concat([info, separator]) : info;
  const hashLength = 32;
  const blocks = Math.ceil(length / hashLength);
  if (blocks > 255) throw new Error("HKDF output is longer than RFC 5869 allows");

  const chunks: Buffer[] = [];
  let previous = Buffer.alloc(0);
  for (let counter = 1; counter <= blocks; counter += 1) {
    previous = createHmac("sha256", prk)
      .update(Buffer.concat([previous, infoWithSeparator, Buffer.from([counter])]))
      .digest();
    chunks.push(previous);
  }
  return Buffer.concat(chunks).subarray(0, length);
}

/**
 * A subscription key pair, as a browser would generate one.
 *
 * The app never needs this in production — it exists so tests can decrypt what
 * `encryptPayload` produced and assert the round trip, and so the Reminders
 * modal has real-looking keys to exercise against a local push endpoint.
 */
export function generateSubscriptionKeys(): {
  p256dh: string;
  auth: string;
  privateScalar: Buffer;
} {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return {
    p256dh: base64UrlEncode(uncompressedPoint(ecdh.getPublicKey())),
    auth: base64UrlEncode(randomBytes(16)),
    privateScalar: ecdh.getPrivateKey(),
  };
}

function recordSizeAsBuffer(size: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(size, 0);
  return buffer;
}

// ─── Delivery ───────────────────────────────────────────────────────────────

/**
 * Serialises the message the service worker receives. Kept small on purpose:
 * a 4 KB payload is the hard ceiling and a long verse plus a reference will
 * use most of it.
 */
export function serializeMessage(message: PushMessage): string {
  const payload: Record<string, unknown> = {
    title: message.title,
    body: message.body,
    url: message.url ?? "/",
    tag: message.tag ?? undefined,
    purpose: message.purpose ?? undefined,
    data: message.data ?? undefined,
  };
  return JSON.stringify(payload, (key, value) => (value === undefined ? undefined : value));
}

/**
 * A short digest of a push endpoint, so a browser can recognise its own row.
 *
 * The Reminders modal manages *this* device, and the only thing a browser can
 * match on is its own endpoint. Endpoints are long, unique and push-service
 * specific, so handing them back to a client that only needs to know "is this
 * me?" would hand over the one identifier that can be used to send to it.
 *
 * Both sides take the first 16 hex characters of the SHA-256. That is 64 bits —
 * nowhere near enough to collide across the handful of devices one person owns,
 * and it reveals nothing about the endpoint itself.
 */
export function endpointFingerprint(endpoint: string): string {
  return createHash("sha256").update(endpoint).digest("hex").slice(0, 16);
}

export type SendOptions = {
  audience: string;
  subject: string;
  publicKeyBase64: string;
  privateKeyPem: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

/**
 * Sends one notification. Never throws: a push service that is down, slow, or
 * unhappy with the token has to be an ordinary result the caller records, not
 * an exception that kills the sweep over the remaining users.
 */
export async function sendPush(
  target: PushTarget,
  message: PushMessage,
  options: SendOptions,
): Promise<SendResult> {
  const doFetch = options.fetchImpl ?? fetch;
  let body: Buffer;
  try {
    body = encryptPayload(serializeMessage(message), target.keys.p256dh, target.keys.auth);
  } catch (error) {
    return { ok: false, status: 0, expired: false, detail: describe(error) };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 8_000);
  try {
    const response = await doFetch(target.endpoint, {
      method: "POST",
      headers: {
        TTL: "86400",
        Urgency: "high",
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        "Content-Length": String(body.byteLength),
        Authorization: vapidHeader(
          options.audience,
          options.subject,
          options.publicKeyBase64,
          options.privateKeyPem,
        ),
      },
      body: new Uint8Array(body),
      signal: controller.signal,
    });
    if (response.ok) return { ok: true, status: response.status, expired: false };
    const detail = (await response.text().catch(() => "")).slice(0, 400);
    const expired = response.status === 404 || response.status === 410;
    return { ok: false, status: response.status, expired, detail };
  } catch (error) {
    return { ok: false, status: 0, expired: false, detail: describe(error) };
  } finally {
    clearTimeout(timer);
  }
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
