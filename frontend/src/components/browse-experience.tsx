"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { ArrowLeft, Pause, Play } from "lucide-react";
import { useHymnora } from "@/components/hymnora-provider";
import { browseMusicData } from "@/lib/data";
import { formatClock } from "@/lib/format";
import { imgSrc } from "@/lib/image";
import type { MusicFacets, MusicTrack } from "@/lib/types";

const FALLBACK_ART = "/images/music-studio.jpg";

/**
 * A filtered slice of the catalogue.
 *
 * This is where the Worship Journey and the chips lead. It is a real query against
 * `/api/music/browse` rather than a client-side filter over a fetched list, so the
 * count in the heading is the count the server would return for the whole match,
 * not the length of one page of it.
 */
export function BrowseExperience({
  title,
  description,
  initial,
  initialTotal,
  facets,
  category,
  region,
}: {
  title: string;
  description: string;
  initial: MusicTrack[];
  initialTotal: number;
  facets: MusicFacets;
  category: string;
  region: string;
}) {
  const [tracks, setTracks] = useState(initial);
  const [total, setTotal] = useState(initialTotal);
  const [categoryId, setCategoryId] = useState(category);
  const [regionId, setRegionId] = useState(region);
  const [loading, startTransition] = useTransition();
  const { playTracks, currentTrack, isPlaying } = useHymnora();

  useEffect(() => {
    let cancelled = false;
    startTransition(async () => {
      try {
        const next = await browseMusicData({ category: categoryId, region: regionId, limit: 40 });
        if (cancelled) return;
        setTracks(next.items);
        setTotal(next.total);
      } catch {
        // Keep what is on screen; see the note in `video-experience.tsx`.
      }
    });
    return () => {
      cancelled = true;
    };
  }, [categoryId, regionId]);

  const categories = [{ category: "", label: "Everything" }, ...facets.categories.map((item) => ({
    category: item.category,
    label: item.category,
    count: item.count,
  }))];
  const regions = [{ region: "", label: "Everywhere" }, ...facets.regions.map((item) => ({
    region: item.region,
    label: item.label,
    count: item.count,
  }))];

  return (
    <div className="fade-up mx-auto max-w-[1100px]">
      <Link
        href="/music"
        className="mb-6 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-muted transition hover:text-ink"
      >
        <ArrowLeft size={15} /> All music
      </Link>

      <header className="mb-7">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-gold">Browsing</p>
        <h1 className="mt-2 font-display text-[32px] font-semibold leading-none tracking-[-0.04em] sm:text-[40px]">
          {title}
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-ink-muted">{description}</p>
      </header>

      <div className="no-scrollbar mb-6 flex gap-2 overflow-x-auto pb-1">
        {categories.map((item) => (
          <button
            key={item.category || "all"}
            type="button"
            onClick={() => setCategoryId(item.category)}
            aria-pressed={categoryId === item.category}
            className={`shrink-0 rounded-full px-3.5 py-2 text-sm font-semibold capitalize transition ${
              categoryId === item.category
                ? "bg-ink-fill text-white"
                : "border border-line bg-surface text-ink-muted hover:border-gold/50 hover:text-ink"
            }`}
          >
            {item.label}
            {"count" in item ? <span className="ml-1.5 text-xs tabular-nums opacity-60">{item.count}</span> : null}
          </button>
        ))}
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-2">
        {regions.map((item) => (
          <button
            key={item.region || "all"}
            type="button"
            onClick={() => setRegionId(item.region)}
            aria-pressed={regionId === item.region}
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
              regionId === item.region
                ? "border-sage bg-sage-soft text-sage"
                : "border-line bg-surface text-ink-muted hover:border-gold/50"
            }`}
          >
            {item.label}
            {"count" in item ? <span className="ml-1.5 tabular-nums opacity-60">{item.count}</span> : null}
          </button>
        ))}
        <span className="ml-auto text-sm tabular-nums text-ink-muted">
          {loading ? "Loading…" : `${total} ${total === 1 ? "recording" : "recordings"}`}
        </span>
      </div>

      {tracks.length === 0 ? (
        <div className="rounded-[22px] border border-dashed border-line bg-surface p-12 text-center text-sm text-ink-muted">
          Nothing here yet. Try a different category or region.
        </div>
      ) : (
        <div className={`rounded-[22px] border border-line bg-surface p-2 sm:p-3 ${loading ? "opacity-60" : ""}`}>
          {tracks.map((track, index) => (
            <BrowseLine key={track.id} track={track} index={index} playing={isPlaying} currentId={currentTrack?.id ?? null} onPlay={(at) => playTracks(tracks, at)} />
          ))}
        </div>
      )}
    </div>
  );
}

function BrowseLine({
  track,
  index,
  playing,
  currentId,
  onPlay,
}: {
  track: MusicTrack;
  index: number;
  playing: boolean;
  currentId: string | null;
  onPlay: (index: number) => void;
}) {
  const active = currentId === track.id && playing;
  return (
    <div className={`group flex items-center gap-3 rounded-2xl px-2.5 py-2 transition sm:gap-4 sm:px-3 ${active ? "bg-surface-soft" : "hover:bg-surface-soft"}`}>
      <button
        type="button"
        onClick={() => onPlay(index)}
        aria-label={active ? `Pause ${track.title}` : `Play ${track.title}`}
        className="flex min-w-0 flex-1 items-center gap-3 text-left sm:gap-4"
      >
        <span className="w-5 shrink-0 text-center text-xs tabular-nums text-ink-muted">{index + 1}</span>
        <span className="relative size-11 shrink-0 overflow-hidden rounded-xl">
          <Image src={imgSrc(track.image, FALLBACK_ART)} alt="" fill sizes="44px" className="object-cover warm-image" />
          <span className="absolute inset-0 grid place-items-center bg-ink-fill/45 text-white opacity-0 transition group-hover:opacity-100">
            {active ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" className="translate-x-px" />}
          </span>
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-sm font-semibold ${active ? "text-terracotta" : "text-ink"}`}>{track.title}</span>
          <span className="mt-0.5 block truncate text-xs text-ink-muted">{track.artist}</span>
        </span>
        <span className="hidden shrink-0 rounded-full bg-surface-soft px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.1em] text-ink-soft sm:inline">
          {track.subCategory ?? track.genre ?? "Music"}
        </span>
        <span className="w-10 shrink-0 text-right text-xs tabular-nums text-ink-muted">
          {track.duration || formatClock(0)}
        </span>
      </button>
    </div>
  );
}
