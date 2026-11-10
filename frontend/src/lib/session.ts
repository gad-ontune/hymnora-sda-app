/**
 * The account, from the browser's side.
 *
 * This exists because `POST /api/push/subscriptions` and `PATCH /api/preferences`
 * both require a signed-in caller, and without this file there is no way to ever
 * register a device or save a reminder time — the Reminders modal would be a
 * pretty form that 401s.
 *
 * The server also sets an httpOnly cookie, which would be the better long-term
 * design, but the API and the app run on different ports in development and a
 * cross-site cookie is only sent with `credentials: "include"` plus a matching
 * CORS origin. The access token returned in the sign-in response is used instead:
 * it needs no server change, and the refresh token is kept alongside it so a
 * session survives a page reload.
 *
 * A localStorage token is readable by any script on the origin, so the blast
 * radius of an XSS is a stolen session rather than a stolen password. That is
 * the trade for shipping reminders now; the httpOnly cookie should replace it.
 *
 * Deliberately not a client module: the reels page server-renders its first
 * page of feed, and that fetch goes through `authedFetch` like every other
 * read. On the server `accessToken()` answers null and the request simply goes
 * out unauthenticated, which is why the client refetches for the viewer's own
 * likes and follows once it knows there is a session.
 */

const ACCESS_KEY = "hymnora.access";
const REFRESH_KEY = "hymnora.refresh";

export type SessionUser = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  displayName: string;
  emailVerified: boolean;
  /** Everything else the API sends, narrowed to what the UI reads. */
  role?: "member" | "admin" | "moderator" | string;
  avatarUrl?: string | null;
  bio?: string | null;
  homeChurchName?: string | null;
  homeChurchId?: string | null;
  city?: string | null;
  country?: string | null;
  language?: string | null;
  lastLoginAt?: string | null;
  createdAt?: string | null;
};

type Tokens = { accessToken: string; refreshToken: string; expiresAt: string };

function read(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    // Safari in private mode, and any browser with storage blocked.
    return null;
  }
}

function write(key: string, value: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* Nothing useful to do; the session simply will not persist. */
  }
}

export function accessToken(): string | null {
  return read(ACCESS_KEY);
}

export function hasSession(): boolean {
  return accessToken() !== null;
}

function storeTokens(tokens: Partial<Tokens> | undefined): void {
  if (tokens?.accessToken) write(ACCESS_KEY, tokens.accessToken);
  if (tokens?.refreshToken) write(REFRESH_KEY, tokens.refreshToken);
}

export function clearSession(): void {
  write(ACCESS_KEY, null);
  write(REFRESH_KEY, null);
}

/** The API origin, from the same env var the rest of the fetchers use. */
export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const BASE = API_BASE;

/**
 * `fetch` with the access token attached, and one silent refresh on 401.
 *
 * The refresh is the part worth being careful about: a modal that opens, gets a
 * 401 because the access token expired an hour ago, and silently shows nothing
 * looks like the server being broken. So exactly one refresh is attempted, and
 * only for a 401 — a 403 or a 500 is the server's answer and is passed through.
 */
export async function authedFetch(
  path: string,
  init: RequestInit = {},
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  const send = () =>
    fetcher(path.startsWith("http") ? path : `${BASE}${path}`, {
      ...init,
      credentials: "include",
      headers: {
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(init.headers ?? {}),
        ...(accessToken() ? { Authorization: `Bearer ${accessToken()}` } : {}),
      },
    });

  const first = await send();
  if (first.status !== 401) return first;

  const refreshed = await refresh(fetcher);
  if (!refreshed) return first;
  return send();
}

let refreshing: Promise<boolean> | null = null;

async function refresh(fetcher: typeof fetch): Promise<boolean> {
  // Concurrent 401s must not each burn the single-use refresh token.
  if (!refreshing) {
    refreshing = (async () => {
      const token = read(REFRESH_KEY);
      if (!token) return false;
      try {
        const res = await fetcher(`${BASE}/api/auth/refresh`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken: token }),
        });
        if (!res.ok) {
          clearSession();
          return false;
        }
        storeTokens(await res.json());
        return true;
      } catch {
        // Offline. Keep the session; a stale token is better than a logged-out
        // user whose next tap re-prompts for a password.
        return false;
      }
    })().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

export type AuthResult = { ok: true; user: SessionUser } | { ok: false; error: string };

/** `POST /api/auth/login`. */
export async function login(email: string, password: string, fetcher: typeof fetch = fetch): Promise<AuthResult> {
  try {
    const res = await fetcher(`${BASE}/api/auth/login`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: body?.error?.message ?? "Could not sign in." };
    storeTokens(body.tokens);
    return { ok: true, user: body.user };
  } catch {
    return { ok: false, error: "Could not reach the server." };
  }
}

export type RegisterResult =
  | { ok: true; user: SessionUser; verificationToken: string | null }
  | { ok: false; error: string };

/** `POST /api/auth/register`. */
export async function register(
  input: { email: string; password: string; firstName: string; lastName: string; newsletter: boolean },
  fetcher: typeof fetch = fetch,
): Promise<RegisterResult> {
  try {
    const res = await fetcher(`${BASE}/api/auth/register`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: body?.error?.message ?? "Could not create the account." };
    storeTokens(body.tokens);
    // Non-production only, and only because there is no mail transport locally.
    return { ok: true, user: body.user, verificationToken: body.verificationToken ?? null };
  } catch {
    return { ok: false, error: "Could not reach the server." };
  }
}

export async function logout(fetcher: typeof fetch = fetch): Promise<void> {
  const token = accessToken();
  try {
    if (token) {
      await fetcher(`${BASE}/api/auth/logout`, { method: "POST", credentials: "include", headers: { Authorization: `Bearer ${token}` } });
    }
  } catch {
    /* The local session is cleared regardless; a failed call must not strand it. */
  }
  clearSession();
}

/** `GET /api/auth/me`, or `null` when signed out. */
export async function me(fetcher: typeof fetch = fetch): Promise<SessionUser | null> {
  const res = await authedFetch("/api/auth/me", {}, fetcher);
  if (!res.ok) return null;
  const body = await res.json().catch(() => null);
  return body?.user ?? null;
}
