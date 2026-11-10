"use client";

import { Pause, Play } from "lucide-react";
import { useHymnora } from "./hymnora-provider";
import type { Track } from "@/lib/types";

export function PlayButton({ track, className = "", label }: { track: Track; className?: string; label?: string }) {
  const { currentTrack, isPlaying, playTrack, togglePlay } = useHymnora();
  const active = currentTrack?.id === track?.id;

  return (
    <button
      type="button"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (active) togglePlay();
        else playTrack(track);
      }}
      className={`grid place-items-center rounded-full bg-gold text-ink shadow-sm transition hover:scale-105 hover:bg-gold-light ${className}`}
      aria-label={label ?? (active && isPlaying ? "Pause" : "Play")}
    >
      {active && isPlaying ? <Pause size={16} fill="currentColor" /> : <Play className="ml-0.5" size={16} fill="currentColor" />}
    </button>
  );
}
