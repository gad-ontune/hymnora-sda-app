"use client";

/**
 * Signing in, and signing up.
 *
 * This is the first place the account is ever touched from the front end, so it
 * is also the first place the token layer is: `signIn`/`signUp` in
 * `lib/session-store.ts` write the tokens and then ask the server who the
 * account is, and every other surface — the top bar, the sidebar card, settings,
 * the library — reads that one answer rather than fetching its own.
 *
 * The forms are deliberately unhurried: no spinner theatre, a real error the
 * server wrote, and the demo accounts on the page because this is a platform
 * being built in the open and a reviewer should not have to ask for a login.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, Check, KeyRound, Loader2, Mail, ShieldCheck, Sparkles, UserRound } from "lucide-react";
import { signIn, signOut, signUp, useSessionState, type SignInResult } from "@/lib/session-store";

type Mode = "signin" | "register";

/**
 * Accounts that exist in development, with the password they were seeded with.
 *
 * Admin is deliberately absent from the public list. A reviewer should be able
 * to walk the site as a member, and an administrator surface should not be one
 * tap away from whoever is reading the landing page. Typing the passphrase
 * `hymnora/admin` into the email field reveals the Admin demo account.
 */
const PUBLIC_DEMO_ACCOUNTS = [
  { email: "member@hymnora.app", label: "Member" },
  { email: "reader@hymnora.app", label: "Reader" },
];
const ADMIN_DEMO_ACCOUNT = { email: "admin@hymnora.app", label: "Admin" };
/** The secret typed into the email field that uncovers the admin account. */
const ADMIN_SECRET = "hymnora/admin";
const DEMO_PASSWORD = "Password123!";

const PROMISES = [
  "Your library, notes and reading plans follow you between devices.",
  "Reminders arrive on this phone, not in a tab you forgot to leave open.",
  "Likes, follows and comments are attached to you rather than to a device.",
];

export function AuthExperience({
  mode,
  nextPath = "/",
  notice,
}: {
  mode: Mode;
  nextPath?: string;
  /** Said once, at the top, after something else on the site sent them here. */
  notice?: string;
}) {
  return (
    <AuthFrame mode={mode} notice={notice}>
      {mode === "signin" ? <SignInForm nextPath={nextPath} /> : <RegisterForm nextPath={nextPath} />}
    </AuthFrame>
  );
}

/** The two-column frame: what an account is for, and then the form. */
function AuthFrame({ mode, notice, children }: { mode: Mode; notice?: string; children: React.ReactNode }) {
  const { session } = useSessionState();
  return (
    <div className="relative min-h-screen overflow-hidden bg-canvas">
      {/* The same warm light the rest of the app has, in a corner or two. */}
      <div aria-hidden className="pointer-events-none absolute -left-40 -top-40 size-[520px] rounded-full bg-gold-soft/50 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-52 -right-32 size-[560px] rounded-full bg-sage-soft/55 blur-3xl" />

      <div className="relative mx-auto flex min-h-screen w-full max-w-[1180px] flex-col px-5 py-6 sm:px-8 lg:flex-row lg:items-center lg:gap-16 lg:py-12">
        <aside className="lg:flex lg:w-[46%] lg:flex-col lg:justify-center">
          <Link href="/" className="inline-flex w-fit items-center gap-3">
            <span className="grid size-11 place-items-center rounded-2xl bg-ink-fill font-display text-xl font-semibold text-gold-light">H</span>
            <span className="font-display text-[21px] font-semibold tracking-[-0.01em]">Hymnora SDA</span>
          </Link>

          <h1 className="mt-10 max-w-[15ch] font-display text-[34px] font-semibold leading-[1.1] tracking-[-0.02em] sm:text-[42px] lg:mt-14">
            {mode === "signin" ? (
              <>
                Welcome <span className="text-gold">back.</span>
              </>
            ) : (
              <>
                Join the <span className="text-gold">family.</span>
              </>
            )}
          </h1>
          <p className="mt-4 max-w-[42ch] text-[15px] leading-6 text-ink-muted">
            {mode === "signin"
              ? "Pick up where you left off — the song that was playing, the note you were writing, the verse you were reading."
              : "One account for worship, the Word, and the people you share them with."}
          </p>

          <ul className="mt-9 hidden space-y-3.5 lg:block">
            {PROMISES.map((line) => (
              <li key={line} className="flex items-start gap-3 text-[14px] leading-6 text-ink-soft">
                <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-sage-soft text-sage">
                  <Check size={12} strokeWidth={3} />
                </span>
                {line}
              </li>
            ))}
          </ul>

          <p className="mt-8 text-[13px] text-ink-muted lg:mt-12">
            {mode === "signin" ? (
              <>
                New here?{" "}
                <Link href="/register" className="font-semibold text-ink underline decoration-gold/60 underline-offset-4 hover:decoration-gold">
                  Create an account
                </Link>
              </>
            ) : (
              <>
                Already have one?{" "}
                <Link href="/signin" className="font-semibold text-ink underline decoration-gold/60 underline-offset-4 hover:decoration-gold">
                  Sign in
                </Link>
              </>
            )}
          </p>
        </aside>

        <main className="mt-10 flex-1 lg:mt-0">
          <div className="rounded-[28px] border border-line bg-surface p-6 shadow-soft sm:p-9">
            {session.status === "signed-in" && session.user ? (
              <AlreadySignedIn email={session.user.email} />
            ) : (
              <>
                {notice ? (
                  <p className="mb-6 rounded-xl border border-sage/25 bg-sage-soft/45 px-4 py-3 text-[12.5px] leading-5 text-ink-soft">
                    {notice}
                  </p>
                ) : null}
                {children}
              </>
            )}
          </div>
          <p className="mt-6 text-center text-[12px] leading-5 text-ink-muted">
            By continuing you agree to our{" "}
            <Link href="/policies" className="underline decoration-line underline-offset-2 hover:text-ink">
              terms
            </Link>{" "}
            and{" "}
            <Link href="/policies#privacy" className="underline decoration-line underline-offset-2 hover:text-ink">
              privacy notice
            </Link>
            .
          </p>
        </main>
      </div>
    </div>
  );
}

function AlreadySignedIn({ email }: { email: string }) {
  const router = useRouter();
  return (
    <div className="text-center">
      <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-sage-soft text-sage">
        <ShieldCheck size={22} />
      </span>
      <h2 className="mt-5 font-display text-[26px] font-semibold tracking-[-0.01em]">You are signed in</h2>
      <p className="mt-2 text-sm text-ink-muted">{email}</p>
      <div className="mt-7 flex flex-col gap-2.5 sm:flex-row sm:justify-center">
        <button
          type="button"
          onClick={() => router.push("/")}
          className="rounded-xl bg-ink-fill px-5 py-3 text-sm font-semibold text-white transition hover:bg-sage"
        >
          Continue
        </button>
        <button
          type="button"
          onClick={async () => {
            await signOut();
            router.refresh();
          }}
          className="rounded-xl border border-line px-5 py-3 text-sm font-semibold text-ink-soft transition hover:bg-canvas"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}

function SignInForm({ nextPath }: { nextPath: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Exact match on the passphrase. Once recognised it is effectively a keyboard
  // shortcut: one more typed character and the reveal vanishes again, so it can
  // never idle there for someone else to trip over.
  const adminReveal = email.trim().toLowerCase() === ADMIN_SECRET;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result: SignInResult = await signIn(email, password);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.push(nextPath);
  }

  async function signInAsDemo(demoEmail: string) {
    setBusy(true);
    setError(null);
    setEmail(demoEmail);
    setPassword(DEMO_PASSWORD);
    const result = await signIn(demoEmail, DEMO_PASSWORD);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.push(nextPath);
  }

  return (
    <form onSubmit={submit} noValidate>
      <h2 className="font-display text-[26px] font-semibold tracking-[-0.01em]">Sign in</h2>
      <p className="mt-1.5 text-[13.5px] text-ink-muted">Use the email you registered with.</p>

      <div className="mt-7 space-y-4">
        <Field
          id="email"
          label="Email"
          icon={<Mail size={16} />}
          // The passphrase is not an email address, and a browser that paints it
          // a bad email would double every keystroke with a red flash.
          type={adminReveal ? "text" : "email"}
          value={email}
          onChange={setEmail}
          autoComplete="email"
          placeholder="you@example.com"
          required
        />
        <Field
          id="password"
          label="Password"
          icon={<KeyRound size={16} />}
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          placeholder="••••••••"
          required
        />
      </div>

      <div className="mt-3 flex items-center justify-between">
        <label className="flex items-center gap-2 text-[12.5px] text-ink-muted">
          <input type="checkbox" name="remember" defaultChecked className="size-4 accent-[color:var(--sage)]" />
          Keep me signed in
        </label>
        <Link href="/forgot-password" className="text-[12.5px] font-semibold text-ink-muted underline decoration-line underline-offset-2 hover:text-ink">
          Forgot password?
        </Link>
      </div>

      <ErrorText error={error} />

      <SubmitButton busy={busy} disabled={!email || !password} label="Sign in" busyLabel="Signing in…" />

      <div className="mt-8 border-t border-line pt-6">
        <p className="flex items-center gap-1.5 text-[12px] font-semibold text-ink-muted">
          <Sparkles size={13} /> Try a demo account
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {PUBLIC_DEMO_ACCOUNTS.map((account) => (
            <button
              key={account.email}
              type="button"
              disabled={busy}
              onClick={() => signInAsDemo(account.email)}
              className="rounded-xl border border-line bg-canvas px-3 py-2.5 text-left transition hover:border-gold/60 hover:bg-gold-soft/40 disabled:opacity-50"
            >
              <span className="block text-[12.5px] font-semibold text-ink">{account.label}</span>
              <span className="mt-0.5 block truncate text-[11px] text-ink-muted">{account.email}</span>
            </button>
          ))}
          {adminReveal ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => signInAsDemo(ADMIN_DEMO_ACCOUNT.email)}
              className="rounded-xl border border-gold/50 bg-gold-soft/40 px-3 py-2.5 text-left transition hover:bg-gold-soft/70 disabled:opacity-50"
            >
              <span className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink">
                <ShieldCheck size={13} className="text-gold" /> {ADMIN_DEMO_ACCOUNT.label}
              </span>
              <span className="mt-0.5 block truncate text-[11px] text-ink-muted">{ADMIN_DEMO_ACCOUNT.email}</span>
            </button>
          ) : null}
        </div>
        <p className="mt-2.5 text-[11.5px] text-ink-muted">
          {adminReveal ? "Admin unlocked." : `All demo accounts use the password ${DEMO_PASSWORD}.`}
        </p>
      </div>
    </form>
  );
}

function RegisterForm({ nextPath }: { nextPath: string }) {
  const router = useRouter();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newsletter, setNewsletter] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const tooShort = password.length > 0 && password.length < 8;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (password.length < 8) {
      setError("Passwords need at least 8 characters.");
      return;
    }
    setBusy(true);
    setError(null);
    const result = await signUp({ email, password, firstName, lastName, newsletter });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (result.verificationToken) {
      // No mail transport outside production, so the API hands the token back
      // rather than pretending an email went out. Saying so beats a checkbox
      // that never gets ticked.
      setNotice(`Account created. Local build has no mail transport — verify with token ${result.verificationToken.slice(0, 12)}…`);
    }
    router.push(nextPath);
  }

  return (
    <form onSubmit={submit} noValidate>
      <h2 className="font-display text-[26px] font-semibold tracking-[-0.01em]">Create your account</h2>
      <p className="mt-1.5 text-[13.5px] text-ink-muted">It takes a moment, and there is no card.</p>

      <div className="mt-7 space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id="firstName"
            label="First name"
            icon={<UserRound size={16} />}
            value={firstName}
            onChange={setFirstName}
            autoComplete="given-name"
            placeholder="Ada"
            required
          />
          <Field
            id="lastName"
            label="Last name"
            icon={<UserRound size={16} />}
            value={lastName}
            onChange={setLastName}
            autoComplete="family-name"
            placeholder="Mwangi"
            required
          />
        </div>
        <Field
          id="email"
          label="Email"
          icon={<Mail size={16} />}
          type="email"
          value={email}
          onChange={setEmail}
          autoComplete="email"
          placeholder="you@example.com"
          required
        />
        <Field
          id="password"
          label="Password"
          icon={<KeyRound size={16} />}
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          placeholder="At least 8 characters"
          required
          hint={tooShort ? "A little longer, please — 8 characters minimum." : undefined}
          tone={tooShort ? "warn" : undefined}
        />
      </div>

      <label className="mt-5 flex items-start gap-2.5 text-[12.5px] leading-5 text-ink-muted">
        <input
          type="checkbox"
          checked={newsletter}
          onChange={(event) => setNewsletter(event.target.checked)}
          className="mt-0.5 size-4 shrink-0 accent-[color:var(--sage)]"
        />
        <span>Send me the weekly letter — new hymns, live services and a verse for the week.</span>
      </label>

      <ErrorText error={error} />
      {notice ? (
        <p className="mt-4 rounded-xl border border-gold/30 bg-gold-soft/50 px-4 py-3 text-[12.5px] leading-5 text-ink-soft">
          {notice}
        </p>
      ) : null}

      <SubmitButton
        busy={busy}
        disabled={!email || !password || !firstName || !lastName || tooShort}
        label="Create account"
        busyLabel="Creating your account…"
      />

      <p className="mt-5 text-center text-[12px] text-ink-muted">
        Already have an account?{" "}
        <Link href="/signin" className="font-semibold text-ink underline decoration-gold/60 underline-offset-4">
          Sign in
        </Link>
      </p>
    </form>
  );
}

function Field({
  id,
  label,
  icon,
  value,
  onChange,
  type = "text",
  autoComplete,
  placeholder,
  required,
  hint,
  tone,
}: {
  id: string;
  label: string;
  icon?: React.ReactNode;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  autoComplete?: string;
  placeholder?: string;
  required?: boolean;
  hint?: string;
  tone?: "warn";
}) {
  return (
    <label htmlFor={id} className="block">
      <span className="mb-1.5 block text-[12.5px] font-semibold text-ink-soft">{label}</span>
      <span className="relative block">
        {icon ? <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-muted">{icon}</span> : null}
        <input
          id={id}
          name={id}
          type={type}
          value={value}
          required={required}
          autoComplete={autoComplete}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          className={`h-12 w-full rounded-xl border bg-canvas text-[14px] text-ink outline-none transition placeholder:text-ink-muted/70 focus:ring-4 ${
            icon ? "pl-10 pr-3.5" : "px-3.5"
          } ${
            tone === "warn"
              ? "border-terracotta/60 focus:border-terracotta focus:ring-terracotta/10"
              : "border-line focus:border-gold/70 focus:ring-gold/10"
          }`}
        />
      </span>
      {hint ? <span className="mt-1.5 block text-[11.5px] text-terracotta">{hint}</span> : null}
    </label>
  );
}

function ErrorText({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="mt-4 rounded-xl border border-terracotta/30 bg-terracotta-soft/60 px-4 py-3 text-[12.5px] leading-5 text-terracotta">
      {error}
    </p>
  );
}

function SubmitButton({ busy, disabled, label, busyLabel }: { busy: boolean; disabled: boolean; label: string; busyLabel: string }) {
  return (
    <button
      type="submit"
      disabled={busy || disabled}
      className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-ink-fill text-[14px] font-semibold text-white transition hover:bg-sage disabled:cursor-not-allowed disabled:opacity-45"
    >
      {busy ? <Loader2 size={16} className="animate-spin" /> : null}
      {busy ? busyLabel : label}
      {busy ? null : <ArrowRight size={15} />}
    </button>
  );
}
