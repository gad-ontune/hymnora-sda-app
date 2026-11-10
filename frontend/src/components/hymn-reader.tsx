"use client";

import Link from "next/link";
import { ArrowLeft, Minus, Moon, Plus, Sun, Type } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { FavoriteButton } from "@/components/favorite-button";
import { PlayButton } from "@/components/play-button";
import { useHymnora } from "@/components/hymnora-provider";
import { getHymnDetail } from "@/lib/api";
import type { HymnDetail, Track } from "@/lib/types";

const PLACEHOLDER_TRACK: Track = {
  id: "",
  title: "",
  artist: "",
  album: "",
  image: "/images/bible-study.jpg",
  duration: "",
  language: "",
  kind: "hymn",
};

/**
 * The reading view for a single hymn. It lives on its own route so the hymns
 * index can stay a browse page, and because the list endpoint omits lyrics this
 * pulls the full record for whichever hymn was opened.
 */
export function HymnReader({ hymnId }: { hymnId: string }) {
  const [state, setState] = useState<{ id: string; hymn: HymnDetail | null } | null>(null);
  const [fontSize, setFontSize] = useState(18);
  const [readerTheme, setReaderTheme] = useState<"cream" | "light" | "dark">("cream");
  const { currentTrack, isPlaying } = useHymnora();

  useEffect(() => {
    let cancelled = false;
    getHymnDetail(hymnId)
      .then((hymn) => {
        if (!cancelled) setState({ id: hymnId, hymn });
      })
      .catch(() => {
        if (!cancelled) setState({ id: hymnId, hymn: null });
      });
    return () => {
      cancelled = true;
    };
  }, [hymnId]);

  const loading = state?.id !== hymnId;
  const detail = state?.id === hymnId ? state.hymn : null;

  const stanzas = useMemo(
    () => (detail?.lyrics ? detail.lyrics.split(/\n\s*\n/).filter((stanza) => stanza.trim().length > 0) : []),
    [detail],
  );

  const track: Track = detail
    ? {
        id: detail.id,
        title: `Hymn ${detail.number} · ${detail.title}`,
        artist: detail.edition,
        album: `${detail.language} · ${detail.theme}`,
        image: detail.image,
        duration: detail.duration,
        language: detail.language,
        kind: "hymn",
      }
    : PLACEHOLDER_TRACK;

  const playing = Boolean(detail) && currentTrack?.id === detail?.id && isPlaying;
  const background =
    readerTheme === "dark"
      ? "bg-ink-fill text-white"
      : readerTheme === "light"
        ? "bg-white text-ink"
        : "bg-[#fbf5e7] text-[#28251e]";
  const border = readerTheme === "dark" ? "border-white/10" : "border-line/80";

  return (
    <div className="fade-up mx-auto max-w-3xl py-6">
      <Link
        href="/hymns"
        className="inline-flex items-center gap-2 text-sm font-semibold text-ink-muted transition hover:text-gold"
      >
        <ArrowLeft size={16} /> All hymns
      </Link>

      <div className={`mt-5 overflow-hidden rounded-[24px] border border-line shadow-soft ${background}`}>
        <div className={`flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4 sm:px-7 ${border}`}>
          <div className="flex items-center gap-3">
            <PlayButton track={track} className="size-10" />
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-gold">
                {playing ? "Playing now" : "Now reading"}
              </p>
              <p className="text-sm font-semibold">
                Hymn {detail?.number} · {detail?.title}
              </p>
            </div>
          </div>
          <FavoriteButton
            id={detail?.id ?? ""}
            className={`size-9 ${readerTheme === "dark" ? "bg-white/10 text-white hover:bg-white/20" : ""}`}
          />
        </div>

        <div className="px-5 py-8 sm:px-10 sm:py-12">
          <div className="text-center">
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-gold">Hymn {detail?.number}</p>
            <h1 className="mt-3 font-display text-[34px] font-semibold leading-tight tracking-[-0.035em] sm:text-[46px]">
              {detail?.title}
            </h1>
            <p className="mt-2 text-sm opacity-60">
              {detail?.edition} · {detail?.language}
            </p>
          </div>

          <div className="my-8 flex items-center justify-center gap-3 text-xs opacity-55">
            <span className="h-px w-12 bg-current" />
            <span>
              {stanzas.length > 0
                ? `${stanzas.length} ${stanzas.length === 1 ? "stanza" : "stanzas"}`
                : (detail?.edition ?? "")}
            </span>
            <span className="h-px w-12 bg-current" />
          </div>

          {stanzas.length > 0 ? (
            <div
              className="space-y-7 whitespace-pre-line text-center font-reading"
              style={{ fontSize: `${fontSize}px`, lineHeight: 1.7 }}
            >
              {stanzas.map((stanza, index) => (
                <p key={index}>{stanza}</p>
              ))}
            </div>
          ) : (
            <p className="text-center text-sm opacity-60">
              {loading ? "Loading the words…" : "The text for this hymn is not available yet."}
            </p>
          )}

          <div className="mt-10 grid grid-cols-2 gap-3 border-t border-current/10 pt-5 text-left text-xs opacity-65 sm:grid-cols-4">
            <div>
              <span className="block text-[10px] uppercase tracking-[0.14em]">Tune</span>
              <span className="mt-1 block font-semibold">{detail?.tune || "—"}</span>
            </div>
            <div>
              <span className="block text-[10px] uppercase tracking-[0.14em]">Meter</span>
              <span className="mt-1 block font-semibold">{detail?.meter || "—"}</span>
            </div>
            <div>
              <span className="block text-[10px] uppercase tracking-[0.14em]">Key</span>
              <span className="mt-1 block font-semibold">{detail?.musicalKey || "—"}</span>
            </div>
            <div>
              <span className="block text-[10px] uppercase tracking-[0.14em]">Recording</span>
              <span className="mt-1 block font-semibold">{detail?.audioUrl ? "Available" : "—"}</span>
            </div>
          </div>
        </div>

        <div className={`flex flex-wrap items-center justify-between gap-3 border-t px-5 py-3 sm:px-7 ${border}`}>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setFontSize((size) => Math.max(15, size - 1))}
              className={`grid size-8 place-items-center rounded-lg ${readerTheme === "dark" ? "bg-white/10" : "bg-surface-soft"}`}
              aria-label="Decrease font size"
            >
              <Minus size={15} />
            </button>
            <span className="w-8 text-center text-xs">Aa</span>
            <button
              type="button"
              onClick={() => setFontSize((size) => Math.min(26, size + 1))}
              className={`grid size-8 place-items-center rounded-lg ${readerTheme === "dark" ? "bg-white/10" : "bg-surface-soft"}`}
              aria-label="Increase font size"
            >
              <Plus size={15} />
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="mr-1 text-[10px] font-bold uppercase tracking-[0.14em] opacity-50">Reading mode</span>
            {(["cream", "light", "dark"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setReaderTheme(mode)}
                aria-label={`${mode} mode`}
                className={`grid size-8 place-items-center rounded-lg capitalize ${readerTheme === mode ? "bg-gold text-ink" : readerTheme === "dark" ? "bg-white/10 text-white/70" : "bg-surface-soft text-ink-soft"}`}
              >
                {mode === "cream" ? <Sun size={14} /> : mode === "light" ? <Type size={14} /> : <Moon size={14} />}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
