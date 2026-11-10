"use client";

import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  CalendarDays,
  ChevronRight,
  Clock3,
  Compass,
  Headphones,
  MapPin,
  Play,
  Radio,
  Sparkles,
  Sunrise,
  UsersRound,
} from "lucide-react";
import { BibleSpotlight } from "@/components/bible-spotlight";
import { ContentCard } from "@/components/content-card";
import { SectionHeading } from "@/components/section-heading";
import { useHymnora } from "@/components/hymnora-provider";
import { getHomeData } from "@/lib/data";
import type { HomeDashboard } from "@/lib/types";
import { useState, useEffect } from "react";
import { imgSrc } from "../lib/image";

const quickLinks = [
  { label: "Music", href: "/music", icon: Headphones, note: "Listen" },
  { label: "Hymns", href: "/hymns", icon: Sparkles, note: "Read" },
  { label: "Bible", href: "/bible", icon: Sunrise, note: "Reflect" },
  { label: "Sermons", href: "/sermons", icon: Radio, note: "Watch" },
  { label: "Churches", href: "/churches", icon: UsersRound, note: "Find" },
  { label: "Events", href: "/events", icon: CalendarDays, note: "Gather" },
];

/** Accent cycle for the daily-path rows, matching the original three-icon rhythm. */
const pathTones = [
  "bg-sage-soft text-sage",
  "bg-gold-soft text-gold",
  "bg-terracotta-soft text-terracotta",
  "bg-sage-soft text-sage",
];

const pathIcons: Record<string, typeof Headphones> = {
  sunrise: Sunrise,
  book: BookIcon,
  hands: Sparkles,
  leaf: Sparkles,
  radio: Radio,
  clock: Clock3,
  "book-open": BookIcon,
  download: ArrowRight,
};

function salutation(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export default function Home() {
  const { playTrack, isPlaying, currentTrack } = useHymnora();
  const [home, setHome] = useState<HomeDashboard | null>(null);

  useEffect(() => {
    getHomeData().then(setHome).catch(() => setHome(null));
  }, []);

  const heroTrack = home?.hero ?? null;
  const continueRail = home?.continueListening.length ? home.continueListening : home?.popularMusic ?? [];
  const tracks = home?.popularMusic ?? [];
  const newsItems = home?.latestNews ?? [];
  const events = home?.upcomingEvents ?? [];
  const greetingName = home?.greeting.name && home.greeting.name !== "Guest" ? `, ${home.greeting.name}` : "";

  const heroPlaying = currentTrack?.id === heroTrack?.id && isPlaying;

  return (
    <div className="fade-up mx-auto max-w-[1440px]">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-ink-muted">{home?.greeting.dateLabel ?? "—"}</p>
          <h1 className="mt-1 font-display text-[28px] font-semibold tracking-[-0.03em] text-ink sm:text-[34px]">{salutation()}{greetingName}</h1>
          {home ? (
            <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-xs text-ink-muted">
              <span>{home.stats.tracks} pieces of music</span><span className="text-line">·</span>
              <span>{home.stats.hymns.toLocaleString()} hymns</span><span className="text-line">·</span>
              <span>{home.stats.sermons} sermons</span>
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {home && home.stats.liveNow > 0 ? (
            <Link href="/live" className="flex h-10 items-center gap-2 rounded-xl bg-terracotta px-3.5 text-sm font-semibold text-white shadow-lift transition hover:bg-terracotta/90">
              <span className="relative flex size-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white/70" /><span className="relative inline-flex size-2 rounded-full bg-white" /></span>
              {home.stats.liveNow} {home.stats.liveNow === 1 ? "service" : "services"} live now
            </Link>
          ) : null}
          <button type="button" className="hidden items-center gap-2 rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm font-medium text-ink-soft transition hover:border-gold/50 sm:flex">
            <MapPin size={16} className="text-terracotta" />
            {home?.greeting.locationLabel ?? "Set your location"}
            <ChevronRight size={15} className="text-ink-muted" />
          </button>
        </div>
      </div>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(310px,0.72fr)]">
        <div className="group relative min-h-[365px] overflow-hidden rounded-[26px] bg-ink-fill shadow-soft sm:min-h-[410px]">
          <Image src={heroTrack?.image || "/images/church.jpg"} alt="A worship gathering in warm evening light" fill priority sizes="(max-width: 1280px) 100vw, 60vw" className="object-cover warm-image transition duration-700 group-hover:scale-105" />
          <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(22,22,18,0.94)_0%,rgba(22,22,18,0.72)_42%,rgba(22,22,18,0.18)_100%)]" />
          <div className="absolute inset-0 bg-[linear-gradient(0deg,rgba(22,22,18,0.88)_0%,transparent_55%)]" />
          {heroTrack?.isLive ? (
            <span className="absolute left-6 top-6 flex items-center gap-2 rounded-full bg-terracotta px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-white shadow-lift">
              <span className="size-1.5 animate-pulse rounded-full bg-white" /> Live
            </span>
          ) : null}
          <div className="relative flex h-full max-w-[590px] flex-col justify-between p-6 sm:p-9 lg:p-11">
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-gold-light">
              <span className="h-px w-8 bg-gold-light" />
              Featured gathering
            </div>
            <div className="mt-16 sm:mt-24">
              <p className="mb-3 text-sm font-medium text-white/65">{heroTrack ? `${heroTrack.title} · ${heroTrack.artist}` : "Loading today's gathering…"}</p>
              <h2 className="max-w-lg font-display text-[40px] font-semibold leading-[0.98] tracking-[-0.045em] text-white sm:text-[57px]">Worship beyond music.</h2>
              <p className="mt-4 max-w-md text-[15px] leading-6 text-white/68">A live gathering for anyone who wants to pause, listen and be made whole.</p>
              <div className="mt-7 flex flex-wrap items-center gap-3">
                <button type="button" onClick={() => heroTrack && playTrack(heroTrack)} className="inline-flex h-12 items-center gap-2 rounded-xl bg-gold px-5 text-sm font-bold text-ink transition hover:bg-gold-light">
                  {heroPlaying ? <span className="text-base">Ⅱ</span> : <Play size={16} fill="currentColor" />}
                  {heroPlaying ? "Playing now" : "Watch gathering"}
                </button>
                <Link href="/live" className="inline-flex h-12 items-center gap-2 rounded-xl border border-white/20 px-5 text-sm font-semibold text-white transition hover:border-white/50 hover:bg-white/10">See live details <ArrowRight size={16} /></Link>
              </div>
            </div>
          </div>
          <div className="absolute bottom-7 right-7 hidden items-center gap-2 rounded-full border border-white/15 bg-ink-fill/35 px-3 py-2 text-[11px] font-semibold text-white/80 backdrop-blur-md sm:flex">
            <span className="size-2 rounded-full bg-terracotta" />
            {heroTrack?.listenersLabel ?? (home ? `${home.stats.liveNow} live now` : "—")}
          </div>
        </div>

        <div className="flex flex-col rounded-[26px] border border-line bg-surface p-6 shadow-soft sm:p-7">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-gold">Your day, gathered</p>
              <h2 className="mt-2 font-display text-[28px] font-semibold leading-tight tracking-[-0.03em]">A little room to begin.</h2>
            </div>
            <div className="grid size-11 place-items-center rounded-2xl bg-gold-soft text-gold"><Sunrise size={21} /></div>
          </div>
          <p className="mt-4 text-sm leading-6 text-ink-muted">A few thoughtful paths for wherever you are in the day.</p>
          <div className="mt-6 divide-y divide-line/80">
            {(home?.dailyPaths ?? []).slice(0, 3).map((path, index) => {
              const PathIcon = pathIcons[path.icon] ?? BookIcon;
              return <Link key={`${path.label}-${index}`} href={path.href} className={`group flex items-center gap-3 py-4 ${index === 2 ? "pb-0" : index === 0 ? "first:pt-0" : ""}`}>
                <span className={`grid size-10 place-items-center rounded-xl ${pathTones[index % pathTones.length]}`}><PathIcon size={18} /></span>
                <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{path.label}</span><span className="mt-0.5 block text-xs text-ink-muted">{path.detail}</span></span>
                <ChevronRight size={17} className="text-ink-muted transition group-hover:translate-x-1 group-hover:text-sage" />
              </Link>;
            })}
          </div>
          <div className="mt-auto border-t border-line/80 pt-5"><p className="text-xs leading-5 text-ink-muted"><span className="font-semibold text-ink">A gentle rhythm:</span> pause between things, not just after them.</p></div>
        </div>
      </section>

      <section className="mt-10">
        <SectionHeading eyebrow="Find your way" title="What are you looking for?" />
        <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-6 sm:gap-3">
          {quickLinks.map((item) => {
            const Icon = item.icon;
            return <Link key={item.label} href={item.href} className="group flex flex-col items-center gap-2 rounded-2xl border border-line bg-surface px-2 py-4 text-center transition hover:-translate-y-0.5 hover:border-gold/60 hover:shadow-soft sm:py-5">
              <span className="grid size-11 place-items-center rounded-2xl bg-surface-soft text-ink-soft transition group-hover:bg-gold-soft group-hover:text-gold"><Icon size={20} /></span>
              <span className="text-xs font-semibold text-ink">{item.label}</span>
              <span className="text-[10px] text-ink-muted">{item.note}</span>
            </Link>;
          })}
        </div>
      </section>

      <section className="mt-11">
        <SectionHeading eyebrow="Pick up where you left off" title="Continue listening" action={{ label: "View history", href: "/library" }} />
        <div className="no-scrollbar -mx-4 flex gap-4 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:px-6 lg:-mx-0 lg:px-0">
          {continueRail.slice(0, 4).map((track) => <ContentCard key={track.id} track={track} href={track.kind === "hymn" ? "/hymns" : "/music"} compact />)}
        </div>
      </section>

      <section className="mt-11 grid gap-5 xl:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)]">
        <BibleSpotlight />
        <div className="relative overflow-hidden rounded-[26px] bg-sage p-6 text-white shadow-soft sm:p-8">
          <div className="absolute -right-14 -top-20 size-64 rounded-full border border-white/10" />
          <div className="absolute -right-5 -top-8 size-40 rounded-full border border-white/10" />
          <div className="relative">
            <div className="flex items-center justify-between"><span className="rounded-full border border-white/20 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-gold-light">Curated for you</span><Compass size={21} className="text-white/50" /></div>
            <h2 className="mt-16 max-w-sm font-display text-[32px] font-semibold leading-tight tracking-[-0.035em] sm:mt-24 sm:text-[39px]">A worship session with a little more sky.</h2>
            <p className="mt-3 max-w-sm text-sm leading-6 text-white/68">A quiet sequence for the space between one thing and the next.</p>
            <Link href="/music" className="mt-7 inline-flex h-11 items-center gap-2 rounded-xl bg-white px-4 text-sm font-bold text-sage transition hover:bg-gold-soft">Open session <ArrowRight size={16} /></Link>
          </div>
        </div>
        <div className="rounded-[26px] border border-line bg-surface p-6 shadow-soft sm:p-8">
          <div className="flex items-center justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-gold">Today&apos;s SDA news</p><h2 className="mt-1.5 font-display text-[25px] font-semibold tracking-[-0.025em]">Stories to carry with you</h2></div><Link href="/news" className="grid size-10 place-items-center rounded-xl bg-surface-soft text-ink-soft transition hover:bg-gold-soft hover:text-gold"><ArrowRight size={18} /></Link></div>
          <div className="mt-5 space-y-1">
            {newsItems.slice(0, 3).map((item) => <Link key={item.id} href="/news" className="group flex gap-3 border-b border-line/70 py-3.5 last:border-0 last:pb-0"><div className="relative size-14 shrink-0 overflow-hidden rounded-xl"><Image src={imgSrc(item.image, "/images/golden-hour.jpg")} alt="" fill sizes="56px" className="object-cover warm-image" /></div><div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-terracotta">{item.category}</p><p className="mt-1 line-clamp-2 text-sm font-semibold leading-5 text-ink group-hover:text-sage">{item.title}</p><p className="mt-1 text-[11px] text-ink-muted">{item.date} · {item.readTime}</p></div></Link>)}
          </div>
        </div>
      </section>

      <section className="mt-11">
        <SectionHeading eyebrow="Find your sound" title="Popular SDA music" description="Singable stories, reverent rhythms and voices from across the community." action={{ label: "Explore music", href: "/music" }} />
        <div className="no-scrollbar -mx-4 flex gap-4 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:px-6 lg:-mx-0 lg:px-0">
          {tracks.slice(0, 5).map((track) => <ContentCard key={track.id} track={track} href="/music" compact />)}
        </div>
      </section>

      <section className="mt-11 grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(300px,0.62fr)]">
        <div className="rounded-[26px] border border-line bg-surface p-6 shadow-soft sm:p-8">
          <div className="flex items-end justify-between gap-4"><div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-gold">Make a little time</p><h2 className="mt-1.5 font-display text-[26px] font-semibold tracking-[-0.025em]">Upcoming near you</h2></div><Link href="/events" className="text-sm font-semibold text-sage hover:text-ink">See all</Link></div>
          <div className="mt-5 space-y-1">
            {events.slice(0, 3).map((event) => <Link key={event.id} href="/events" className="group flex items-center gap-4 border-b border-line/70 py-4 first:pt-1 last:border-0 last:pb-0"><div className="w-12 shrink-0 text-center"><p className="font-display text-2xl font-semibold leading-none text-ink">{event.day}</p><p className="mt-1 text-[9px] font-bold tracking-[0.15em] text-terracotta">{event.month}</p></div><div className="relative hidden size-14 shrink-0 overflow-hidden rounded-xl sm:block"><Image src={imgSrc(event.image, "/images/community.jpg")} alt="" fill sizes="56px" className="object-cover warm-image" /></div><div className="min-w-0 flex-1"><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-sage">{event.category}</p><p className="mt-1 truncate text-sm font-semibold text-ink group-hover:text-sage">{event.title}</p><p className="mt-1 flex items-center gap-1 text-xs text-ink-muted"><Clock3 size={12} />{event.time} · {event.place}</p></div><ChevronRight size={17} className="shrink-0 text-ink-muted transition group-hover:translate-x-1 group-hover:text-sage" /></Link>)}
          </div>
        </div>
        <div className="relative overflow-hidden rounded-[26px] bg-ink-fill p-6 text-white shadow-soft sm:p-8">
          <div className="absolute -bottom-20 -right-14 size-64 rounded-full border border-gold/20" /><div className="absolute -bottom-10 -right-4 size-40 rounded-full border border-gold/20" />
          <div className="relative flex h-full flex-col"><div className="flex items-center justify-between"><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-gold-light">For the road with you</p><Headphones size={20} className="text-white/45" /></div><h2 className="mt-16 max-w-xs font-display text-[29px] font-semibold leading-tight">Take your worship with you.</h2><p className="mt-3 text-sm leading-6 text-white/58">Save a song, a sermon or a whole playlist for the moments that need you.</p><Link href="/library" className="mt-auto pt-8 text-sm font-semibold text-gold-light hover:text-white">Open your library <ArrowRight className="ml-1 inline" size={15} /></Link></div>
        </div>
      </section>

      <section className="mt-11 rounded-[26px] border border-line bg-surface-soft/70 p-5 sm:p-7">
        <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-center"><div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-sage">A note for the week</p><h2 className="mt-1.5 font-display text-[25px] font-semibold tracking-[-0.025em]">You don&apos;t have to carry everything today.</h2><p className="mt-2 text-sm text-ink-muted">Choose one small next step. The rest can wait its turn.</p></div><Link href="/bible" className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-sage px-4 text-sm font-bold text-white transition hover:bg-ink-fill">Read with us <ArrowRight size={16} /></Link></div>
      </section>
    </div>
  );
}

function BookIcon() {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5z" /><path d="M4 5.5v16M8 7h8M8 11h8" /></svg>;
}
