import { createHash, randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";
import { env } from "../config/env.ts";
import { unauthorized } from "./errors.ts";
import type { UserRole, UserStatus } from "../types/domain.ts";

export type AccessTokenClaims = {
  sub: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  type: "access";
};

export type RefreshTokenClaims = {
  sub: string;
  jti: string;
  type: "refresh";
};

const ISSUER = "hymnora-sda";

/** Converts `15m` / `30d` / `3600` style TTLs into milliseconds. */
export function ttlToMs(ttl: string): number {
  const match = /^(\d+)\s*(ms|s|m|h|d)?$/.exec(ttl.trim());
  if (!match) return 0;
  const amount = Number(match[1]);
  const unit = match[2] ?? "ms";
  const multiplier = unit === "ms" ? 1 : unit === "s" ? 1000 : unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000;
  return amount * multiplier;
}

export function signAccessToken(payload: Omit<AccessTokenClaims, "type">): { token: string; expiresAt: string } {
  const token = jwt.sign({ ...payload, type: "access" }, env.jwtSecret, {
    expiresIn: env.jwtAccessTtl as jwt.SignOptions["expiresIn"],
    issuer: ISSUER,
    audience: "hymnora-api",
  });
  return { token, expiresAt: new Date(Date.now() + ttlToMs(env.jwtAccessTtl)).toISOString() };
}

export function signRefreshToken(userId: string, tokenId: string): { token: string; expiresAt: string } {
  const token = jwt.sign({ sub: userId, jti: tokenId, type: "refresh" }, env.jwtRefreshSecret, {
    expiresIn: env.jwtRefreshTtl as jwt.SignOptions["expiresIn"],
    issuer: ISSUER,
    audience: "hymnora-api",
  });
  return { token, expiresAt: new Date(Date.now() + ttlToMs(env.jwtRefreshTtl)).toISOString() };
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  try {
    const decoded = jwt.verify(token, env.jwtSecret, { issuer: ISSUER, audience: "hymnora-api" });
    if (typeof decoded === "string" || decoded.type !== "access") throw unauthorized("Invalid access token");
    return decoded as unknown as AccessTokenClaims;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) throw unauthorized("Access token expired");
    if (error instanceof jwt.JsonWebTokenError) throw unauthorized("Invalid access token");
    throw error;
  }
}

export function verifyRefreshToken(token: string): RefreshTokenClaims {
  try {
    const decoded = jwt.verify(token, env.jwtRefreshSecret, { issuer: ISSUER, audience: "hymnora-api" });
    if (typeof decoded === "string" || decoded.type !== "refresh") throw unauthorized("Invalid refresh token");
    return decoded as unknown as RefreshTokenClaims;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) throw unauthorized("Refresh token expired");
    if (error instanceof jwt.JsonWebTokenError) throw unauthorized("Invalid refresh token");
    throw error;
  }
}

/** High-entropy opaque token used for email verification and password resets. */
export function createOpaqueToken(bytes = 32): { token: string; hash: string } {
  const token = randomBytes(bytes).toString("base64url");
  return { token, hash: hashOpaqueToken(token) };
}

export function hashOpaqueToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Stable hash of a refresh token, so a database leak cannot be replayed. */
export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
