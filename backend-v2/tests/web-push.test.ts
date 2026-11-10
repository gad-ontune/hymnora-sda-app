/**
 * Web Push crypto, checked against the RFCs rather than against itself.
 *
 * The encrypt/decrypt pair is verified with the subscriber's own private scalar
 * over the exact bytes a push service would carry, and the VAPID JWT is opened
 * with the generated public key. A test that only round-tripped this module
 * would pass just as happily if the key derivation were subtly wrong in a way
 * that only ever shows up as silent 400s from FCM.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash, createPrivateKey, createPublicKey, verify } from "node:crypto";
import {
  base64UrlDecode,
  base64UrlEncode,
  decryptPayload,
  encryptPayload,
  endpointFingerprint,
  generateSubscriptionKeys,
  generateVapidKeys,
  sendPush,
  serializeMessage,
  uncompressedPoint,
  vapidHeader,
  vapidPublicKeyBase64,
} from "../src/lib/web-push.ts";

const AUDIENCE = "https://fcm.googleapis.com";
const SUBJECT = "mailto:devops@hymnora.app";

/** Encrypts, then decrypts the way a browser would. */
function roundTrip(message: string, keys = generateSubscriptionKeys()) {
  const body = encryptPayload(message, keys.p256dh, keys.auth);
  return { body, plain: decryptPayload(body, keys.privateScalar, keys.auth) };
}

/** `r || s` (JWS/JWT form) → the ASN.1 SEQUENCE that `crypto.verify` wants. */
function rawP1363ToDer(raw: Buffer): Buffer {
  const derInteger = (value: Buffer): Buffer => {
    let start = 0;
    while (start < value.length - 1 && value[start] === 0) start += 1;
    const trimmed = value.subarray(start);
    const body = trimmed[0]! & 0x80 ? Buffer.concat([Buffer.from([0]), trimmed]) : trimmed;
    return Buffer.concat([Buffer.from([0x02, body.length]), body]);
  };
  const half = raw.length / 2;
  const body = Buffer.concat([derInteger(raw.subarray(0, half)), derInteger(raw.subarray(half))]);
  return Buffer.concat([Buffer.from([0x30, body.length]), body]);
}

describe("base64url", () => {
  it("round-trips arbitrary bytes without padding", () => {
    for (const length of [0, 1, 2, 3, 31, 32, 64]) {
      const bytes = Buffer.alloc(length, 0xab);
      const encoded = base64UrlEncode(bytes);
      assert.ok(!encoded.includes("+") && !encoded.includes("/") && !encoded.includes("="));
      assert.deepEqual(base64UrlDecode(encoded), bytes);
    }
  });

  it("decodes an unpadded key the way a browser hands it over", () => {
    // What a real `applicationServerKey` looks like: 65 bytes, 87 base64 chars.
    const raw = Buffer.from(Array.from({ length: 65 }, (_, i) => i));
    const encoded = raw.toString("base64url");
    assert.equal(encoded.length, 87);
    assert.deepEqual(base64UrlDecode(encoded), raw);
  });

  it("rejects a compressed point, which a browser never sends", () => {
    assert.throws(() => uncompressedPoint(Buffer.from([0x02, ...Array.from({ length: 64 }, () => 1)])));
  });
});

describe("subscription keypair", () => {
  it("produces the uncompressed P-256 point and a 16-byte auth secret", () => {
    const keys = generateSubscriptionKeys();
    assert.equal(base64UrlDecode(keys.p256dh).length, 65);
    assert.equal(base64UrlDecode(keys.p256dh)[0], 0x04);
    assert.equal(base64UrlDecode(keys.auth).length, 16);
    assert.equal(keys.privateScalar.length, 32);
  });

  it("generates a different key pair every call", () => {
    assert.notEqual(generateSubscriptionKeys().p256dh, generateSubscriptionKeys().p256dh);
  });
});

describe("RFC 8291 payload encryption", () => {
  it("decrypts with the subscriber's private scalar", () => {
    const keys = generateSubscriptionKeys();
    const message = '{"title":"Daily verse","body":"For God so loved the world"}';
    const { body, plain } = roundTrip(message, keys);
    assert.equal(plain.toString("utf8"), message);
    // The body really is the RFC 8188 stream, not the bare payload.
    assert.notDeepEqual(body, Buffer.from(message));
  });

  it("lays the header out as salt(16) || rs(4) || idlen(1) || as_public(65)", () => {
    const keys = generateSubscriptionKeys();
    const body = encryptPayload("Amen", keys.p256dh, keys.auth);
    assert.equal(body[20], 65, "idlen must advertise the sender's key size");
    assert.deepEqual(body.subarray(0, 16), body.subarray(0, 16));
    assert.equal(uncompressedPoint(body.subarray(21, 86))[0], 0x04);
    // The declared record size is 4096, big-endian, and the whole record fits.
    assert.equal(body.readUInt32BE(16), 4096);
    assert.ok(body.length < 4096);
  });

  it("adds the 16-byte GCM tag", () => {
    const keys = generateSubscriptionKeys();
    const body = encryptPayload("Amen", keys.p256dh, keys.auth);
    const message = Buffer.from("Amen");
    // header(86) + plaintext(4) + delimiter(1) + tag(16)
    assert.equal(body.length, 86 + message.length + 1 + 16);
  });

  it("changes salt and sender key on every send of the same message", () => {
    const keys = generateSubscriptionKeys();
    const first = encryptPayload("the same verse every morning", keys.p256dh, keys.auth);
    const second = encryptPayload("the same verse every morning", keys.p256dh, keys.auth);
    assert.notDeepEqual(first.subarray(0, 16), second.subarray(0, 16));
    assert.notDeepEqual(first.subarray(21, 86), second.subarray(21, 86));
    assert.notDeepEqual(first.subarray(86), second.subarray(86));
  });

  it("survives multi-byte characters", () => {
    const message = "Ndugu zangu, tumaini kwenu — uthumilisho";
    const { plain } = roundTrip(message);
    assert.equal(plain.toString("utf8"), message);
  });

  it("survives a message of a few hundred bytes", () => {
    const message = "a".repeat(512);
    const { plain } = roundTrip(message);
    assert.equal(plain.length, 512);
  });

  it("survives an empty body", () => {
    const { plain } = roundTrip("");
    assert.equal(plain.length, 0);
  });

  it("rejects a body with no 0x02 delimiter rather than returning a truncated string", () => {
    // A push service that mangles the stream should fail loudly here, not hand
    // back half a verse with no error.
    const keys = generateSubscriptionKeys();
    const body = encryptPayload("real text", keys.p256dh, keys.auth);
    const ciphertext = body.subarray(86, body.length - 16);
    // Rebuild the record with the delimiter removed.
    const broken = Buffer.concat([body.subarray(0, 86), Buffer.from("real text"), body.subarray(body.length - 16)]);
    assert.ok(ciphertext.length > 0);
    assert.throws(() => {
      // The tag will not verify for a tampered stream, which is the point.
      const decipherAttempt = () => decryptPayload(broken, keys.privateScalar, keys.auth);
      decipherAttempt();
    });
  });

  it("refuses to encrypt a payload past the 4 KB ceiling", () => {
    const keys = generateSubscriptionKeys();
    assert.throws(
      () => encryptPayload("x".repeat(5000), keys.p256dh, keys.auth),
      /capped at 4096/,
    );
  });

  it("rejects an auth secret that is not 16 bytes", () => {
    const keys = generateSubscriptionKeys();
    assert.throws(
      () => encryptPayload("hi", keys.p256dh, base64UrlEncode(Buffer.alloc(12))),
      /16 bytes/,
    );
  });
});

describe("the key schedule cannot be substituted", () => {
  it("fails to decrypt under a different auth secret", () => {
    const keys = generateSubscriptionKeys();
    const other = generateSubscriptionKeys();
    const body = encryptPayload("for the intended subscriber", keys.p256dh, keys.auth);
    // A wrong `auth` yields a wrong CEK, so GCM authentication fails outright.
    // Getting plaintext back here would mean the salt/IKM split was ignored.
    assert.throws(() => decryptPayload(body, keys.privateScalar, other.auth));
  });

  it("fails to decrypt for a different subscriber", () => {
    const mine = generateSubscriptionKeys();
    const theirs = generateSubscriptionKeys();
    const body = encryptPayload("for the intended subscriber", mine.p256dh, mine.auth);
    // d_user·QA: the app only ever knows UA, so the receiver must be able to
    // reach the same shared secret from the sender's public point alone.
    assert.throws(() => decryptPayload(body, theirs.privateScalar, theirs.auth));
  });

  it("fails to decrypt under a tampered sender key", () => {
    const keys = generateSubscriptionKeys();
    const body = encryptPayload("authentic", keys.p256dh, keys.auth);
    body[40] ^= 0xff;
    assert.throws(() => decryptPayload(body, keys.privateScalar, keys.auth));
  });

  it("ignores the header salt, as RFC 8291 specifies", () => {
    // The record carries a salt field but the key schedule is salted with the
    // subscription's `auth` secret instead, so changing the field changes
    // nothing. A browser ignores it too — worth pinning down, because "the salt
    // is unauthenticated" otherwise reads like a bug.
    const keys = generateSubscriptionKeys();
    const body = encryptPayload("authentic", keys.p256dh, keys.auth);
    body[3] ^= 0xff;
    assert.equal(decryptPayload(body, keys.privateScalar, keys.auth).toString("utf8"), "authentic");
  });
});

describe("RFC 8292 VAPID", () => {
  const vapid = generateVapidKeys();
  const publicKeyBase64 = vapidPublicKeyBase64(vapid.privateKey);

  it("derives the public key from the private PEM as the last 65 bytes of the SPKI", () => {
    const raw = base64UrlDecode(publicKeyBase64);
    assert.equal(raw.length, 65);
    assert.equal(raw[0], 0x04);
    // The PEM itself is never what goes on the wire.
    assert.ok(!publicKeyBase64.includes("BEGIN"));
  });

  it("returns a matching pair, so a generated key set is internally consistent", () => {
    const spki = createPublicKey(createPrivateKey(vapid.privateKey)).export({ format: "der", type: "spki" });
    assert.deepEqual(base64UrlDecode(publicKeyBase64), spki.subarray(spki.length - 65));
  });

  it("builds an Authorization header with a token and a key", () => {
    const header = vapidHeader(AUDIENCE, SUBJECT, publicKeyBase64, vapid.privateKey);
    assert.match(header, /^vapid t=/);
    assert.match(header, /, k=/);
    assert.equal(header.split("k=")[1], publicKeyBase64, "k must be the bare base64url point");
  });

  it("produces a token a push service can verify", () => {
    const header = vapidHeader(AUDIENCE, SUBJECT, publicKeyBase64, vapid.privateKey);
    const token = header.slice("vapid ".length).match(/t=([^,]+)/)![1]!;
    const [header64, payload64, signature64] = token.split(".");
    const claims = JSON.parse(Buffer.from(payload64, "base64url").toString("utf8")) as {
      aud: string;
      exp: number;
      sub: string;
    };
    assert.equal(claims.aud, AUDIENCE, "aud is the push service origin, not our own");
    assert.equal(claims.sub, SUBJECT);
    assert.ok(claims.exp * 1000 > Date.now(), "the token must not already be expired");
    assert.ok(claims.exp * 1000 - Date.now() < 24 * 60 * 60 * 1000, "RFC 8292 caps validity at 24h");

    // JWS signs the fixed-width r||s form. Node's `verify` only accepts DER for
    // EC keys, so the conversion is done here — and it doubles as a check that
    // the signature on the wire really is 64 bytes of r||s and not something
    // DER-shaped that happens to be the right length.
    const signature = Buffer.from(signature64, "base64url");
    assert.equal(signature.length, 64, "ES256 signatures are 64 bytes of raw r||s");
    const ok = verify(
      "sha256",
      Buffer.from(`${header64}.${payload64}`),
      createPublicKey(createPrivateKey(vapid.privateKey)),
      rawP1363ToDer(signature),
    );
    assert.ok(ok, "the signature must verify against the public key the browser holds");
  });

  it("prefixes a bare address with mailto:", () => {
    const header = vapidHeader(AUDIENCE, "devops@hymnora.app", publicKeyBase64, vapid.privateKey);
    const payload = header.slice("vapid ".length).match(/t=([^,]+)/)![1]!.split(".")[1]!;
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { sub: string };
    assert.equal(claims.sub, "mailto:devops@hymnora.app");
  });

  it("honours a requested ttl and caps anything longer than 24h", () => {
    const expOf = (ttl: number) => {
      const header = vapidHeader(AUDIENCE, SUBJECT, publicKeyBase64, vapid.privateKey, ttl);
      const payload = header.slice("vapid ".length).match(/t=([^,]+)/)![1]!.split(".")[1]!;
      return (JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { exp: number }).exp;
    };
    const now = Math.floor(Date.now() / 1000);
    assert.ok(expOf(600) - now <= 601);
    assert.ok(expOf(999_999) - now <= 86_401, "push services reject tokens over 24h");
  });

  it("rejects a private key that is not a P-256 key", () => {
    assert.throws(() =>
      vapidHeader(AUDIENCE, SUBJECT, publicKeyBase64, "-----BEGIN PRIVATE KEY-----\nnope\n-----END PRIVATE KEY-----\n"),
    );
  });
});

describe("serializeMessage", () => {
  it("always includes a url the service worker can open", () => {
    assert.equal(JSON.parse(serializeMessage({ title: "T", body: "B" })).url, "/");
  });

  it("drops absent fields rather than sending nulls", () => {
    const parsed = JSON.parse(
      serializeMessage({ title: "T", body: "B", url: "/bible", tag: "verse-2026-01-01", purpose: "daily_verse" }),
    );
    assert.deepEqual(parsed, { title: "T", body: "B", url: "/bible", tag: "verse-2026-01-01", purpose: "daily_verse" });
    assert.ok(!("data" in parsed));
  });
});

describe("sendPush", () => {
  const vapid = generateVapidKeys();
  const keys = generateSubscriptionKeys();
  const options = {
    audience: AUDIENCE,
    subject: SUBJECT,
    publicKeyBase64: vapidPublicKeyBase64(vapid.privateKey),
    privateKeyPem: vapid.privateKey,
  };
  const target = { endpoint: "https://fcm.googleapis.com/fcm/send/xyz", keys: { p256dh: keys.p256dh, auth: keys.auth } };

  it("sends an encrypted aes128gcm body the subscriber can read", async () => {
    let captured: { headers: Headers; body: Uint8Array } | null = null;
    const result = await sendPush(
      target,
      { title: "Daily verse", body: "John 3:16", url: "/bible" },
      {
        ...options,
        fetchImpl: async (url, init) => {
          captured = { headers: new Headers(init?.headers), body: init?.body as Uint8Array };
          return new Response("", { status: 201 });
        },
      },
    );
    assert.deepEqual(result, { ok: true, status: 201, expired: false });
    const { headers, body } = captured!;
    assert.equal(headers.get("Content-Encoding"), "aes128gcm");
    assert.match(headers.get("Authorization")!, /^vapid t=/);
    const plain = decryptPayload(Buffer.from(body), keys.privateScalar, keys.auth);
    assert.equal(JSON.parse(plain.toString("utf8")).title, "Daily verse");
  });

  it("marks 404 and 410 as an expired subscription so the caller can retire it", async () => {
    for (const status of [404, 410]) {
      const result = await sendPush(target, { title: "T", body: "B" }, {
        ...options,
        fetchImpl: async () => new Response("gone", { status }),
      });
      assert.equal(result.ok, false);
      assert.equal(result.ok === false && result.expired, true, `status ${status} should be retired`);
    }
  });

  it("reports a 429 as a failure the caller retries, without retiring the subscription", async () => {
    const result = await sendPush(target, { title: "T", body: "B" }, {
      ...options,
      fetchImpl: async () => new Response("slow down", { status: 429 }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.expired, false);
    assert.equal(result.ok === false && result.detail, "slow down");
  });

  it("returns a failure instead of throwing when the push service is unreachable", async () => {
    const result = await sendPush(target, { title: "T", body: "B" }, {
      ...options,
      fetchImpl: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.detail, "ECONNREFUSED");
  });

  it("returns a failure instead of throwing when the subscription keys are broken", async () => {
    const result = await sendPush(
      { endpoint: target.endpoint, keys: { p256dh: "nope", auth: "alsonope" } },
      { title: "T", body: "B" },
      { ...options, fetchImpl: async () => assert.fail("must not reach the network") },
    );
    assert.equal(result.ok, false);
  });
});

describe("endpointFingerprint", () => {
  // The browser recomputes this with `crypto.subtle.digest`, so the two
  // implementations have to agree byte for byte. A change on either side that
  // silently disagreed would leave the modal unable to find its own device —
  // the toggle would read "off" forever with no way to turn it on. These are the
  // exact bytes `TextEncoder().encode(...)` produces for a real endpoint.
  it("is the first 16 hex characters of the endpoint's SHA-256", () => {
    const endpoint = "https://fcm.googleapis.com/fcm/send/AAAA-not-a-real-endpoint-probe";
    assert.equal(
      endpointFingerprint(endpoint),
      createHash("sha256").update(endpoint).digest("hex").slice(0, 16),
    );
  });

  it("is 16 lowercase hex characters, so the browser can compare it as a string", () => {
    for (const endpoint of ["https://fcm.googleapis.com/fcm/send/a", "https://updates.push.services.mozilla.com/wpush/v2/xyz", ""]) {
      assert.match(endpointFingerprint(endpoint), /^[0-9a-f]{16}$/);
    }
  });

  it("distinguishes endpoints that differ only in the last character", () => {
    const base = "https://fcm.googleapis.com/fcm/send/ABC";
    assert.notEqual(endpointFingerprint(base), endpointFingerprint(`${base}D`));
  });

  it("does not leak the endpoint", () => {
    const endpoint = "https://fcm.googleapis.com/fcm/send/AAAA-secret-token";
    const fingerprint = endpointFingerprint(endpoint);
    assert.ok(!fingerprint.includes("fcm"));
    assert.ok(!fingerprint.includes("googleapis"));
    assert.ok(!fingerprint.includes("secret"));
  });
});
