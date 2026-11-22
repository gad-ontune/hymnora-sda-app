"use client";

import Link from "next/link";
import { Bell, BookOpen, Check, ChevronRight, FileText, Globe2, KeyRound, Landmark, Leaf, LockKeyhole, LogOut, MonitorSmartphone, Moon, MoonStar, Palette, ShieldCheck, Sparkles, Sun, Sunset } from "lucide-react";
import { useState, useEffect } from "react";
import { PageIntro } from "@/components/page-intro";
import { RemindersModal } from "@/components/reminders-modal";
import { authedFetch } from "@/lib/session";
import { initials as initialsOf } from "@/lib/format";
import { listSessions, signOut, signOutEverywhere, updatePreferences, useSessionState, type DeviceSession, type SessionPreferences, type SessionUser } from "@/lib/session-store";
import { LANGUAGES, useI18n, useTheme, type ThemeChoice } from "@/lib/i18n";

const themes = [
  { labelKey: "settings.themeCanvas", value: "light", icon: Sun },
  { labelKey: "settings.themeWarm", value: "warm", icon: BookOpen },
  { labelKey: "settings.themeSanctuary", value: "sanctuary", icon: Landmark },
  { labelKey: "settings.themeGarden", value: "garden", icon: Leaf },
  { labelKey: "settings.themeSunset", value: "sunset", icon: Sunset },
  { labelKey: "settings.themeDusk", value: "dark", icon: Moon },
  { labelKey: "settings.themeMidnight", value: "midnight", icon: MoonStar },
  { labelKey: "settings.themeSystem", value: "system", icon: MonitorSmartphone },
] as const;

type Update = {
  id?: string;
  title?: string;
  name?: string;
  summary?: string;
  description?: string;
  body?: string;
  category?: string;
  kind?: string;
};

const BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

/**
 * Settings reads the account, it does not go and ask for it.
 *
 * It used to fetch `/api/auth/me` itself, which meant a second, parallel answer
 * to "who is signed in" that could disagree with the one in the top bar — the
 * page would show a name while the avatar showed a different account. Now the
 * signed-in answer comes from the one store, and this component is remounted on
 * the account changing (`key` below) so its `useState` initialisers read a real
 * profile rather than an empty one waiting for an effect to fill it in.
 */
export function SettingsExperience() {
  const { session } = useSessionState();
  return <SettingsBody key={`${session.status}:${session.user?.id ?? "guest"}`} user={session.user} preferences={session.preferences} />;
}

function SettingsBody({ user, preferences }: { user: SessionUser | null; preferences: SessionPreferences | null }) {
  const { language, setLanguage, t } = useI18n();
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [saved, setSaved] = useState(false);
  const [remindersOpen, setRemindersOpen] = useState(false);
  const [profile, setProfile] = useState({
    firstName: user?.firstName ?? "",
    lastName: user?.lastName ?? "",
    homeChurch: user?.homeChurchName ?? "",
    email: user?.email ?? "",
  });
  const [updates, setUpdates] = useState<Update[]>([]);
  const [toggles, setToggles] = useState({
    autoplay: preferences?.autoplay ?? true,
    captions: preferences?.captions ?? false,
    dataSaver: preferences?.dataSaver ?? false,
    bedroomMode: preferences?.bedroomMode ?? false,
  });

  useEffect(() => {
    fetch(`${BASE}/api/news`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { items?: Update[] } | Update[] | null) => setUpdates(Array.isArray(d) ? d : d?.items || []));
  }, []);

  function persist(patch: Record<string, unknown>) {
    // `updatePreferences` goes through authedFetch (Bearer token + refresh) and
    // drops the answer into the session store, so the top bar, the rail and this
    // page agree the moment the server answers. Signed out, it is a quiet no-op:
    // the provider has already applied the choice to this browser and
    // localStorage, which is all a guest can expect.
    void updatePreferences(patch).then((savedPrefs) => {
      if (savedPrefs) {
        setSaved(true);
        window.setTimeout(() => setSaved(false), 1800);
      }
    });
  }

  function toggle(name: "autoplay" | "captions" | "dataSaver" | "bedroomMode") {
    setToggles((current) => {
      const next = { ...current, [name]: !current[name] };
      persist({ [name]: next[name] });
      return next;
    });
  }

  const displayName = profile.firstName
    ? `${profile.firstName}${profile.lastName ? ` ${profile.lastName}` : ""}`
    : user?.displayName || "Guest";
  const initials = initialsOf(displayName === "Guest" ? null : displayName, profile.email || null) || "G";

  return (
    <div className="fade-up mx-auto max-w-[1080px]">
      <PageIntro
        eyebrow={t("group.yourSpace")}
        title="Make Hymnora feel like yours."
        description="Language, reading atmosphere and the gentle behaviours that help you arrive well—saved to your account, applied everywhere."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-5">
          {/*
            Everything below is a preference *for an account*. Signed out, the
            page says so rather than showing a form that would 401 on save.
          */}
          {user ? null : (
            <section className="flex flex-col items-start gap-4 rounded-[26px] border border-gold/30 bg-gold-soft/35 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-7">
              <div>
                <h2 className="font-display text-[22px] font-semibold tracking-[-0.01em]">Sign in to save these choices</h2>
                <p className="mt-1.5 text-sm leading-6 text-ink-muted">
                  Language, theme and reminders follow your account between devices. Without one they apply to this browser only.
                </p>
              </div>
              <Link
                href="/signin?next=%2Fsettings"
                className="flex h-11 shrink-0 items-center gap-2 rounded-xl bg-ink-fill px-5 text-sm font-semibold text-white transition hover:bg-sage"
              >
                Sign in
                <ChevronRight size={15} />
              </Link>
            </section>
          )}

          {/* Profile */}
          <section className="overflow-hidden rounded-[26px] border border-line bg-surface shadow-soft">
            <div className="flex flex-col gap-5 p-6 sm:flex-row sm:items-center sm:p-7">
              <span className="grid size-16 shrink-0 place-items-center rounded-2xl bg-sage text-2xl font-semibold text-white">{initials}</span>
              <div className="min-w-0">
                <h2 className="font-display text-[26px] font-semibold tracking-[-0.02em]">{displayName}</h2>
                <p className="mt-0.5 text-sm text-ink-muted">{profile.email || "Signed in as a guest — details stay on this device."}</p>
                {profile.homeChurch ? (
                  <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-gold-soft px-3 py-1 text-xs font-semibold text-gold"><BookOpen size={13} /> {profile.homeChurch}</p>
                ) : null}
              </div>
            </div>
            <div className="grid gap-4 border-t border-line/70 bg-canvas/40 p-6 sm:grid-cols-2 sm:p-7">
              <Field label="First name" value={profile.firstName} onChange={(firstName) => setProfile((p) => ({ ...p, firstName }))} />
              <Field label="Last name" value={profile.lastName} onChange={(lastName) => setProfile((p) => ({ ...p, lastName }))} />
              <div className="sm:col-span-2">
                <Field label="Home church" value={profile.homeChurch} onChange={(homeChurch) => setProfile((p) => ({ ...p, homeChurch }))} placeholder="e.g. Nairobi Central SDA" />
              </div>
            </div>
          </section>

          {/* Appearance */}
          <section className="rounded-[26px] border border-line bg-surface p-6 shadow-soft sm:p-7">
            <CardHead icon={Palette} tone="bg-gold-soft text-gold" title={t("settings.appearance")} note="How Hymnora is dressed when you open it." />
            <div className="mt-6">
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-ink-muted">{t("settings.atmosphere")}</p>
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {themes.map((item) => {
                  const Icon = item.icon;
                  const active = theme === item.value;
                  return (
                    <button
                      key={item.value}
                      type="button"
                      aria-pressed={active}
                      data-theme-option={item.value}
                      onClick={() => { setTheme(item.value as ThemeChoice); persist({ theme: item.value }); }}
                      className={`group flex flex-col gap-2 rounded-2xl border p-2 text-left transition ${active ? "border-sage bg-sage-soft/50 ring-2 ring-sage/25" : "border-line bg-surface-soft/40 hover:border-gold/60 hover:bg-surface-soft/70"}`}
                    >
                      <ThemePreview theme={item.value === "system" ? resolvedTheme : item.value} />
                      <span className="flex items-center gap-1.5 px-0.5 pb-0.5">
                        <Icon size={14} className={active ? "text-sage" : "text-ink-muted"} aria-hidden />
                        <span className="truncate text-[12.5px] font-semibold">{t(item.labelKey)}</span>
                        {active ? <span className="ml-auto grid size-5 shrink-0 place-items-center rounded-full bg-sage text-white"><Check size={11} /></span> : null}
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="mt-3 text-xs text-ink-muted">
                Every atmosphere repaints the rail, the header and the cards, not just the page behind them.
              </p>
            </div>
            <div className="mt-6">
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-ink-muted">{t("settings.platformLang")}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {LANGUAGES.map((item) => {
                  const active = language === item;
                  return (
                    <button
                      key={item}
                      type="button"
                      onClick={() => {
                        setLanguage(item);
                        persist({
                          language: item,
                          // The one automatic companion change the settings always made:
                          // Kiswahili readers default to the Swahili Bible edition.
                          ...(item === "Kiswahili" ? { bibleTranslation: "NZK", defaultBibleVersion: "NZK" } : {}),
                        });
                      }}
                      className={`rounded-full px-4 py-2.5 text-sm font-semibold transition ${active ? "bg-ink-fill text-white shadow-lift" : "border border-line bg-surface text-ink-soft hover:border-gold/50"}`}
                    >
                      {item}
                    </button>
                  );
                })}
              </div>
              <p className="mt-3 text-xs text-ink-muted">{t("settings.browseHint")}</p>
            </div>
          </section>

          {/* Behaviour */}
          <section className="rounded-[26px] border border-line bg-surface p-6 shadow-soft sm:p-7">
            <CardHead icon={Sparkles} tone="bg-terracotta-soft text-terracotta" title="While you listen" note="Small choices that change how a session feels." />
            <div className="mt-4 divide-y divide-line/70">
              <ToggleRow title="Autoplay the next piece" note="Keep the worship flowing when a track ends." checked={toggles.autoplay} onChange={() => toggle("autoplay")} />
              <ToggleRow title="Closed captions" note="Show captions whenever the source provides them." checked={toggles.captions} onChange={() => toggle("captions")} />
              <ToggleRow title="Reduce mobile data" note="Stream in a lighter quality on mobile networks." checked={toggles.dataSaver} onChange={() => toggle("dataSaver")} />
              <ToggleRow title="Sabbath evening mode" note="Lower screen brightness and dim animations after sundown." checked={toggles.bedroomMode} onChange={() => toggle("bedroomMode")} />
            </div>
          </section>

          {/* Reminders */}
          <section className="rounded-[26px] border border-line bg-surface p-6 shadow-soft sm:p-7">
            <CardHead icon={Bell} tone="bg-sage-soft text-sage" title="Reminders" note="The daily verse, your reading streak and live worship, even when the app is closed." />
            <button
              type="button"
              onClick={() => setRemindersOpen(true)}
              className="mt-6 inline-flex h-11 items-center gap-2 rounded-xl bg-ink-fill px-5 text-sm font-semibold text-white transition hover:bg-ink-fill/90"
            >
              <Bell size={16} />
              Open reminders &amp; settings
            </button>
            <p className="mt-3 text-xs text-ink-muted">Reminders are tied to your account so they keep arriving after you close the app.</p>
          </section>

          {/* Account & security — the advanced settings, tied to the real account. */}
          <SecuritySection user={user} />

          {/* Updates */}
          <section className="rounded-[26px] border border-line bg-surface p-6 shadow-soft sm:p-7">
            <CardHead icon={Globe2} tone="bg-ink-fill text-white" title="Gentle updates" note="Curated guidance and atmosphere-aligned invitations from across the community." />
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              {updates.slice(0, 3).map((item) => (
                <article key={item.id || item.title} className="rounded-2xl border border-line bg-canvas/50 p-4">
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-terracotta">{item.category || item.kind || "Update"}</p>
                  <h3 className="mt-1.5 font-display text-lg font-semibold leading-snug">{item.title || item.name || "A gentle note"}</h3>
                  <p className="mt-1.5 line-clamp-2 text-sm leading-5 text-ink-muted">{item.summary || item.description || item.body || "Keep exploring."}</p>
                </article>
              ))}
              {updates.length === 0 ? <p className="col-span-full rounded-2xl border border-dashed border-line p-5 text-center text-sm text-ink-muted">New guidance will appear here.</p> : null}
            </div>
          </section>

          {/* Policies */}
          <section className="flex flex-col gap-3 rounded-2xl border border-line bg-surface-soft/60 p-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-start gap-3 text-sm leading-6 text-ink-muted">
              <LockKeyhole size={17} className="mt-0.5 shrink-0 text-gold" />
              <span>
                Your library, notes and history belong to your account and to nobody else. No ad trackers, no third-party analytics —{" "}
                <Link href="/policies" className="font-semibold text-ink underline decoration-gold/60 underline-offset-4">
                  read the policies
                </Link>
                .
              </span>
            </p>
            <Link
              href="/policies"
              className="flex shrink-0 items-center gap-2 self-start rounded-xl border border-line bg-surface px-4 py-2.5 text-[13px] font-semibold text-ink-soft transition hover:border-gold/50 hover:text-ink sm:self-auto"
            >
              <FileText size={15} /> Terms, privacy &amp; cookies
            </Link>
          </section>
        </div>

        {/* Summary */}
        <aside className="space-y-5 lg:sticky lg:top-[104px] lg:self-start">
          <div className="rounded-[26px] border border-line bg-surface p-6 shadow-soft">
            <h3 className="font-display text-xl font-semibold">Your choices</h3>
            <div className="mt-5 space-y-3.5 text-sm">
              <SummaryRow label="Language" value={language} />
              <SummaryRow label="Theme" value={themes.find((item) => item.value === theme)?.labelKey ? t(themes.find((item) => item.value === theme)?.labelKey ?? "settings.themeWarm") : theme} />
              <SummaryRow label="Home church" value={profile.homeChurch || "Not set"} />
              <SummaryRow label="Autoplay" value={toggles.autoplay ? "On" : "Off"} />
              <SummaryRow label="Captions" value={toggles.captions ? "On" : "Off"} />
            </div>
            <div className="mt-6 h-px bg-line/70" />
            <div className="mt-5 flex items-center gap-2 text-xs text-ink-muted">
              <span className={`grid size-6 place-items-center rounded-full ${saved ? "bg-sage text-white" : "bg-gold-soft text-gold"}`}>
                {saved ? <Check size={13} /> : <Bell size={13} />}
              </span>
              {saved ? "Saved to your account." : "Changes save as you make them."}
            </div>
          </div>
          <Link href="/" className="group flex h-12 items-center justify-center gap-2 rounded-[26px] border border-line bg-surface text-sm font-semibold text-ink transition hover:border-sage hover:text-sage">
            <ChevronRight size={16} className="rotate-180 transition-transform group-hover:-translate-x-0.5" />
            Back to home
          </Link>
        </aside>
      </div>
      <RemindersModal open={remindersOpen} onClose={() => setRemindersOpen(false)} />
    </div>
  );
}

function CardHead({ icon: Icon, tone, title, note }: { icon: typeof Bell; tone: string; title: string; note: string }) {
  return (
    <div className="flex items-start gap-4">
      <span className={`grid size-11 shrink-0 place-items-center rounded-2xl ${tone}`}><Icon size={20} /></span>
      <div>
        <h2 className="font-display text-[24px] font-semibold tracking-[-0.02em]">{title}</h2>
        <p className="mt-0.5 text-sm leading-5 text-ink-muted">{note}</p>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  autoComplete?: string;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-bold uppercase tracking-[0.12em] text-ink-muted">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        type={type}
        autoComplete={autoComplete}
        className="h-12 w-full rounded-xl border border-line bg-canvas px-3.5 text-sm text-ink outline-none transition placeholder:text-ink-muted/60 focus:border-gold/60 focus:ring-4 focus:ring-gold/10"
      />
    </label>
  );
}

function ToggleRow({ title, note, checked, onChange }: { title: string; note: string; checked: boolean; onChange: () => void }) {
  return (
    <button type="button" onClick={onChange} className="flex w-full items-center gap-4 py-4 text-left first:pt-2 last:pb-0">
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-ink">{title}</span>
        <span className="mt-0.5 block text-xs leading-5 text-ink-muted">{note}</span>
      </span>
      <span className={`relative h-7 w-12 shrink-0 rounded-full transition ${checked ? "bg-sage" : "bg-line"}`} aria-hidden="true">
        <span className={`absolute top-1 size-5 rounded-full bg-white shadow-sm transition-all ${checked ? "left-6" : "left-1"}`} />
      </span>
    </button>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-ink-muted">{label}</span>
      <span className="truncate font-semibold text-ink">{value}</span>
    </div>
  );
}
/**
 * The advanced settings: the account itself.
 *
 * Everything here is a real endpoint, not a row of switches that go nowhere —
 * changing the password really signs out every other device, and the device
 * list is what `GET /api/auth/sessions` actually believes. A settings page that
 * lists controls the server has never heard of is worse than one that lists
 * fewer of them.
 */
function SecuritySection({ user }: { user: SessionUser | null }) {
  const [devices, setDevices] = useState<DeviceSession[] | null>(null);
  const [changing, setChanging] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  if (!user) return null;

  async function changePassword(event: React.FormEvent) {
    event.preventDefault();
    if (next.length < 8) {
      setMessage({ tone: "bad", text: "The new password needs at least 8 characters." });
      return;
    }
    setBusy(true);
    setMessage(null);
    const res = await authedFetch("/api/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ currentPassword: current, newPassword: next }),
    }).catch(() => null);
    setBusy(false);
    if (!res || !res.ok) {
      const body = res ? await res.json().catch(() => null) : null;
      setMessage({ tone: "bad", text: body?.error?.message ?? "That did not work. Check your current password." });
      return;
    }
    // The server revokes the other sessions; this device's token is still good.
    setChanging(false);
    setCurrent("");
    setNext("");
    setMessage({ tone: "ok", text: "Password changed. Other devices have been signed out." });
  }

  return (
    <section className="rounded-[26px] border border-line bg-surface p-6 shadow-soft sm:p-7">
      <CardHead
        icon={ShieldCheck}
        tone="bg-sage-soft text-sage"
        title="Account &amp; security"
        note="Your sign-in, your devices, and the keys to the account."
      />

      <div className="mt-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-canvas/60 px-4 py-3.5">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink">{user.email}</p>
            <p className="mt-0.5 text-xs text-ink-muted">
              {user.emailVerified ? "Verified — reminders and account recovery are unlocked." : "Not yet verified — some features are held back until this is done."}
            </p>
          </div>
          {user.emailVerified ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-sage-soft px-3 py-1 text-xs font-semibold text-sage">
              <Check size={13} /> Verified
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-gold-soft px-3 py-1 text-xs font-semibold text-ink-soft">
              <Sparkles size={13} /> Confirm your email
            </span>
          )}
        </div>

        <div className="rounded-2xl border border-line bg-canvas/60 px-4 py-3.5">
          <button
            type="button"
            onClick={() => {
              setChanging((value) => !value);
              setMessage(null);
              if (!changing) void listSessions().then((list) => setDevices(list));
            }}
            className="flex w-full items-center gap-3 text-left"
            aria-expanded={changing}
          >
            <KeyRound size={17} className="shrink-0 text-gold" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-ink">Change password</span>
              <span className="mt-0.5 block text-xs text-ink-muted">Signs every other device out when it lands.</span>
            </span>
            <ChevronRight size={15} className={`shrink-0 text-ink-muted transition-transform ${changing ? "rotate-90" : ""}`} />
          </button>

          {changing ? (
            <form onSubmit={changePassword} className="mt-4 space-y-3 border-t border-line/70 pt-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Current password" value={current} onChange={setCurrent} type="password" />
                <Field label="New password" value={next} onChange={setNext} type="password" placeholder="At least 8 characters" />
              </div>
              {message ? (
                <p
                  role="status"
                  className={`rounded-xl border px-3.5 py-2.5 text-xs leading-5 ${
                    message.tone === "ok" ? "border-sage/30 bg-sage-soft/50 text-sage" : "border-terracotta/30 bg-terracotta-soft/50 text-terracotta"
                  }`}
                >
                  {message.text}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <button
                  type="submit"
                  disabled={busy || !current || next.length < 8}
                  className="h-10 rounded-xl bg-ink-fill px-4 text-[13px] font-semibold text-white transition hover:bg-sage disabled:opacity-45"
                >
                  {busy ? "Changing…" : "Change password"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setChanging(false);
                    setCurrent("");
                    setNext("");
                    setMessage(null);
                  }}
                  className="h-10 rounded-xl border border-line px-4 text-[13px] font-semibold text-ink-soft transition hover:bg-canvas"
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : null}
        </div>

        <div className="rounded-2xl border border-line bg-canvas/60 px-4 py-3.5">
          <p className="flex items-center gap-2 text-sm font-semibold text-ink">
            <MonitorSmartphone size={16} className="text-ink-muted" />
            Signed-in devices
          </p>
          {devices && devices.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {devices.slice(0, 4).map((device, index) => (
                <li key={device.id || index} className="flex items-center gap-3 text-xs text-ink-muted">
                  <span className="size-1.5 shrink-0 rounded-full bg-sage" />
                  <span className="min-w-0 flex-1 truncate">
                    {describeDevice(device.user_agent)}
                    {device.ip_address ? ` · ${device.ip_address}` : ""}
                  </span>
                  <span className="shrink-0 text-ink-muted/70">{index === 0 ? "This device, most likely" : ""}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1.5 text-xs text-ink-muted">Open the section above to see where this account is signed in.</p>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await signOutEverywhere();
              setBusy(false);
              setDevices([]);
            }}
            className="mt-3.5 inline-flex items-center gap-2 rounded-xl border border-terracotta/30 px-3.5 py-2 text-[12.5px] font-semibold text-terracotta transition hover:bg-terracotta-soft/50 disabled:opacity-50"
          >
            <LogOut size={14} /> Sign out everywhere
          </button>
        </div>

        <button
          type="button"
          onClick={() => void signOut()}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-line px-4 py-3 text-[13px] font-semibold text-ink-soft transition hover:border-terracotta/40 hover:text-terracotta"
        >
          <LogOut size={15} /> Sign out of this device
        </button>
      </div>
    </section>
  );
}

/**
 * A tiny, live preview of an atmosphere.
 *
 * It carries its own `data-theme`, so every colour inside resolves against that
 * palette rather than the one currently applied to the page — a theme card that
 * showed the active theme's colours would be a row of identical swatches. The
 * shapes are the app's furniture in miniature: the top bar, the rail, two cards
 * and the three accents.
 */
function ThemePreview({ theme }: { theme: string }) {
  return (
    <span
      data-theme={theme}
      aria-hidden
      className="flex h-[74px] w-full flex-col overflow-hidden rounded-xl border border-line/70 bg-canvas"
    >
      <span className="flex h-3.5 shrink-0 items-center gap-1 bg-ink-fill px-1.5">
        <span className="size-1 rounded-full bg-gold" />
        <span className="h-1 w-5 rounded-full bg-white/25" />
        <span className="ml-auto h-1 w-3 rounded-full bg-white/20" />
      </span>
      <span className="flex min-h-0 flex-1">
        <span className="flex w-4 shrink-0 flex-col gap-1 bg-ink-fill p-1">
          <span className="h-1 w-full rounded-full bg-white/30" />
          <span className="h-1 w-2/3 rounded-full bg-white/15" />
          <span className="h-1 w-3/4 rounded-full bg-white/15" />
        </span>
        <span className="flex flex-1 flex-col gap-1 p-1.5">
          <span className="h-2 w-3/4 rounded-[3px] bg-surface shadow-sm" />
          <span className="h-2 w-1/2 rounded-[3px] bg-surface shadow-sm" />
          <span className="mt-auto flex items-center gap-1">
            <span className="size-1.5 rounded-full bg-gold" />
            <span className="size-1.5 rounded-full bg-sage" />
            <span className="size-1.5 rounded-full bg-terracotta" />
          </span>
        </span>
      </span>
    </span>
  );
}

/** "Mozilla/5.0 (iPhone…)" as something a person would recognise. */
function describeDevice(agent?: string | null): string {
  if (!agent) return "A device we cannot name";
  const browser = /Edg\//.test(agent)
    ? "Edge"
    : /OPR\//.test(agent)
      ? "Opera"
      : /Firefox\//.test(agent)
        ? "Firefox"
        : /Chrome\//.test(agent)
          ? "Chrome"
          : /Safari\//.test(agent)
            ? "Safari"
            : "A browser";
  const platform = /iPhone|iPad/.test(agent)
    ? "iPhone"
    : /Android/.test(agent)
      ? "Android"
      : /Mac OS X/.test(agent)
        ? "Mac"
        : /Windows/.test(agent)
          ? "Windows"
          : /Linux/.test(agent)
            ? "Linux"
            : "device";
  return `${browser} on ${platform}`;
}
