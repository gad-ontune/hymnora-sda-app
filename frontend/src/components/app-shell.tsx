"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useEffect, useRef, useState } from "react";
import {
  Bell,
  BookOpen,
  CalendarDays,
  Check,
  ChevronDown,
  Church,
  Headphones,
  Home,
  Library,
  ListMusic,
  Menu,
  Mic2,
  Newspaper,
  Radio,
  Search,
  Settings,
  Sparkles,
  Video,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { MiniPlayer } from "./mini-player";
import { AccountCard, AccountMenu } from "./account-menu";
import { RemindersModal } from "./reminders-modal";
import { existingSubscription, pushSupported } from "@/lib/push";
import { getHomeData } from "../lib/data";
import { LANGUAGES, LANGUAGE_CODES, LANGUAGE_NAMES, useI18n, type MessageKey } from "@/lib/i18n";

type NavItem = { key: MessageKey; href: string; icon: LucideIcon };

const primaryNav: NavItem[] = [
  { key: "nav.home", href: "/", icon: Home },
  { key: "nav.music", href: "/music", icon: Headphones },
  { key: "nav.videos", href: "/videos", icon: Video },
  { key: "nav.hymns", href: "/hymns", icon: ListMusic },
  { key: "nav.bible", href: "/bible", icon: BookOpen },
  { key: "nav.sermons", href: "/sermons", icon: Mic2 },
];

const discoverNav: NavItem[] = [
  { key: "nav.newsReels", href: "/news", icon: Newspaper },
  { key: "nav.churches", href: "/churches", icon: Church },
  { key: "nav.events", href: "/events", icon: CalendarDays },
  { key: "nav.live", href: "/live", icon: Radio },
];

const personalNav: NavItem[] = [
  { key: "nav.library", href: "/library", icon: Library },
  { key: "nav.settings", href: "/settings", icon: Settings },
];

const mobileNav: NavItem[] = [
  { key: "nav.home", href: "/", icon: Home },
  { key: "nav.music", href: "/music", icon: Headphones },
  { key: "nav.news", href: "/news", icon: Newspaper },
  { key: "nav.bible", href: "/bible", icon: BookOpen },
];

/** Everything the five-slot mobile bar cannot hold, behind "More". */
const moreNav: NavItem[] = [
  { key: "nav.search", href: "/search", icon: Search },
  { key: "nav.videos", href: "/videos", icon: Video },
  { key: "nav.hymns", href: "/hymns", icon: ListMusic },
  { key: "nav.sermons", href: "/sermons", icon: Mic2 },
  { key: "nav.churches", href: "/churches", icon: Church },
  { key: "nav.events", href: "/events", icon: CalendarDays },
  { key: "nav.live", href: "/live", icon: Radio },
  { key: "nav.library", href: "/library", icon: Library },
  { key: "nav.settings", href: "/settings", icon: Settings },
];

/** Pages that render without the shell's furniture. */
const AUTH_ROUTES = ["/signin", "/register", "/forgot-password", "/reset-password", "/policies"];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useI18n();
  const [menuPath, setMenuPath] = useState<string | null>(null);
  const menuOpen = menuPath === pathname;
  const [remindersOpen, setRemindersOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  // A "not set up yet" nudge, and nothing more. It clears the moment this browser
  // holds a subscription, and it never appears on a device that cannot do push at
  // all — a dot inviting someone to open something that cannot work is the same
  // lie as a tick that promises a reminder which never arrives.
  const [remindersHint, setRemindersHint] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  /**
   * `/reels` is a full-bleed page, not a section of the app.
   *
   * It is the one route where the shell's own furniture is the problem rather
   * than the frame: a full-bleed feed behind a sticky header, a desktop rail and
   * a bottom bar is a feed with three things covering the video, and the audio
   * mini-player on top of that is a second, competing player for a page whose
   * whole reason to exist is that it plays. So the page supplies its own header
   * and its own bottom bar, and the shell gets out of the way.
   */
  const immersive = pathname === "/reels" || pathname.startsWith("/reels/");

  /**
   * Signing in is the one page that should look like nothing else.
   *
   * A password box behind a sidebar, a search bar and a playing song is three
   * things asking for attention at the moment someone is trying to type. So the
   * auth routes and the policy pages render bare: no rail, no player, no bottom
   * bar, just the page.
   */
  const bare = AUTH_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`));

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!pushSupported()) return;
      const subscription = await existingSubscription().catch(() => null);
      if (!cancelled) setRemindersHint(subscription === null);
    })();
    return () => {
      cancelled = true;
    };
    // Re-checked when the modal closes, so finishing setup clears the dot without
    // a reload.
  }, [remindersOpen]);

  useEffect(() => {
    function focusSearch(event: KeyboardEvent) {
      if (event.key === "/" && document.activeElement?.tagName !== "INPUT") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

  if (bare) return <>{children}</>;

  if (immersive) {
    return (
      <>
        {children}
        {/*
          The mini-player is not merely hidden here, it is stopped: `stop` is an
          effect inside the player rather than a CSS rule, so leaving it running
          would keep a second audio stream alive behind the feed and, on a phone,
          fight the reel for the audio focus YouTube needs to play at all.
        */}
        <MiniPlayer pathname={pathname} suspended={immersive} />
      </>
    );
  }

  return (
    <div className="min-h-screen bg-canvas text-ink">
      {/* `fixed`, and nothing else: `relative` and `fixed` on one element cancel
          out — the stylesheet emits `.relative` after `.fixed`, so the rail was
          falling into page flow while the content column still reserved its
          width, and the whole page began a rail-width past the sidebar. A fixed
          element is a positioned ancestor on its own, so the gradient layer
          inside does not need `relative` either. */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[252px] flex-col overflow-hidden bg-ink-fill text-white lg:flex">
        {/*
          A gradient and one warm light behind the rail, rather than a flat slab.
          The nav used to sit on a single dark fill with an absolutely positioned
          card floating over the scroll area; now the light is part of the
          background and the footer is in the flow, so nothing can overlap the
          last item in the list however long that list grows.
        */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_75%_at_0%_0%,rgba(182,137,53,0.22)_0%,rgba(182,137,53,0)_55%),linear-gradient(180deg,#23221b_0%,#1f1e19_46%,#1a1913_100%)]"
        />
        <div className="relative flex h-[86px] shrink-0 items-center px-6">
          <Brand />
        </div>
        <nav className="no-scrollbar relative flex-1 overflow-y-auto px-4 pb-3 pt-1" aria-label={t("aria.primaryNav")}>
          <NavGroup items={primaryNav} pathname={pathname} />
          <NavGroup label={t("group.discover")} items={discoverNav} pathname={pathname} />
          <NavGroup label={t("group.yourSpace")} items={personalNav} pathname={pathname} />
          <Signature />
        </nav>
        <div className="relative shrink-0 space-y-2.5 px-4 pb-6 pt-2">
          <div className="rounded-2xl border border-white/8 bg-white/[0.05] p-3.5">
            <div className="mb-2 flex items-center gap-2 text-[11.5px] font-semibold text-gold-light">
              <Sparkles size={14} />
              <span>{t("reminder.title")}</span>
            </div>
            <p className="text-[12.5px] leading-5 text-white/60">{t("reminder.body")}</p>
          </div>
          <AccountCard />
        </div>
      </aside>

      <div className="lg:pl-[252px]">
        <header className="sticky top-0 z-30 flex h-[72px] items-center border-b border-line/80 bg-canvas/92 px-4 backdrop-blur-xl sm:px-6 lg:h-[86px] lg:px-8 xl:px-10">
          <button
            type="button"
            onClick={() => setMenuPath(pathname)}
            className="mr-3 grid size-11 place-items-center rounded-xl border border-line bg-surface text-ink lg:hidden"
            aria-label={t("aria.openNavigation")}
          >
            <Menu size={21} />
          </button>
          <div className="lg:hidden">
            <Brand compact />
          </div>
          <form
            className="mx-auto hidden w-full max-w-[560px] md:block"
            onSubmit={submitSearch}
            action="/search"
          >
            <label className="relative block">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-ink-muted" size={18} />
              <input
                ref={searchRef}
                name="q"
                type="search"
                placeholder={t("header.searchPlaceholder")}
                className="h-12 w-full rounded-2xl border border-line bg-surface pl-11 pr-16 text-sm text-ink shadow-sm outline-none transition placeholder:text-ink-muted/80 focus:border-gold/70 focus:ring-4 focus:ring-gold/10"
              />
              <kbd className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg border border-line bg-canvas px-2 py-1 text-[11px] font-medium text-ink-muted">/</kbd>
            </label>
          </form>
          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            <Link
              href="/search"
              className="grid size-11 place-items-center rounded-xl border border-line bg-surface text-ink md:hidden"
              aria-label={t("aria.search")}
            >
              <Search size={20} />
            </Link>
            <LanguageMenu />
            <button
              type="button"
              onClick={() => setRemindersOpen(true)}
              className="relative grid size-10 place-items-center rounded-xl text-ink-soft transition hover:bg-surface"
              aria-label={t("aria.reminders")}
            >
              <Bell size={20} />
              {remindersHint ? <span className="absolute right-2 top-2 size-2 rounded-full border-2 border-canvas bg-terracotta" /> : null}
            </button>
            <AccountMenu />
          </div>
        </header>

        {/* Only clears the mobile nav bar now that the player dock is gone. */}
        <main className="min-h-[calc(100vh-86px)] px-4 pb-24 pt-5 sm:px-6 sm:pt-7 lg:px-8 lg:pb-12 xl:px-10">{children}</main>
      </div>

      <RemindersModal open={remindersOpen} onClose={() => setRemindersOpen(false)} />
      <MobileMenu open={menuOpen} onClose={() => setMenuPath(null)} pathname={pathname} />
      <MiniPlayer pathname={pathname} />
      <nav className="fixed inset-x-0 bottom-0 z-40 grid h-[68px] grid-cols-5 border-t border-line bg-surface/96 px-2 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden" aria-label={t("aria.mobileNav")}>
        {mobileNav.map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-col items-center justify-center gap-1 text-[10px] font-semibold transition ${
                active ? "text-sage" : "text-ink-muted"
              }`}
            >
              <span className={`grid h-7 w-10 place-items-center rounded-full ${active ? "bg-sage-soft" : ""}`}>
                <Icon size={19} strokeWidth={active ? 2.4 : 1.9} />
              </span>
              {t(item.key)}
            </Link>
          );
        })}
        {(() => {
          const active = moreNav.some((item) => (item.href === "/" ? pathname === "/" : pathname.startsWith(item.href)));
          return (
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              className={`flex flex-col items-center justify-center gap-1 text-[10px] font-semibold transition ${active ? "text-sage" : "text-ink-muted"}`}
            >
              <span className={`grid h-7 w-10 place-items-center rounded-full ${active ? "bg-sage-soft" : ""}`}>
                <Menu size={19} strokeWidth={active ? 2.4 : 1.9} />
              </span>
              {t("nav.more")}
            </button>
          );
        })()}
      </nav>

      <MobileMore
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        pathname={pathname}
      />

      {menuOpen ? <div className="fixed inset-0 z-50 bg-ink-fill/45 backdrop-blur-sm lg:hidden" onClick={() => setMenuPath(null)} /> : null}
    </div>
  );

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const query = String(form.get("q") ?? "").trim();
    router.push(query ? `/search?q=${encodeURIComponent(query)}` : "/search");
  }
}

function Brand({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();
  return (
    <Link href="/" className="flex items-center gap-3" aria-label="Hymnora SDA home">
      <span className={`relative grid shrink-0 place-items-center overflow-hidden rounded-[13px] bg-gold text-ink ${compact ? "size-9" : "size-11"}`}>
        <span className={`relative z-10 font-display font-semibold ${compact ? "text-xl" : "text-2xl"}`}>H</span>
        <span className="absolute -bottom-7 -right-5 size-12 rounded-full border border-ink/20" />
        <span className="absolute -bottom-5 -right-3 size-8 rounded-full border border-ink/20" />
      </span>
      <span className={compact ? "hidden sm:block" : "block"}>
        <span className={`block font-display font-semibold tracking-[-0.02em] ${compact ? "text-lg" : "text-[22px]"}`}>Hymnora <span className="text-gold">SDA</span></span>
        <span className={`block uppercase tracking-[0.18em] text-ink-muted ${compact ? "text-[8px]" : "text-[9px]"}`}>{t("brand.slogan")}</span>
      </span>
    </Link>
  );
}

/**
 * A hand, under Settings.
 *
 * Not a link, not a control, not an account: the builder's name signed under the
 * navigation, the way a letter is signed. It is deliberately inert — it has no
 * href and no handler, because making a signature clickable would turn it into
 * something it is not.
 */
function Signature() {
  return (
    <p
      aria-hidden="true"
      className="pointer-events-none -mt-3 pl-[26px] font-signature text-[19px] leading-none text-gold-light/75"
    >
      Gad.ontune
    </p>
  );
}

function NavGroup({
  label,
  items,
  pathname,
}: {
  label?: string;
  items: NavItem[];
  pathname: string;
}) {
  const { t } = useI18n();
  return (
    <div className="mb-6">
      {label ? (
        <p className="mb-2 px-3 text-[9.5px] font-semibold uppercase tracking-[0.2em] text-white/32">{label}</p>
      ) : null}
      <div className="space-y-0.5">
        {items.map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`group relative flex h-11 items-center gap-3 rounded-2xl px-3.5 text-[13.5px] font-medium transition-all duration-200 ${
                active
                  ? "bg-white/[0.11] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.09)]"
                  : "text-white/55 hover:translate-x-0.5 hover:bg-white/[0.055] hover:text-white"
              }`}
            >
              {/*
                The marker is a bar rather than a dot, and it grows out of the
                pill's left edge — the one place on a dark rail where an accent
                still reads at a glance from across the room.
              */}
              <span
                aria-hidden
                className={`absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-gold-light transition-all duration-200 ${
                  active ? "opacity-100" : "opacity-0"
                }`}
              />
              <span
                className={`grid size-7 place-items-center rounded-xl transition ${
                  active ? "bg-gold/20 text-gold-light" : "text-white/45 group-hover:text-white/80"
                }`}
              >
                <Icon size={17} strokeWidth={active ? 2.35 : 1.9} />
              </span>
              <span className="truncate">{t(item.key)}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}


function MobileMenu({ open, onClose, pathname }: { open: boolean; onClose: () => void; pathname: string }) {
  const [profile, setProfile] = useState({ name: "Guest", location: "Set your location" });
  const { t } = useI18n();

  useEffect(() => {
    getHomeData()
      .then((data) =>
        setProfile({
          name: data.greeting.name && data.greeting.name !== "Guest" ? data.greeting.name : "Guest",
          location: data.greeting.locationLabel,
        }),
      )
      .catch(() => undefined);
  }, []);

  const displayName = profile.name === "Guest" ? "Guest" : profile.name;
  const locationLabel = profile.location;
  const initials = displayName === "Guest" ? "G" : displayName.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("");

  return (
    /*
      Rounded on the right, square on the left: the drawer is hinged to the edge
      of the screen, so rounding the edge that touches the screen reads as a
      mistake, while rounding the free edge reads as a sheet sliding in. The
      corners themselves are large and the shadow is soft — a 360px black slab
      with hard corners is a menu from 2012.
    */
    <div
      className={`fixed inset-y-0 left-0 z-[60] flex w-[84%] max-w-[318px] flex-col overflow-hidden rounded-r-[28px] bg-ink-fill p-4 text-white shadow-[18px_0_50px_rgba(20,18,12,0.35)] transition-transform duration-300 ease-out lg:hidden ${
        open ? "translate-x-0" : "-translate-x-full"
      }`}
    >
      {/* The same warm light the desktop rail has, so the drawer and the sidebar
          are recognisably the same piece of furniture at two sizes. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_60%_at_0%_0%,rgba(182,137,53,0.2)_0%,rgba(182,137,53,0)_58%)]"
      />
      <div className="relative flex items-center justify-between">
        <Brand />
        <button type="button" onClick={onClose} className="grid size-10 place-items-center rounded-xl bg-white/8" aria-label={t("aria.closeNavigation")}>
          <X size={20} />
        </button>
      </div>
      <div className="no-scrollbar relative mt-8 flex-1 overflow-y-auto">
        <NavGroup items={primaryNav} pathname={pathname} />
        <NavGroup label={t("group.discover")} items={discoverNav} pathname={pathname} />
        <NavGroup label={t("group.yourSpace")} items={personalNav} pathname={pathname} />
        <Signature />
      </div>
      <div className="relative mt-5 shrink-0 space-y-2.5">
        <div className="rounded-2xl border border-white/8 bg-white/[0.05] p-3.5">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-sage text-sm font-semibold">{initials}</span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{displayName}</p>
              <p className="truncate text-xs text-white/45">{locationLabel}</p>
            </div>
          </div>
        </div>
        <AccountCard />
      </div>
    </div>
  );
}

function MobileMore({ open, onClose, pathname }: { open: boolean; onClose: () => void; pathname: string }) {
  const { t } = useI18n();
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-end lg:hidden">
      <div className="absolute inset-0 bg-ink-fill/45 backdrop-blur-sm" onClick={onClose} />
      <div className="fade-up relative z-10 max-h-[80vh] w-full overflow-y-auto rounded-t-[28px] border-t border-line bg-surface p-5 pb-[calc(env(safe-area-inset-bottom)+20px)] shadow-lift">
        <div className="mb-4 flex items-center justify-between">
          <p className="font-display text-lg font-semibold text-ink">{t("nav.more")}</p>
          <button type="button" onClick={onClose} className="grid size-9 place-items-center rounded-full bg-canvas text-ink-soft" aria-label={t("aria.closeNavigation")}>
            <X size={18} />
          </button>
        </div>
        <div className="grid grid-cols-3 gap-2.5">
          {moreNav.map((item) => {
            const Icon = item.icon;
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link key={item.href} href={item.href} onClick={onClose} className={`flex flex-col items-center gap-2 rounded-2xl border p-4 text-center text-xs font-semibold transition ${active ? "border-sage bg-sage-soft text-sage" : "border-line bg-canvas text-ink-soft"}`}>
                <Icon size={20} />
                {t(item.key)}
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/**
 * The language switcher.
 *
 * Where the silent "EN" pill used to sit. It is a real control now: the current
 * language's code opens a short menu of the four platform languages, each named
 * in its own language, and picking one re-translates the chrome through the i18n
 * provider while this browser remembers the choice and the account gets a copy.
 */
function LanguageMenu() {
  const { language, setLanguage } = useI18n();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onOutside = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onOutside);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onOutside);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative hidden sm:block">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`flex h-10 items-center gap-2 rounded-xl px-3 text-sm font-semibold transition ${open ? "bg-surface text-ink" : "text-ink-soft hover:bg-surface"}`}
      >
        {LANGUAGE_CODES[language].toUpperCase()}
        <ChevronDown size={14} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? (
        <div role="listbox" aria-label="Language" className="absolute right-0 top-[calc(100%+8px)] z-50 w-48 rounded-2xl border border-line bg-surface p-1.5 shadow-lift">
          {LANGUAGES.map((item) => {
            const active = item === language;
            return (
              <button
                key={item}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  setLanguage(item);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition ${
                  active ? "bg-sage-soft text-sage" : "text-ink-soft hover:bg-canvas hover:text-ink"
                }`}
              >
                {LANGUAGE_NAMES[item]}
                {active ? <Check size={15} /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
