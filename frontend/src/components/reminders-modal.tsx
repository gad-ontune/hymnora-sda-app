"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, Bell, BellOff, BookOpen, Check, Loader2, LogOut, Radio, Send, Sunrise, X } from "lucide-react";
import { authedFetch, hasSession, login, register, type SessionUser } from "@/lib/session";
import {
  currentPermission,
  deviceLabel,
  deviceTimezone,
  endpointFingerprint,
  existingSubscription,
  getPushConfig,
  getPushStatus,
  pushBlockedReason,
  registerDevice,
  removeDevice,
  sendTestPush,
  subscribe as pushSubscribe,
  unsubscribe as pushUnsubscribe,
} from "@/lib/push";
import type { PushSubscriptionSummary, ReminderPreferences } from "@/lib/types";

/**
 * Reminders & Settings.
 *
 * Replaces an in-app notifications page, because an in-app inbox is the wrong
 * tool: a reminder that only exists while the tab is open is not a reminder. All
 * of this is device-level Web Push, so the verse lands on the lock screen whether
 * or not Hymnora is running.
 *
 * Three things make this honest rather than decorative, and all three are states
 * this modal has to be able to *name*:
 *
 *   1. Signed out. Every push and preferences endpoint requires a caller, so
 *      there is a real sign-in here rather than a toggle that 401s.
 *   2. Permission denied at the browser. Re-prompting is impossible, so the
 *      switch is disabled with instructions instead of left to fail on tap.
 *   3. A server with no VAPID key pair. Nothing can be delivered, and saying so
 *      beats a green tick that never produces a notification.
 */

type Props = {
  open: boolean;
  onClose: () => void;
  /** Injected so tests and stories need no network. */
  fetcher?: typeof fetch;
};

const DEFAULTS: ReminderPreferences = {
  remindersEnabled: true,
  notifyDailyVerse: true,
  dailyVerseTime: "07:00",
  notifyReadingStreak: true,
  streakReminderTime: "19:30",
  notifyLiveWorship: true,
  liveAlertLeadMinutes: 15,
  notifyNewHymns: false,
  readingStreak: { current: 0, best: 0, lastDay: null },
};

type Notice = { tone: "ok" | "error"; text: string };

export function RemindersModal({ open, onClose, fetcher }: Props) {
  const doFetch = fetcher ?? fetch;
  const [user, setUser] = useState<SessionUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [prefs, setPrefs] = useState<ReminderPreferences>(DEFAULTS);
  const [devices, setDevices] = useState<PushSubscriptionSummary[]>([]);
  const [serverConfigured, setServerConfigured] = useState(true);
  const [blockedReason, setBlockedReason] = useState<"no-push-manager" | "insecure-context" | null>(null);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported" | "unknown">("unknown");
  const [thisDeviceId, setThisDeviceId] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "enable" | "disable" | "test">(null);
  const [message, setMessage] = useState<Notice | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  /**
   * Finds which device row is *this* browser.
   *
   * The browser can only identify itself by its endpoint, and the server
   * deliberately does not hand endpoints back, so both sides hash to the same
   * short fingerprint. A miss is not an error: it means this browser is signed in
   * but is not the device holding the subscription.
   */
  const matchThisDevice = useCallback(async (list: PushSubscriptionSummary[]) => {
    try {
      const subscription = await existingSubscription();
      if (!subscription) {
        setThisDeviceId(null);
        return;
      }
      const mine = await endpointFingerprint(subscription);
      setThisDeviceId(list.find((device) => device.endpointFingerprint === mine)?.id ?? null);
    } catch {
      setThisDeviceId(null);
    }
  }, []);

  const load = useCallback(async () => {
    // `authChecked` is the only loading flag, and the first statement here is an
    // await. A load kicked off from an effect that set state synchronously would
    // force a second render before anything had been fetched.
    try {
      const configRes = await doFetch(`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"}/api/push/config`);
      const config = configRes.ok ? await configRes.json() : { configured: false };
      // Capability is a browser fact and does not change between loads, so it is
      // read here rather than in the effect.
      setBlockedReason(pushBlockedReason());
      setServerConfigured(Boolean(config.configured));
      if (!config.configured) {
        setMessage({ tone: "error", text: "Reminders are not configured on this server yet." });
      }

      if (!hasSession()) {
        setUser(null);
        setAuthChecked(true);
        return;
      }

      const [meRes, prefsRes, statusRes] = await Promise.all([
        authedFetch("/api/auth/me", {}, doFetch),
        authedFetch("/api/preferences", {}, doFetch),
        getPushStatus(doFetch).catch(() => null),
      ]);

      if (meRes.status === 401) {
        setUser(null);
        setAuthChecked(true);
        return;
      }
      if (meRes.ok) setUser((await meRes.json()).user);
      if (prefsRes.ok) setPrefs({ ...DEFAULTS, ...(await prefsRes.json()) });
      if (statusRes) {
        setDevices(statusRes.devices);
        await matchThisDevice(statusRes.devices);
      }
    } catch {
      setMessage({ tone: "error", text: "Could not reach the server." });
    } finally {
      setAuthChecked(true);
    }
  }, [doFetch, matchThisDevice]);

  useEffect(() => {
    if (!open) return;
    // Fetching on open is a data load, not a derived-state update: the first
    // render already shows "Checking…", and `load` awaits before it sets
    // anything, so there is no synchronous state change to cascade from.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    closeRef.current?.focus();
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  const save = useCallback(
    async (next: Partial<ReminderPreferences>) => {
      setPrefs((current) => ({ ...current, ...next }));
      try {
        const res = await authedFetch(
          "/api/preferences",
          { method: "PATCH", body: JSON.stringify(next) },
          doFetch,
        );
        if (!res.ok) throw new Error(`save failed: ${res.status}`);
        // The server is the source of truth; echo it back so a value it clamped
        // is the one the user ends up looking at.
        const saved = await res.json();
        setPrefs((current) => ({ ...current, ...saved }));
      } catch {
        setMessage({ tone: "error", text: "Could not save that change." });
        void load();
      }
    },
    [doFetch, load],
  );

  const enable = useCallback(async () => {
    setBusy("enable");
    setMessage(null);
    try {
      const config = await getPushConfig(doFetch);
      if (!config.configured || !config.publicKey) {
        setMessage({ tone: "error", text: "Reminders are not configured on this server yet." });
        return;
      }
      // Subscribe first: if the browser refuses, the server is never told about
      // a subscription that does not exist. The reverse order would leave rows
      // the server keeps trying to deliver to.
      await registerDevice(await pushSubscribe(config.publicKey), doFetch);
      setPermission(await currentPermission());
      setMessage({ tone: "ok", text: "Reminders are on for this device." });
      await save({ remindersEnabled: true });
      void load();
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Could not turn reminders on." });
    } finally {
      setBusy(null);
    }
  }, [doFetch, save, load]);

  const disable = useCallback(async () => {
    setBusy("disable");
    setMessage(null);
    try {
      // Server first, while the endpoint is still known to it; the reverse order
      // leaves a row that keeps failing until it finally 410s.
      if (thisDeviceId) await removeDevice(thisDeviceId, doFetch);
      await pushUnsubscribe();
      setThisDeviceId(null);
      setPermission(await currentPermission());
      setMessage({ tone: "ok", text: "Reminders are off for this device." });
      void load();
    } catch {
      setMessage({ tone: "error", text: "Could not turn reminders off." });
    } finally {
      setBusy(null);
    }
  }, [doFetch, thisDeviceId, load]);

  const sendTest = useCallback(async () => {
    setBusy("test");
    setMessage(null);
    try {
      const body = await sendTestPush(doFetch);
      if (body.sent > 0) setMessage({ tone: "ok", text: "Sent. It should arrive in a moment." });
      else if (body.failed > 0) setMessage({ tone: "error", text: "The server could not reach this device." });
      else setMessage({ tone: "error", text: "No device is registered for reminders." });
    } catch {
      setMessage({ tone: "error", text: "Could not send a test." });
    } finally {
      setBusy(null);
    }
  }, [doFetch]);

  if (!open) return null;

  const blocked = blockedReason !== null || permission === "unsupported";
  const denied = permission === "denied";
  // "On" has to mean the *server* has this browser's subscription, not just that
  // the browser holds one — a permission without a registered endpoint delivers
  // nothing and would show as a working reminder.
  const on = prefs.remindersEnabled && !blocked && !denied && thisDeviceId !== null;

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label="Reminders and settings">
      <div className="absolute inset-0 bg-ink-fill/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex max-h-[92vh] w-full max-w-[560px] flex-col overflow-hidden rounded-t-3xl border border-line bg-surface shadow-2xl sm:rounded-3xl">
        <header className="flex items-start justify-between gap-4 border-b border-line px-6 py-5">
          <div className="flex items-start gap-3.5">
            <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-sage-soft text-sage">
              <Bell size={20} />
            </span>
            <div>
              <h2 className="font-display text-[21px] font-semibold tracking-[-0.01em]">Reminders &amp; settings</h2>
              <p className="mt-0.5 text-[13px] text-ink-muted">
                Delivered to this device, so they arrive whether or not Hymnora is open.
              </p>
            </div>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="grid size-9 shrink-0 place-items-center rounded-xl text-ink-muted transition hover:bg-surface-soft hover:text-ink"
            aria-label="Close"
          >
            <X size={19} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {!authChecked ? (
            <p className="py-6 text-center text-sm text-ink-muted">Checking…</p>
          ) : !user ? (
            <SignInGate
              fetcher={doFetch}
              configured={serverConfigured}
              message={message}
              setMessage={setMessage}
              onSignedIn={load}
            />
          ) : (
            <div className="space-y-6">
              <section>
                <div className="flex items-center justify-between gap-4 rounded-2xl border border-line bg-canvas px-4 py-4">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">
                      {blocked
                        ? "Not available here"
                        : denied
                          ? "Blocked by your browser"
                          : on
                            ? deviceLabel()
                            : "Reminders on this device"}
                    </p>
                    <p className="mt-0.5 text-[12.5px] leading-5 text-ink-muted">
                      {blocked
                        ? blockedReason === "insecure-context"
                          ? "Reminders need a secure connection. Open Hymnora over HTTPS to turn them on."
                          : "This browser cannot deliver notifications, so reminders are unavailable here."
                        : denied
                          ? "This site is blocked from showing notifications. Re-allow it in your browser's site settings, then reopen this."
                          : on
                            ? `Signed in as ${user.email}`
                            : serverConfigured
                              ? "Turn them on to get the daily verse, your reading streak and live worship alerts."
                              : "This server has no push keys configured, so nothing can be delivered yet."}
                    </p>
                  </div>
                  {blocked || denied || !serverConfigured ? (
                    <span className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-soft text-ink-muted">
                      <BellOff size={17} />
                    </span>
                  ) : on ? (
                    <button
                      type="button"
                      onClick={disable}
                      disabled={busy !== null}
                      className="grid size-9 shrink-0 place-items-center rounded-full bg-sage text-white transition hover:bg-sage/90 disabled:opacity-60"
                      aria-label="Turn reminders off"
                    >
                      {busy === "disable" ? <Loader2 size={17} className="animate-spin" /> : <Check size={17} />}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={enable}
                      disabled={busy !== null}
                      className="shrink-0 rounded-full bg-sage px-4 py-2 text-[13px] font-semibold text-white transition hover:bg-sage/90 disabled:opacity-60"
                    >
                      {busy === "enable" ? "Enabling…" : "Turn on"}
                    </button>
                  )}
                </div>

                {on ? (
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={sendTest}
                      disabled={busy !== null}
                      className="inline-flex items-center gap-2 rounded-xl border border-line px-3.5 py-2 text-[13px] font-semibold text-ink-soft transition hover:bg-canvas disabled:opacity-60"
                    >
                      {busy === "test" ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                      Send me a test
                    </button>
                    {devices.length > 1 ? (
                      <span className="text-[12px] text-ink-muted">
                        {devices.length} devices get these reminders
                      </span>
                    ) : null}
                  </div>
                ) : null}

                {message ? <NoticeBanner message={message} /> : null}
              </section>

              <div className="divide-y divide-line/80 border-t border-line">
                <ReminderRow
                  icon={<Sunrise size={18} />}
                  title="Daily verse"
                  description="One verse, in the morning."
                  enabled={prefs.notifyDailyVerse}
                  disabled={!on}
                  onToggle={(next) => void save({ notifyDailyVerse: next })}
                >
                  {prefs.notifyDailyVerse ? (
                    <TimeField
                      value={prefs.dailyVerseTime}
                      onChange={(dailyVerseTime) => void save({ dailyVerseTime })}
                      label="Daily verse time"
                    />
                  ) : null}
                </ReminderRow>

                <ReminderRow
                  icon={<BookOpen size={18} />}
                  title="Reading streak"
                  description={
                    prefs.readingStreak.current > 0
                      ? `You are on ${prefs.readingStreak.current} day${prefs.readingStreak.current === 1 ? "" : "s"} · best ${prefs.readingStreak.best}`
                      : "A nudge if a day goes unread."
                  }
                  enabled={prefs.notifyReadingStreak}
                  disabled={!on}
                  onToggle={(next) => void save({ notifyReadingStreak: next })}
                >
                  {prefs.notifyReadingStreak ? (
                    <TimeField
                      value={prefs.streakReminderTime}
                      onChange={(streakReminderTime) => void save({ streakReminderTime })}
                      label="Streak reminder time"
                    />
                  ) : null}
                </ReminderRow>

                <ReminderRow
                  icon={<Radio size={18} />}
                  title="Live worship"
                  description="When a church you follow goes live."
                  enabled={prefs.notifyLiveWorship}
                  disabled={!on}
                  onToggle={(next) => void save({ notifyLiveWorship: next })}
                >
                  {prefs.notifyLiveWorship ? (
                    <SelectField
                      value={String(prefs.liveAlertLeadMinutes)}
                      label="Alert me"
                      options={[
                        { value: "0", label: "When it starts" },
                        { value: "15", label: "15 minutes before" },
                        { value: "30", label: "30 minutes before" },
                        { value: "60", label: "1 hour before" },
                      ]}
                      onChange={(value) => void save({ liveAlertLeadMinutes: Number(value) })}
                    />
                  ) : null}
                </ReminderRow>

                <ReminderRow
                  icon={<Bell size={18} />}
                  title="New hymns and music"
                  description="When something new is added to the library."
                  enabled={prefs.notifyNewHymns}
                  disabled={!on}
                  onToggle={(next) => void save({ notifyNewHymns: next })}
                />
              </div>

              <div className="flex items-center justify-between gap-4 border-t border-line pt-4">
                <p className="text-[12px] leading-5 text-ink-muted">
                  Times are {deviceTimezone().replace(/_/g, " ")}. Reminders go to your devices only.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    void import("@/lib/session").then((module) => module.logout(doFetch));
                    setUser(null);
                    setThisDeviceId(null);
                  }}
                  className="inline-flex shrink-0 items-center gap-1.5 text-[12.5px] font-semibold text-ink-muted transition hover:text-terracotta"
                >
                  <LogOut size={14} />
                  Sign out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function NoticeBanner({ message }: { message: Notice }) {
  return (
    <p
      role="status"
      className={`mt-3 flex items-start gap-2 rounded-xl px-3.5 py-2.5 text-[12.5px] leading-5 ${
        message.tone === "ok" ? "bg-sage-soft text-sage" : "bg-terracotta-soft text-terracotta"
      }`}
    >
      {message.tone === "ok" ? (
        <Check size={15} className="mt-px shrink-0" />
      ) : (
        <AlertCircle size={15} className="mt-px shrink-0" />
      )}
      {message.text}
    </p>
  );
}

/**
 * Sign-in, inline.
 *
 * A reminder preference belongs to an account, because a subscription outlives a
 * session: it has to still be deliverable after the browser is closed. Asking for
 * the password before the user has seen what reminders are is also backwards, so
 * this appears only once they have opened Reminders.
 */
function SignInGate({
  fetcher,
  configured,
  message,
  setMessage,
  onSignedIn,
}: {
  fetcher: typeof fetch;
  configured: boolean;
  message: Notice | null;
  setMessage: (next: Notice | null) => void;
  onSignedIn: () => void | Promise<void>;
}) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result =
      mode === "login"
        ? await login(email.trim(), password, fetcher)
        : await register(
            { email: email.trim(), password, firstName: firstName.trim(), lastName: lastName.trim(), newsletter: false },
            fetcher,
          );
    setBusy(false);
    if (result.ok) {
      setMessage({ tone: "ok", text: `Signed in as ${result.user.email}.` });
      await onSignedIn();
      return;
    }
    setError(result.error);
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="rounded-2xl border border-line bg-canvas px-4 py-4 text-[13px] leading-5 text-ink-soft">
        Reminders are tied to your account, so they keep arriving after you close the app. Sign in to set them up.{" "}
        <Link href="/signin" className="font-semibold text-ink underline decoration-gold/60 underline-offset-4">
          Open the full sign-in page
        </Link>{" "}
        if you have forgotten your password.
        {!configured ? (
          <p className="mt-2 text-terracotta">This server has no push keys yet, so delivery is not possible here.</p>
        ) : null}
      </div>

      <div className="flex gap-1 rounded-xl bg-canvas p-1">
        {(["login", "register"] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => {
              setMode(value);
              setError(null);
            }}
            className={`flex-1 rounded-lg px-3 py-2 text-[13px] font-semibold transition ${
              mode === value ? "bg-surface text-ink shadow-sm" : "text-ink-muted hover:text-ink"
            }`}
          >
            {value === "login" ? "Sign in" : "Create account"}
          </button>
        ))}
      </div>

      {mode === "register" ? (
        <div className="grid grid-cols-2 gap-3">
          <Field label="First name" value={firstName} onChange={setFirstName} autoComplete="given-name" required />
          <Field label="Last name" value={lastName} onChange={setLastName} autoComplete="family-name" required />
        </div>
      ) : null}

      <Field label="Email" value={email} onChange={setEmail} type="email" autoComplete="email" required />
      <Field label="Password" value={password} onChange={setPassword} type="password" required minLength={8}
        autoComplete={mode === "login" ? "current-password" : "new-password"}
        hint={mode === "register" ? "At least 8 characters." : undefined} />

      {error ? <p role="alert" className="text-[12.5px] text-terracotta">{error}</p> : null}
      {message ? <NoticeBanner message={message} /> : null}

      <button
        type="submit"
        disabled={busy || !email || !password || (mode === "register" && (!firstName || !lastName))}
        className="w-full rounded-xl bg-sage px-4 py-3 text-sm font-semibold text-white transition hover:bg-sage/90 disabled:opacity-50"
      >
        {busy ? "Just a moment…" : mode === "login" ? "Sign in" : "Create account"}
      </button>
    </form>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  required,
  autoComplete,
  minLength,
  hint,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  type?: string;
  required?: boolean;
  autoComplete?: string;
  minLength?: number;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12.5px] font-semibold text-ink-soft">{label}</span>
      <input
        type={type}
        value={value}
        required={required}
        minLength={minLength}
        autoComplete={autoComplete}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-xl border border-line bg-canvas px-3.5 py-2.5 text-sm outline-none transition focus:border-gold/70"
      />
      {hint ? <span className="mt-1 block text-[11.5px] text-ink-muted">{hint}</span> : null}
    </label>
  );
}

function ReminderRow({
  icon,
  title,
  description,
  enabled,
  disabled,
  onToggle,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  enabled: boolean;
  disabled: boolean;
  onToggle: (next: boolean) => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="py-4">
      <label className="flex items-center gap-3.5">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-surface-soft text-ink-soft">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">{title}</span>
          <span className="mt-0.5 block text-[12.5px] leading-5 text-ink-muted">{description}</span>
        </span>
        <input
          type="checkbox"
          checked={enabled}
          disabled={disabled}
          onChange={(event) => onToggle(event.target.checked)}
          className="size-5 shrink-0 accent-sage disabled:opacity-40"
          aria-label={title}
        />
      </label>
      {enabled && children ? <div className="mt-3 pl-[50px]">{children}</div> : null}
    </div>
  );
}

function TimeField({ value, onChange, label }: { value: string; onChange: (next: string) => void; label: string }) {
  return (
    <label className="flex items-center gap-2 text-[13px] text-ink-soft">
      <span>{label}</span>
      <input
        type="time"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-[13px] outline-none focus:border-gold/70"
      />
    </label>
  );
}

function SelectField({
  value,
  onChange,
  options,
  label,
}: {
  value: string;
  onChange: (next: string) => void;
  options: { value: string; label: string }[];
  label: string;
}) {
  return (
    <label className="flex items-center gap-2 text-[13px] text-ink-soft">
      <span>{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-[13px] outline-none focus:border-gold/70"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
