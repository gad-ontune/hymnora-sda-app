"use client";

/**
 * Getting back in when the password is the thing that was lost.
 *
 * Two steps, because the API is two steps: `POST /forgot-password` never says
 * whether an account exists — that is the server's call to make so the form
 * cannot be used to enumerate members — and `POST /reset-password` needs the
 * token from the link. Outside production there is no mail transport, so the
 * API hands the token back and this page shows it, which is the honest version
 * of a mail that never arrived.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, KeyRound, Loader2, Mail } from "lucide-react";
import { API_BASE } from "@/lib/session";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [devToken, setDevToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error?.message ?? "Could not send the reset link.");
        setBusy(false);
        return;
      }
      const body = await res.json().catch(() => null);
      setDevToken(body?.resetToken ?? null);
      setSent(true);
    } catch {
      setError("Could not reach the server.");
    }
    setBusy(false);
  }

  return (
    <div>
      <span className="grid size-11 place-items-center rounded-2xl bg-gold-soft text-gold">
        <Mail size={20} />
      </span>
      <h1 className="mt-5 font-display text-[26px] font-semibold tracking-[-0.01em]">Reset your password</h1>
      <p className="mt-2 text-[13.5px] leading-5 text-ink-muted">
        Give the email you registered with and we will send a link to set a new password.
      </p>

      {sent ? (
        <div className="mt-6 rounded-2xl border border-sage/25 bg-sage-soft/45 px-4 py-4 text-[13px] leading-5 text-ink-soft">
          <p className="font-semibold text-ink">Check your inbox.</p>
          <p className="mt-1">
            If an account exists for <span className="font-semibold">{email.trim()}</span>, a reset link is on its way.
          </p>
          {devToken ? (
            <p className="mt-3 rounded-xl border border-gold/30 bg-gold-soft/50 px-3 py-2 text-[11.5px]">
              Local build has no mail transport, so here is the token:{" "}
              <span className="font-mono break-all">{devToken}</span>
            </p>
          ) : null}
          <Link
            href={`/reset-password${devToken ? `?token=${encodeURIComponent(devToken)}` : ""}`}
            className="mt-4 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-ink underline decoration-sage/50 underline-offset-4"
          >
            Continue to set a new password <ArrowRight size={13} />
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} className="mt-6">
          <label htmlFor="email" className="block">
            <span className="mb-1.5 block text-[12.5px] font-semibold text-ink-soft">Email</span>
            <span className="relative block">
              <Mail className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-muted" size={16} />
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                className="h-12 w-full rounded-xl border border-line bg-canvas pl-10 pr-3.5 text-[14px] outline-none transition placeholder:text-ink-muted/70 focus:border-gold/70 focus:ring-4 focus:ring-gold/10"
              />
            </span>
          </label>
          {error ? (
            <p role="alert" className="mt-4 rounded-xl border border-terracotta/30 bg-terracotta-soft/60 px-4 py-3 text-[12.5px] text-terracotta">
              {error}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={busy || !email}
            className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-ink-fill text-[14px] font-semibold text-white transition hover:bg-sage disabled:opacity-45"
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : null}
            {busy ? "Sending…" : "Send the reset link"}
          </button>
        </form>
      )}

      <p className="mt-6 text-center text-[12.5px] text-ink-muted">
        Remembered it?{" "}
        <Link href="/signin" className="font-semibold text-ink underline decoration-gold/60 underline-offset-4">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const mismatch = confirm.length > 0 && confirm !== password;
  const tooShort = password.length > 0 && password.length < 8;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (password.length < 8) {
      setError("Passwords need at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Those two passwords do not match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error?.message ?? "That reset link is no longer valid.");
        setBusy(false);
        return;
      }
      // The server clears its cookies on reset, so whatever this browser was
      // holding is dead. Landing on sign-in with a note is the honest end state.
      try {
        window.localStorage.removeItem("hymnora.access");
        window.localStorage.removeItem("hymnora.refresh");
      } catch {
        /* Storage blocked; the tokens die with the page anyway. */
      }
      router.push("/signin?reset=1");
    } catch {
      setError("Could not reach the server.");
    }
    setBusy(false);
  }

  if (!token) {
    return (
      <div>
        <h1 className="font-display text-[26px] font-semibold tracking-[-0.01em]">This link is incomplete</h1>
        <p className="mt-2 text-[13.5px] leading-5 text-ink-muted">
          The reset link is missing its token. Ask for a new one and use the link from that message.
        </p>
        <Link
          href="/forgot-password"
          className="mt-6 flex h-12 w-full items-center justify-center rounded-xl bg-ink-fill text-[14px] font-semibold text-white transition hover:bg-sage"
        >
          Request a new link
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit}>
      <span className="grid size-11 place-items-center rounded-2xl bg-sage-soft text-sage">
        <KeyRound size={20} />
      </span>
      <h1 className="mt-5 font-display text-[26px] font-semibold tracking-[-0.01em]">Choose a new password</h1>
      <p className="mt-2 text-[13.5px] leading-5 text-ink-muted">
        Every signed-in device is signed out when the password changes.
      </p>

      <div className="mt-6 space-y-4">
        <label htmlFor="password" className="block">
          <span className="mb-1.5 block text-[12.5px] font-semibold text-ink-soft">New password</span>
          <input
            id="password"
            type="password"
            required
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="At least 8 characters"
            className="h-12 w-full rounded-xl border border-line bg-canvas px-3.5 text-[14px] outline-none transition placeholder:text-ink-muted/70 focus:border-gold/70 focus:ring-4 focus:ring-gold/10"
          />
          {tooShort ? <span className="mt-1.5 block text-[11.5px] text-terracotta">8 characters minimum, please.</span> : null}
        </label>
        <label htmlFor="confirm" className="block">
          <span className="mb-1.5 block text-[12.5px] font-semibold text-ink-soft">Confirm it</span>
          <input
            id="confirm"
            type="password"
            required
            autoComplete="new-password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            placeholder="Type it once more"
            className={`h-12 w-full rounded-xl border bg-canvas px-3.5 text-[14px] outline-none transition placeholder:text-ink-muted/70 focus:ring-4 ${
              mismatch ? "border-terracotta/60 focus:border-terracotta focus:ring-terracotta/10" : "border-line focus:border-gold/70 focus:ring-gold/10"
            }`}
          />
          {mismatch ? <span className="mt-1.5 block text-[11.5px] text-terracotta">These do not match yet.</span> : null}
        </label>
      </div>

      {error ? (
        <p role="alert" className="mt-4 rounded-xl border border-terracotta/30 bg-terracotta-soft/60 px-4 py-3 text-[12.5px] text-terracotta">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={busy || !password || !confirm || mismatch || tooShort}
        className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-ink-fill text-[14px] font-semibold text-white transition hover:bg-sage disabled:opacity-45"
      >
        {busy ? <Loader2 size={16} className="animate-spin" /> : null}
        {busy ? "Saving…" : "Set the new password"}
      </button>
    </form>
  );
}

/** The shared card the two password pages sit in. */
export function PasswordFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-canvas px-5 py-10">
      <div aria-hidden className="pointer-events-none absolute -left-40 -top-40 size-[480px] rounded-full bg-gold-soft/50 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-48 -right-40 size-[520px] rounded-full bg-sage-soft/55 blur-3xl" />
      <div className="relative w-full max-w-[460px] rounded-[28px] border border-line bg-surface p-6 shadow-soft sm:p-9">
        <Link href="/" className="mb-8 inline-flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-xl bg-ink-fill font-display text-base font-semibold text-gold-light">H</span>
          <span className="font-display text-[17px] font-semibold">Hymnora SDA</span>
        </Link>
        {children}
      </div>
    </div>
  );
}
