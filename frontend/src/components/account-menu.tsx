"use client";

/**
 * The account, in the top bar.
 *
 * This button used to render the hardcoded initials "AM" and do nothing when
 * clicked, which is the worst of both: it claims an identity the visitor may not
 * have and promises a menu that never arrives. It now reads the one signed-in
 * answer from the session store, and offers the three things somebody actually
 * wants from it — their library, their settings, and the way out.
 *
 * Signed out, the same spot offers the way in, which is what a top-right avatar
 * on a site with accounts is for.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  ChevronDown,
  FileText,
  Library,
  LogOut,
  LogIn,
  Settings,
  ShieldCheck,
  Sparkles,
  UserRound,
} from "lucide-react";
import { initials } from "@/lib/format";
import { signOut, useSessionState } from "@/lib/session-store";

export function AccountMenu() {
  const pathname = usePathname();
  const { session } = useSessionState();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Dismiss on Escape or on a click anywhere else — a menu that only closes on
  // its own trigger is a menu that traps the person using it.
  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    function onPointer(event: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [open]);

  const nextPath = pathname === "/" ? "/library" : pathname;
  const user = session.user;

  if (session.status !== "signed-in" || !user) {
    return (
      <Link
        href={`/signin?next=${encodeURIComponent(nextPath)}`}
        className="flex h-10 items-center gap-2 rounded-xl bg-ink-fill px-3.5 text-[13px] font-semibold text-white transition hover:bg-sage sm:px-4"
      >
        <LogIn size={15} />
        <span className="hidden sm:inline">Sign in</span>
        <span className="sm:hidden">Sign in</span>
      </Link>
    );
  }

  const label = initials(user.displayName || `${user.firstName} ${user.lastName}`, user.email) || "H";

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-2 rounded-2xl border border-transparent p-1 pr-1.5 transition hover:border-line hover:bg-surface"
        aria-label={`Account menu for ${user.displayName || user.email}`}
      >
        <span className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-sage to-[#5d7a5f] text-[13px] font-semibold text-white shadow-sm">
          {label}
        </span>
        <ChevronDown className={`hidden text-ink-muted transition sm:block ${open ? "rotate-180" : ""}`} size={15} />
      </button>

      {open ? (
        <div
          role="menu"
          className="fade-up absolute right-0 top-[calc(100%+10px)] z-50 w-[268px] overflow-hidden rounded-2xl border border-line bg-surface shadow-lift"
        >
          <div className="flex items-center gap-3 border-b border-line bg-canvas px-4 py-3.5">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-sage to-[#5d7a5f] text-sm font-semibold text-white">
              {label}
            </span>
            <div className="min-w-0">
              <p className="truncate text-[13.5px] font-semibold text-ink">{user.displayName || `${user.firstName} ${user.lastName}`}</p>
              <p className="truncate text-[11.5px] text-ink-muted">{user.email}</p>
            </div>
          </div>

          <div className="px-4 py-2.5">
            {user.emailVerified ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-sage-soft px-2.5 py-1 text-[11px] font-semibold text-sage">
                <ShieldCheck size={12} /> Verified
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-gold-soft px-2.5 py-1 text-[11px] font-semibold text-ink-soft">
                <Sparkles size={12} /> Confirm your email
              </span>
            )}
          </div>

          <div className="border-t border-line py-1.5">
            <MenuLink href="/library" icon={<Library size={16} />} label="Your library" onNavigate={() => setOpen(false)} />
            <MenuLink href="/bible" icon={<BookOpen size={16} />} label="Reading and notes" onNavigate={() => setOpen(false)} />
            <MenuLink href="/settings" icon={<Settings size={16} />} label="Settings" onNavigate={() => setOpen(false)} />
            <MenuLink href="/policies" icon={<FileText size={16} />} label="Terms and policies" onNavigate={() => setOpen(false)} />
          </div>

          <div className="border-t border-line p-1.5">
            <button
              type="button"
              role="menuitem"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await signOut();
                setBusy(false);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2.5 text-left text-[13px] font-semibold text-terracotta transition hover:bg-terracotta-soft/50 disabled:opacity-50"
            >
              <LogOut size={16} />
              {busy ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MenuLink({ href, icon, label, onNavigate }: { href: string; icon: React.ReactNode; label: string; onNavigate: () => void }) {
  return (
    <Link
      href={href}
      role="menuitem"
      onClick={onNavigate}
      className="flex items-center gap-2.5 px-4 py-2.5 text-[13px] font-medium text-ink-soft transition hover:bg-canvas hover:text-ink"
    >
      <span className="text-ink-muted">{icon}</span>
      {label}
    </Link>
  );
}

/**
 * The same account, as a card at the foot of the sidebar.
 *
 * On a desktop rail the top bar is far from the eye's resting place, so the
 * name is repeated where the navigation ends. Signed out, it is the way in.
 */
export function AccountCard({ tone = "dark" }: { tone?: "dark" | "light" }) {
  const { session } = useSessionState();
  const user = session.user;
  const signedIn = session.status === "signed-in" && user;
  const label = signedIn ? initials(user.displayName || `${user.firstName} ${user.lastName}`, user.email) : null;
  const name = signedIn ? user.displayName || `${user.firstName} ${user.lastName}` : "You are not signed in";
  const sub = signedIn ? user.email : "Sync your library, notes and reminders";

  const surface = tone === "dark" ? "border-white/10 bg-white/[0.055] hover:bg-white/[0.09]" : "border-line bg-surface hover:bg-canvas";
  const nameTone = tone === "dark" ? "text-white" : "text-ink";
  const subTone = tone === "dark" ? "text-white/50" : "text-ink-muted";

  const body = (
    <>
      <span
        className={`grid size-10 shrink-0 place-items-center rounded-xl text-sm font-semibold ${
          signedIn ? "bg-gradient-to-br from-sage to-[#5d7a5f] text-white" : tone === "dark" ? "bg-white/10 text-white/70" : "bg-canvas text-ink-muted"
        }`}
      >
        {signedIn ? label : <UserRound size={18} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-[13.5px] font-semibold ${nameTone}`}>{name}</span>
        <span className={`mt-0.5 block truncate text-[11.5px] ${subTone}`}>{sub}</span>
      </span>
    </>
  );

  const className = `flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition ${surface}`;

  return (
    <Link href={signedIn ? "/settings" : "/signin"} className={className}>
      {body}
    </Link>
  );
}
