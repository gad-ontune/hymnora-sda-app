import type { RequestHandler } from "express";
import { verifyAccessToken } from "../lib/tokens.ts";
import { unauthorized, forbidden } from "../lib/errors.ts";
import { get, type Row } from "../db/client.ts";
import type { UserRole } from "../types/domain.ts";

export type AuthenticatedUser = {
  id: string;
  email: string;
  role: UserRole;
  status: string;
  firstName: string;
  lastName: string;
  displayName: string;
  avatarUrl: string | null;
  emailVerified: boolean;
  language: string;
  city: string | null;
  country: string | null;
  homeChurchId: string | null;
};

declare module "express-serve-static-core" {
  interface Request {
    requestId?: string;
    auth?: AuthenticatedUser;
  }
}

function readToken(req: Parameters<RequestHandler>[0]): string | null {
  const header = req.headers.authorization;
  if (header && header.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim();
  }
  const cookies = req.cookies as Record<string, string> | undefined;
  return cookies?.hymnora_token ?? null;
}

type UserRow = Row & {
  id: string;
  email: string;
  role: string;
  status: string;
  first_name: string;
  last_name: string;
  display_name: string | null;
  avatar_url: string | null;
  email_verified_at: string | null;
  language: string;
  city: string | null;
  country: string | null;
  home_church_id: string | null;
};

function toAuthUser(row: UserRow): AuthenticatedUser {
  return {
    id: row.id,
    email: row.email,
    role: row.role as UserRole,
    status: row.status,
    firstName: row.first_name,
    lastName: row.last_name,
    displayName: row.display_name?.trim() || `${row.first_name} ${row.last_name}`.trim(),
    avatarUrl: row.avatar_url,
    emailVerified: Boolean(row.email_verified_at),
    language: row.language,
    city: row.city,
    country: row.country,
    homeChurchId: row.home_church_id,
  };
}

/** Resolves a token subject to a live user row. */
export function loadUserById(id: string): AuthenticatedUser | null {
  const row = get<UserRow>(
    `SELECT id, email, role, status, first_name, last_name, display_name, avatar_url,
            email_verified_at, language, city, country, home_church_id
     FROM users
     WHERE id = ? AND deleted_at IS NULL`,
    [id],
  );
  return row ? toAuthUser(row) : null;
}

/**
 * Populates `req.auth` when a valid token is present but never rejects, so
 * guest requests still get personalised payloads (favourite flags, distances).
 */
export const optionalAuth: RequestHandler = (req, _res, next) => {
  const token = readToken(req);
  if (!token) return next();
  try {
    const claims = verifyAccessToken(token);
    const user = loadUserById(claims.sub);
    if (user) req.auth = user;
  } catch {
    // An invalid token simply means "anonymous" for optional auth.
  }
  return next();
};

/** Rejects the request unless a valid access token is present. */
export const requireAuth: RequestHandler = (req, _res, next) => {
  const token = readToken(req);
  if (!token) return next(unauthorized());
  try {
    const claims = verifyAccessToken(token);
    const user = loadUserById(claims.sub);
    if (!user) return next(unauthorized("Account no longer exists"));
    if (user.status === "suspended") return next(forbidden("This account has been suspended"));
    req.auth = user;
    return next();
  } catch (error) {
    return next(error);
  }
};

const ROLE_RANK: Record<UserRole, number> = {
  member: 0,
  moderator: 1,
  editor: 2,
  admin: 3,
};

/** Requires the caller to hold at least `minimum`. */
export function requireRole(minimum: UserRole): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) return next(unauthorized());
    if (ROLE_RANK[req.auth.role] < ROLE_RANK[minimum]) {
      return next(forbidden(`This action requires the ${minimum} role or higher`));
    }
    return next();
  };
}

export const requireModerator = requireRole("moderator");
export const requireEditor = requireRole("editor");
export const requireAdmin = requireRole("admin");

/** Requires one of the given roles exactly. */
export function requireAnyRole(...roles: UserRole[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) return next(unauthorized());
    if (!roles.includes(req.auth.role)) return next(forbidden(`This action requires one of: ${roles.join(", ")}`));
    return next();
  };
}

/** Narrows `req.auth` for handlers mounted behind `requireAuth`. */
export function currentUser(req: Parameters<RequestHandler>[0]): AuthenticatedUser {
  if (!req.auth) throw unauthorized();
  return req.auth;
}

/** User id of the caller, or `null` for guests. */
export function currentUserId(req: Parameters<RequestHandler>[0]): string | null {
  return req.auth?.id ?? null;
}
