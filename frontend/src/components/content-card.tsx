"use client";

import Image from "next/image";
import Link from "next/link";
import { Clock3, MoreHorizontal } from "lucide-react";
import type { Track } from "@/lib/types";
import { FavoriteButton } from "./favorite-button";
import { PlayButton } from "./play-button";
import { imgSrc } from "../lib/image";

export function ContentCard({ track, href, compact = false }: { track: Track; href?: string; compact?: boolean }) {
  return (
    <article className={`group min-w-0 ${compact ? "w-[190px] sm:w-[210px]" : "w-full"}`}>
      <div className={`relative overflow-hidden rounded-2xl bg-surface-soft ${compact ? "aspect-square" : "aspect-[1.18]"}`}>
        <Image src={track.image || "/images/music-studio.jpg"} alt="" fill sizes="(max-width: 640px) 45vw, 260px" className="object-cover warm-image transition duration-500 group-hover:scale-105" />
        <div className="absolute inset-0 bg-gradient-to-t from-ink/75 via-ink/5 to-transparent" />
        <div className="absolute left-3 top-3 rounded-full bg-surface/90 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-ink-soft backdrop-blur-sm">
          {track.kind === "hymn" ? "Hymn" : track.kind === "sermon" ? "Sermon" : track.kind === "video" ? "Watch" : "Listen"}
        </div>
        <div className="absolute inset-x-3 bottom-3 flex items-end justify-between">
          <PlayButton track={track} className="size-10" />
          <FavoriteButton id={track.id} className="size-9" />
        </div>
        {!compact ? <div className="absolute right-3 top-3"><button type="button" className="grid size-8 place-items-center rounded-full bg-ink-fill/45 text-white/80 opacity-0 transition group-hover:opacity-100" aria-label="More options"><MoreHorizontal size={17} /></button></div> : null}
      </div>
      <div className="mt-3 min-w-0 px-0.5">
        <div className="flex items-start justify-between gap-2">
          {href ? <Link href={href} className="line-clamp-1 font-semibold text-ink transition hover:text-sage">{track.title}</Link> : <p className="line-clamp-1 font-semibold text-ink">{track.title}</p>}
          <span className="shrink-0 pt-0.5 text-xs tabular-nums text-ink-muted">{track.duration}</span>
        </div>
        <p className="mt-1 line-clamp-1 text-sm text-ink-muted">{track.artist}</p>
        {!compact ? <p className="mt-1 line-clamp-1 text-xs text-ink-muted/80">{track.album} · {track.language}</p> : null}
      </div>
    </article>
  );
}

export function TrackRow({ track, index }: { track: Track; index?: number }) {
  return (
    <div className="group flex items-center gap-3 rounded-2xl px-2 py-2 transition hover:bg-surface sm:gap-4 sm:px-3">
      {index !== undefined ? <span className="w-5 text-center text-xs tabular-nums text-ink-muted">{String(index + 1).padStart(2, "0")}</span> : null}
      <div className="relative size-12 shrink-0 overflow-hidden rounded-xl">
        <Image src={imgSrc(track.image, "/images/music-studio.jpg")} alt="" fill sizes="48px" className="object-cover warm-image" />
        <div className="absolute inset-0 grid place-items-center bg-ink-fill/35 opacity-0 transition group-hover:opacity-100"><PlayButton track={track} className="size-8" /></div>
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-ink">{track.title}</p>
        <p className="truncate text-xs text-ink-muted">{track.artist} · {track.album}</p>
      </div>
      <span className="hidden text-xs text-ink-muted sm:block">{track.language}</span>
      <span className="flex items-center gap-1 text-xs tabular-nums text-ink-muted"><Clock3 size={13} />{track.duration}</span>
      <FavoriteButton id={track.id} className="hidden size-8 sm:grid" />
    </div>
  );
}
