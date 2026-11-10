/**
 * The signed-in account, as app-wide state.
 *
 * `session.ts` owns the tokens; this owns the *answer to "who is this?"* for
 * every component at once. The top bar, the sidebar account card, settings, the
 * reminders modal and the player all need the same answer, and none of them
 * should be the one that decides it — so it lives in a tiny external store that
 * React subscribes to with `useSyncExternalStore`.
 *
 * The snapshot rule is the whole reason the mechanics live in
 * `session-external-store.ts`: state is replaced and never mutated, so two
 * consecutive reads hand back the same reference and React does not re-render.
 */

"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { createExternalStore } from "./session-external-store";
import {
  authedFetch,
  clearSession,
  hasSession,
  login as apiLogin,
  logout as apiLogout,
  register as apiRegister,
  type SessionUser,
} from "./session";

export type SessionStatus = "unknown" | "signed-out" | "signed-in";

/** The preferences row the API returns, narrowed to what the UI actually reads. */
// Re-exported so the UI can name the account type without importing the token
// module directly; the tokens are an implementation detail of this store.
export type { SessionUser };

export type SessionPreferences = {
  language?: string;
  theme?: "light" | "warm" | "dark" | "system";
  autoplay?: boolean;
  crossfade?: boolean;
  dataSaver?: boolean;
  captions?: boolean;
  bedroomMode?: boolean;
  remindersEnabled?: boolean;
  notifyDailyVerse?: boolean;
  dailyVerseTime?: string;
  [key: string]: unknown;
};

export type DeviceSession = {
  id: string;
  user_agent?: string | null;
  ip_address?: string | null;
  created_at?: string | null;
  expires_at?: string | null;
};

export type SessionState = {
  status: SessionStatus;
  user: SessionUser | null;
  preferences: SessionPreferences | null;
  sessions: DeviceSession[];
  /** True while a sign-in, sign-up or refresh is in flight. */
  busy: boolean;
};

/**
 * The snapshot a server render and the hydration pass must both agree on. A
 * server render has no localStorage, so it cannot claim a session.
 */
const INITIAL: SessionState = { status: "unknown", user: null, preferences: null, sessions: [], busy: false };

/** The answer once we know there is no account. */
export const SIGNED_OUT: SessionState = {
  status: "signed-out",
  user: null,
  preferences: null,
  sessions: [],
  busy: false,
};

const store = createExternalStore<SessionState>(INITIAL);

function set(next: Partial<SessionState>): void {
  store.set({ ...store.get(), ...next });
}

export function subscribeToSession(listener: () => void): () => void {
  return store.subscribe(listener);
}

export function getSessionSnapshot(): SessionState {
  return store.get();
}

function getServerSnapshot(): SessionState {
  return INITIAL;
}

/**
 * Replaces the whole answer in one shot. Exported for tests, which have no
 * localStorage and therefore cannot get themselves "signed in" the real way.
 */
export function setSessionForTesting(next: SessionState): void {
  store.set(next);
}

type MeResponse = { user?: SessionUser; preferences?: SessionPreferences; sessions?: DeviceSession[] };

/**
 * One `GET /api/auth/me` at a time, however many components asked for it.
 *
 * The top bar, the sidebar card and the settings page all resolve the session on
 * mount, so without this a page load would fire the same request three times and
 * then race three identical answers into the store.
 */
let inFlight: Promise<SessionState> | null = null;

/** `GET /api/auth/me`. Sets the answer from whatever the server reports. */
export function loadSession(): Promise<SessionState> {
  if (inFlight) return inFlight;
  inFlight = fetchSession().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function fetchSession(): Promise<SessionState> {
  if (typeof window === "undefined") return store.get();
  if (!hasSession()) {
    set(SIGNED_OUT);
    return store.get();
  }
  try {
    const res = await authedFetch("/api/auth/me");
    if (!res.ok) {
      // The refresh inside authedFetch already tried once. A second failure is
      // a dead session, and pretending otherwise strands the UI on a spinner.
      if (res.status === 401) {
        clearSession();
        set(SIGNED_OUT);
      }
      return store.get();
    }
    const body = (await res.json().catch(() => null)) as MeResponse | null;
    if (!body?.user) {
      set(SIGNED_OUT);
      return store.get();
    }
    set({
      status: "signed-in",
      user: body.user,
      preferences: body.preferences ?? store.get().preferences,
      sessions: body.sessions ?? store.get().sessions,
      busy: false,
    });
  } catch {
    // Offline. Keep whatever we already believe; a stale account is better than
    // signing somebody out because a lift went into a tunnel.
    if (store.get().status === "unknown") set({ status: hasSession() ? "signed-in" : "signed-out", user: store.get().user });
  }
  return store.get();
}

export type SignInResult = { ok: true; user: SessionUser } | { ok: false; error: string };

/** `POST /api/auth/login`, then adopt the account it returns. */
export async function signIn(email: string, password: string): Promise<SignInResult> {
  set({ busy: true });
  const result = await apiLogin(email.trim(), password);
  if (!result.ok) {
    set({ busy: false });
    return result;
  }
  set({ status: "signed-in", user: result.user, busy: true });
  await loadSession();
  set({ busy: false });
  return result;
}

export type SignUpInput = {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  newsletter: boolean;
};

export type SignUpResult =
  | { ok: true; user: SessionUser; verificationToken: string | null }
  | { ok: false; error: string };

/** `POST /api/auth/register`, then adopt the account it returns. */
export async function signUp(input: SignUpInput): Promise<SignUpResult> {
  set({ busy: true });
  const result = await apiRegister({
    email: input.email.trim(),
    password: input.password,
    firstName: input.firstName.trim(),
    lastName: input.lastName.trim(),
    newsletter: input.newsletter,
  });
  if (!result.ok) {
    set({ busy: false });
    return result;
  }
  set({ status: "signed-in", user: result.user, busy: true });
  await loadSession();
  set({ busy: false });
  return { ok: true, user: result.user, verificationToken: result.verificationToken };
}

/** `POST /api/auth/logout`, then forget the account. */
export async function signOut(): Promise<void> {
  await apiLogout();
  set(SIGNED_OUT);
}

/** `POST /api/auth/logout-all` — every device, including this one. */
export async function signOutEverywhere(): Promise<{ ok: boolean }> {
  try {
    await authedFetch("/api/auth/logout-all", { method: "POST" });
  } catch {
    /* The local session goes regardless; the server call is best effort. */
  }
  clearSession();
  set(SIGNED_OUT);
  return { ok: true };
}

export async function updatePreferences(patch: Partial<SessionPreferences>): Promise<SessionPreferences | null> {
  try {
    const res = await authedFetch("/api/auth/preferences", {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as SessionPreferences | null;
    if (body) set({ preferences: { ...store.get().preferences, ...body } });
    return body;
  } catch {
    return null;
  }
}

export async function listSessions(): Promise<DeviceSession[]> {
  try {
    const res = await authedFetch("/api/auth/sessions");
    if (!res.ok) return store.get().sessions;
    const body = (await res.json().catch(() => null)) as DeviceSession[] | null;
    if (body) set({ sessions: body });
    return body ?? store.get().sessions;
  } catch {
    return store.get().sessions;
  }
}

export function useSession(): SessionState {
  return useSyncExternalStore(subscribeToSession, getSessionSnapshot, getServerSnapshot);
}

/**
 * `useSession`, plus the one thing the shell has to do: decide whether there is
 * a session to find, and go and look if nobody has yet. Kept in a hook rather
 * than an effect inside the provider so any component can trigger it.
 */
export function useSessionState(): { session: SessionState; ready: boolean; resolve: () => void } {
  const session = useSession();
  const resolve = useCallback(() => {
    if (session.status === "unknown") void loadSession();
  }, [session.status]);

  useEffect(() => {
    if (session.status === "unknown") {
      if (hasSession()) void loadSession();
      // No token means signed out, but we still have to move off "unknown" so
      // the shell stops rendering its "checking your session" state.
      else set(SIGNED_OUT);
    }
  }, [session.status]);

  return { session, ready: session.status !== "unknown", resolve };
}
