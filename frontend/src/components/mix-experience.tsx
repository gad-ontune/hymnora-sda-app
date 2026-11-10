"use client";

import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Pause, Play } from "lucide-react";
import { useHymnora } from "@/components/hymnora-provider";
import { imgSrc } from "@/lib/image";
import { formatTotal } from "@/lib/format";
import type { MixDetail } from "@/lib/types";

const FALLBACK_ART = "/images/music-studio.jpg";

/**
 * One mix, in full. A bubble is a door into here, and this is where the whole
 * list is playable — the home page only carries the first ten tracks of each
 * row, so a bubble that started a queue from the row data would end early.
 */
export function MixExperience({ detail }: { detail: MixDetail }) {
  const { playTracks, currentTrack, isPlaying } = useHymnora();
  const { mix, tracks } = detail;

  if (!mix) notFound();

  const seconds = tracks.reduce((sum, track) => {
    const [minutes, rest] = track.duration.split(":");
    return sum + (Number(minutes) || 0) * 60 + (Number(rest) || 0);
  }, 0);
  const playing = isPlaying && tracks.some((track) => track.id === currentTrack?.id);

  return (
    <div className="fade-up mx-auto max-w-[1000px]">
      <Link
        href="/music"
        className="mb-6 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-muted transition hover:text-ink"
      >
        <ArrowLeft size={15} /> All music
      </Link>

      <header
        className="mb-8 overflow-hidden rounded-[26px] p-6 shadow-soft sm:p-9"
        style={{ backgroundImage: `linear-gradient(135deg, ${mix.gradient[0]}, ${mix.gradient[1]})` }}
      >
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/65">Mix</p>
            <h1 className="mt-2 font-display text-[32px] font-semibold leading-none tracking-[-0.04em] text-white sm:text-[42px]">
              {mix.title}
            </h1>
            <p className="mt-3 text-sm text-white/70">
              {mix.subtitle} · {tracks.length} {tracks.length === 1 ? "track" : "tracks"} ·{" "}
              {formatTotal(seconds)}
            </p>
          </div>
          <button
            type="button"
            onClick={() => playTracks(tracks, 0)}
            disabled={tracks.length === 0}
            className="inline-flex h-12 items-center gap-2 rounded-full bg-white px-6 text-sm font-bold text-ink transition hover:bg-white/90 disabled:opacity-50"
          >
            {playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
            {playing ? "Pause" : "Play all"}
          </button>
        </div>
      </header>

      {tracks.length === 0 ? (
        <div className="rounded-[22px] border border-dashed border-line bg-surface p-10 text-center text-sm text-ink-muted">
          Nothing in this mix yet.
        </div>
      ) : (
        <div className="rounded-[22px] border border-line bg-surface p-2 sm:p-3">
          {tracks.map((track, index) => (
            <MixLine key={track.id} track={track} index={index} queue={tracks} />
          ))}
        </div>
      )}
    </div>
  );
}

function MixLine({
  track,
  index,
  queue,
}: {
  track: MixDetail["tracks"][number];
  index: number;
  queue: MixDetail["tracks"];
}) {
  const { playTracks, currentTrack, isPlaying, isFavorite, toggleFavorite } = useHymnora();
  const active = currentTrack?.id === track.id && isPlaying;
  const favourite = isFavorite(track.id);

  return (
    <div
      className={`group flex items-center gap-3 rounded-2xl px-2.5 py-2 transition sm:gap-4 sm:px-3 ${
        active ? "bg-surface-soft" : "hover:bg-surface-soft"
      }`}
    >
      <button
        type="button"
        onClick={() => playTracks(queue, index)}
        aria-label={active ? `Pause ${track.title}` : `Play ${track.title}`}
        className="flex min-w-0 flex-1 items-center gap-3 text-left sm:gap-4"
      >
        <span className="w-5 shrink-0 text-center text-xs tabular-nums text-ink-muted">{index + 1}</span>
        <span className="relative size-11 shrink-0 overflow-hidden rounded-xl">
          <Image
            src={imgSrc(track.image, FALLBACK_ART)}
            alt=""
            fill
            sizes="44px"
            className="object-cover warm-image"
          />
          <span className="absolute inset-0 grid place-items-center bg-ink-fill/45 text-white opacity-0 transition group-hover:opacity-100">
            {active ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" className="translate-x-px" />}
          </span>
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-sm font-semibold ${active ? "text-terracotta" : "text-ink"}`}>{track.title}</span>
          <span className="mt-0.5 block truncate text-xs text-ink-muted">{track.artist}</span>
        </span>
        <span className="w-10 shrink-0 text-right text-xs tabular-nums text-ink-muted">{track.duration}</span>
      </button>
      <button
        type="button"
        onClick={() => toggleFavorite(track.id)}
        aria-pressed={favourite}
        aria-label={favourite ? `Remove ${track.title} from favourites` : `Add ${track.title} to favourites`}
        className={`grid size-8 shrink-0 place-items-center rounded-full transition ${
          favourite ? "text-terracotta" : "text-ink-muted opacity-0 hover:text-terracotta group-hover:opacity-100 focus-visible:opacity-100"
        }`}
      >
        <svg viewBox="0 0 24 24" width="15" height="15" fill={favourite ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
          <path d="M12 20.5 3.8 12.3a5 5 0 1 1 7.1-7l1.1 1.1 1.1-1.1a5 5 0 1 1 7.1 7Z" />
        </svg>
      </button>
    </div>
  );
}
