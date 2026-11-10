"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowRight, CalendarDays, Church, Headphones, ListMusic, Mic2, Newspaper, Search, SlidersHorizontal, Sparkles, Video } from "lucide-react";
import { useMemo, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { FavoriteButton } from "@/components/favorite-button";
import { PageIntro } from "@/components/page-intro";
import { PlayButton } from "@/components/play-button";
import { getSearchData, getTracksData } from "@/lib/data";
import type { SearchResult, Track } from "@/lib/types";
import { imgSrc } from "../lib/image";

const tabs = ["All", "Music", "Videos", "Hymns", "Sermons", "News", "Churches", "Events", "Bible"];

export function SearchExperience() {
  const router = useRouter();
  const params = useSearchParams();
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [tab, setTab] = useState("All");
  const [language, setLanguage] = useState("All");
  const [availability, setAvailability] = useState("Any");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [searchResult, setSearchResult] = useState<{ q: string; items: SearchResult[] } | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);

  useEffect(() => {
    getTracksData().then(setTracks).catch(() => setTracks([]));
  }, []);

  const normalized = query.trim().toLowerCase();

  useEffect(() => {
    if (!normalized) return;
    let cancelled = false;
    getSearchData(query)
      .then((data) => {
        if (!cancelled) setSearchResult({ q: query, items: data ?? [] });
      })
      .catch(() => {
        if (!cancelled) setSearchResult({ q: query, items: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [query, normalized]);

  // While a new search is in flight the previous items stay on screen; the
  // `matchesQuery` filter below trims them to the current text anyway, which
  // is the same behaviour the page had when it kept results in state.
  const searchResults = useMemo(() => (normalized ? (searchResult?.items ?? []) : []), [normalized, searchResult]);

  const results = useMemo(() => {
    if (!normalized) return [];
    return searchResults.filter((item) => {
      const matchesTab = tab === "All" || item.type === tab;
      const matchesQuery = !normalized || `${item.title} ${item.subtitle} ${item.meta}`.toLowerCase().includes(normalized);
      const matchesLanguage = language === "All" || item.meta.toLowerCase().includes(language.toLowerCase());
      const matchesAvailability = availability === "Any"
        || availability === "Live" && (item.meta.toLowerCase().includes("live") || item.type === "Events")
        || availability === "Replay" && (item.type === "Sermons" || item.type === "Videos")
        || availability === "Downloadable" && (item.type === "Music" || item.type === "Hymns");
      return matchesTab && matchesQuery && matchesLanguage && matchesAvailability;
    });
  }, [availability, language, normalized, tab, searchResults]);
  const suggested = tracks.slice(0, 3);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    router.push(query.trim() ? `/search?q=${encodeURIComponent(query.trim())}` : "/search");
  }

  return (
    <div className="fade-up mx-auto max-w-[1440px]">
      <PageIntro eyebrow="One search, whole community" title="Find the thread you are following." description="Search across songs, hymns, Bible passages, sermons, churches, events and news. The connections are part of the point." />
      <form onSubmit={submit} className="relative mb-7"><Search className="absolute left-5 top-1/2 -translate-y-1/2 text-ink-muted" size={20} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Try 'John 3:16', 'Hymn 330' or 'Nairobi Central'" className="h-16 w-full rounded-[20px] border border-line bg-surface pl-14 pr-32 text-base shadow-soft outline-none transition placeholder:text-ink-muted/75 focus:border-gold/70 focus:ring-4 focus:ring-gold/10" /><button type="submit" className="absolute right-2 top-2 h-12 rounded-2xl bg-ink-fill px-5 text-sm font-bold text-white transition hover:bg-sage">Search</button></form>
      <div className="no-scrollbar mb-7 flex gap-2 overflow-x-auto pb-1">{tabs.map((item) => <button key={item} type="button" onClick={() => setTab(item)} className={`shrink-0 rounded-full px-4 py-2.5 text-sm font-semibold ${tab === item ? "bg-ink-fill text-white" : "border border-line bg-surface text-ink-muted"}`}>{item}</button>)}<button type="button" onClick={() => setFiltersOpen((current) => !current)} className={`ml-auto inline-flex shrink-0 items-center gap-2 rounded-full border px-4 py-2.5 text-sm font-semibold ${filtersOpen ? "border-sage bg-sage-soft text-sage" : "border-line bg-surface text-ink-muted"}`}><SlidersHorizontal size={15} /> Filters</button></div>
      {filtersOpen ? <div className="mb-7 flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-surface p-4"><span className="mr-2 text-xs font-bold uppercase tracking-[0.14em] text-ink-muted">Language</span>{["All", "English", "Kiswahili", "Instrumental"].map((item) => <button key={item} type="button" onClick={() => setLanguage(item)} className={`rounded-full px-3 py-2 text-xs font-semibold ${language === item ? "bg-sage text-white" : "bg-surface-soft text-ink-soft"}`}>{item}</button>)}<span className="ml-2 mr-2 h-5 w-px bg-line" /><span className="mr-2 text-xs font-bold uppercase tracking-[0.14em] text-ink-muted">Availability</span>{["Any", "Live", "Replay", "Downloadable"].map((item) => <button key={item} type="button" onClick={() => setAvailability(item)} className={`rounded-full px-3 py-2 text-xs font-semibold ${availability === item ? "bg-sage text-white" : "bg-surface-soft text-ink-soft"}`}>{item}</button>)}</div> : null}

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px]"><div><div className="mb-5 flex items-end justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-gold">{query ? "Search results" : "Suggested paths"}</p><h2 className="mt-1 font-display text-[27px] font-semibold tracking-[-0.03em]">{query ? <>Results for <span className="text-sage">&ldquo;{query}&rdquo;</span></> : "Start with something meaningful"}</h2></div><span className="text-xs text-ink-muted">{results.length} {results.length === 1 ? "result" : "results"}</span></div>{results.length ? <div className="space-y-3">{results.map((item) => <ResultRow key={`${item.type}-${item.id}`} item={item} tracks={tracks} />)}</div> : <EmptySearch query={query} onSuggestion={(value) => { setQuery(value); router.push(`/search?q=${encodeURIComponent(value)}`); }} />}</div><aside className="h-fit rounded-[24px] border border-line bg-surface p-5 shadow-soft sm:p-6"><div className="flex items-center gap-2"><Sparkles size={17} className="text-gold" /><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-gold">Search tip</p></div><h2 className="mt-2 font-display text-[24px] font-semibold">Follow a connection.</h2><p className="mt-2 text-sm leading-6 text-ink-muted">A name, place or verse can lead you from one kind of media to another.</p><div className="mt-5 space-y-2"><Suggestion icon={BookIcon} label="Bible reference" value="John 3:16" onClick={() => { setQuery("John 3:16"); router.push("/search?q=John+3%3A16"); }} /><Suggestion icon={ListMusic} label="Hymn number" value="Hymn 330" onClick={() => { setQuery("Hymn 330"); router.push("/search?q=Hymn+330"); }} /><Suggestion icon={Church} label="Place" value="Nairobi Central" onClick={() => { setQuery("Nairobi Central"); router.push("/search?q=Nairobi+Central"); }} /></div></aside></section>

      {!query ? <section className="mt-12"><div className="mb-5 flex items-end justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-gold">A gentle place to begin</p><h2 className="mt-1 font-display text-[27px] font-semibold">Some places to start</h2></div></div><div className="grid gap-4 sm:grid-cols-3">{suggested.map((track) => <div key={track.id} className="rounded-[22px] border border-line bg-surface p-3 shadow-soft"><div className="relative aspect-square overflow-hidden rounded-2xl"><Image src={imgSrc(track.image, "/images/music-studio.jpg")} alt="" fill sizes="(max-width: 640px) 100vw, 33vw" className="object-cover warm-image" /><div className="absolute bottom-3 right-3"><PlayButton track={track} className="size-10" /></div></div><div className="p-2"><p className="truncate font-semibold">{track.title}</p><p className="mt-1 text-xs text-ink-muted">{track.artist}</p></div></div>)}</div></section> : null}
    </div>
  );
}

function ResultRow({ item, tracks }: { item: SearchResult; tracks: Track[] }) {
  const track = tracks.find((candidate) => candidate.id === item.id) ?? { id: item.id, title: item.title, artist: item.subtitle, album: item.meta, image: item.image, duration: "Open", language: "English", kind: "video" };
  const Icon = item.type === "Music" ? Headphones : item.type === "Hymns" ? ListMusic : item.type === "Sermons" ? Mic2 : item.type === "News" ? Newspaper : item.type === "Churches" ? Church : item.type === "Events" ? CalendarDays : item.type === "Videos" ? Video : BookIcon;
  return <article className="group flex gap-3 rounded-[20px] border border-line bg-surface p-3 shadow-soft transition hover:border-gold/50 sm:gap-4 sm:p-4"><div className="relative size-20 shrink-0 overflow-hidden rounded-2xl sm:size-24"><Image src={imgSrc(item.image, "/images/golden-hour.jpg")} alt="" fill sizes="96px" className="object-cover warm-image transition duration-500 group-hover:scale-105" /><span className="absolute bottom-2 left-2 grid size-7 place-items-center rounded-lg bg-surface/90 text-ink-soft"><Icon size={14} /></span></div><div className="min-w-0 flex-1 py-0.5"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-[0.15em] text-terracotta">{item.type}</p><Link href={item.type === "Music" ? "/music" : item.type === "Hymns" ? "/hymns" : item.type === "Sermons" ? "/sermons" : item.type === "News" ? "/news" : item.type === "Churches" ? "/churches" : item.type === "Events" ? "/events" : item.type === "Bible" ? "/bible" : "/videos"} className="mt-1 block line-clamp-1 font-display text-[21px] font-semibold tracking-[-0.02em] transition hover:text-sage">{item.title}</Link><p className="mt-1 truncate text-sm text-ink-muted">{item.subtitle}</p><p className="mt-2 truncate text-xs text-ink-muted/80">{item.meta}</p></div><div className="flex shrink-0 items-center gap-2"><FavoriteButton id={item.id} className="size-8 bg-surface-soft text-ink-muted hover:bg-gold-soft hover:text-gold" /><PlayButton track={track} className="size-9" /></div></div></div></article>;
}

type IconComponent = React.ComponentType<{ size?: number; className?: string; strokeWidth?: number }>;

function Suggestion({ icon: Icon, label, value, onClick }: { icon: IconComponent; label: string; value: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="group flex w-full items-center gap-3 rounded-2xl p-2.5 text-left transition hover:bg-surface-soft"><span className="grid size-9 place-items-center rounded-xl bg-gold-soft text-gold"><Icon size={16} /></span><span className="min-w-0 flex-1"><span className="block text-[10px] font-bold uppercase tracking-[0.12em] text-ink-muted">{label}</span><span className="mt-0.5 block text-sm font-semibold">{value}</span></span><ArrowRight size={15} className="text-ink-muted transition group-hover:-translate-x-1 group-hover:translate-x-0.5 group-hover:text-sage" /></button>;
}

function EmptySearch({ query, onSuggestion }: { query: string; onSuggestion: (value: string) => void }) {
  return <div className="rounded-[24px] border border-line bg-surface p-8 text-center shadow-soft sm:p-12"><span className="mx-auto grid size-14 place-items-center rounded-2xl bg-gold-soft text-gold"><Search size={23} /></span><h2 className="mt-5 font-display text-[28px] font-semibold">Nothing exact yet.</h2><p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-ink-muted">We could not find a match for &ldquo;{query}&rdquo;. Try a hymn number, a Bible reference or a place name.</p><div className="mt-5 flex flex-wrap justify-center gap-2"><button type="button" onClick={() => onSuggestion("John 3:16")} className="rounded-full bg-sage-soft px-3.5 py-2 text-xs font-semibold text-sage">John 3:16</button><button type="button" onClick={() => onSuggestion("Hymn 330")} className="rounded-full bg-gold-soft px-3.5 py-2 text-xs font-semibold text-gold">Hymn 330</button><button type="button" onClick={() => onSuggestion("Nairobi Central")} className="rounded-full bg-terracotta-soft px-3.5 py-2 text-xs font-semibold text-terracotta">Nairobi Central</button></div></div>;
}

function BookIcon({ size = 16, className, strokeWidth = 1.8 }: { size?: number; className?: string; strokeWidth?: number }) {
  return <svg viewBox="0 0 24 24" width={size} height={size} className={className} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5z" /><path d="M4 5.5v16M8 7h8M8 11h8" /></svg>;
}
