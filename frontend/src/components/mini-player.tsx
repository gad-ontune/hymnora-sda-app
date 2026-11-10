"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { RefObject, ReactNode } from "react";
import {
  Captions,
  ChevronUp,
  Gauge,
  Heart,
  ListMusic,
  Moon,
  PanelBottomClose,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Tv,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { useHymnora } from "@/components/hymnora-provider";
import { imgSrc } from "@/lib/image";
import { formatClock } from "@/lib/format";
import { useI18n, type MessageKey } from "@/lib/i18n";
import type { Track } from "@/lib/types";

type PlayerPanel = "lyrics" | "queue" | "sleep" | "speed" | null;

const SLEEP_OPTIONS_MIN = [5, 10, 15, 30, 45, 60];
const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2];

/**
 * The player that persists.
 *
 * Two modes, like every real player. The bar sits above the fold at the bottom
 * of the page and survives every route change; tapping it opens the full player,
 * a sheet that covers the screen so reading and playing never share the same
 * vertical space.
 *
 * The one exception is the Bible: reading is where nothing should interrupt, so
 * the player hides there rather than competing for the same attention.
 */
/**
 * `suspended` is for a surface that owns the audio itself — the reels page,
 * where the video is the player. It is stronger than hiding: the stream is
 * stopped, because a bar that is merely invisible is still a second player
 * holding audio focus behind a full-screen video.
 */
export function MiniPlayer({ pathname, suspended = false }: { pathname: string; suspended?: boolean }) {
  const { startedAt, togglePlay, stopPlayback } = useHymnora();
  const [expanded, setExpanded] = useState(false);
  const [docked, setDocked] = useState(false);
  const [sleepUntil, setSleepUntil] = useState<number | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const quiet = pathname.startsWith("/bible");
  // Derived, not stored. `startedAt` rather than "a track is loaded", so a
  // prefetched track never puts a bar on screen uninvited.
  const visible = startedAt > 0 && !quiet && !suspended;

  useEffect(() => {
    if (suspended && startedAt > 0) stopPlayback();
  }, [suspended, startedAt, stopPlayback]);

  // Leaving the page with the bar docked would otherwise drop a 56px square into
  // the corner of a page that never asked for it.

  // A countdown so the sleep timer can be shown *as a live timer* on the bar,
  // not as a setting you set and then have to take on faith. Expiry is handled
  // inside the ticking callback too, so a late interval still stops cleanly.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (sleepUntil === null) return;
    const timer = window.setInterval(() => {
      if (Date.now() >= sleepUntil) {
        setSleepUntil(null);
        togglePlay();
      } else {
        setNow(Date.now());
      }
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [sleepUntil, togglePlay]);

  useEffect(() => {
    if (!expanded) return;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpanded(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [expanded]);

  if (!visible) return null;

  const remainingMs = sleepUntil === null ? null : Math.max(0, sleepUntil - now);
  const setSleep = (until: number | null) => {
    setNow(Date.now());
    setSleepUntil(until);
  };

  return (
    <>
      {docked && visible ? (
        <DockPlayer onExpand={() => setDocked(false)} />
      ) : (
        <PlayerBar
          onExpand={() => setExpanded(true)}
          onDock={() => setDocked(true)}
          sleepRemainingMs={remainingMs}
          onCancelSleep={() => setSleep(null)}
          onOpenSleep={() => setExpanded(true)}
        />
      )}
      {expanded ? (
        <PlayerSheet
          onClose={() => setExpanded(false)}
          closeRef={closeRef}
          sleepRemainingMs={remainingMs}
          onSetSleep={setSleep}
          onCancelSleep={() => setSleep(null)}
        />
      ) : null}
    </>
  );
}

/** The always-on bar: title, transport, queue, volume and the cheat-sheet. */
function PlayerBar({
  onExpand,
  onDock,
  sleepRemainingMs,
  onCancelSleep,
  onOpenSleep,
}: {
  onExpand: () => void;
  onDock: () => void;
  sleepRemainingMs: number | null;
  onCancelSleep: () => void;
  onOpenSleep: () => void;
}) {
  const {
    currentTrack,
    isPlaying,
    position,
    duration,
    playbackRate,
    status,
    errorMessage,
    togglePlay,
    playNext,
    playPrevious,
    seek,
    stopPlayback,
  } = useHymnora();
  const { t } = useI18n();
  if (!currentTrack) return null;

  const percent = duration > 0 ? Math.min(100, (position / duration) * 100) : 0;
  const busy = status === "loading";
  const badge = kindKey(currentTrack.kind);

  return (
    /*
      `lg:left-[252px]` is the width of the rail, and it is not decoration: the
      bar used to run edge to edge, which on a desktop meant it painted over the
      bottom of the sidebar — straight across the account card and the reminder.
      The bar belongs to the page, not to the rail.
    */
    <div className="fixed inset-x-0 bottom-[68px] z-40 lg:bottom-0 lg:left-[252px]">
      {/*
        The bar is warm on the left and cool on the right, with the same three
        colours the progress line runs through, so the two read as one object
        rather than a coloured line sitting on a grey panel.
      */}
      <div className="relative border-t border-line/70 bg-[linear-gradient(100deg,#fffdf8_0%,#fbf3e0_26%,#f6f0df_56%,#edf2e8_100%)] shadow-[0_-12px_34px_rgba(50,43,30,0.11)]">
        {sleepRemainingMs !== null ? (
          <button
            type="button"
            onClick={onOpenSleep}
            className="mx-auto mt-2 flex max-w-[1600px] items-center justify-center gap-1.5 rounded-lg bg-ink-fill px-3 py-1 text-[10.5px] font-bold text-gold-light"
            aria-label={t("player.sleepTimer")}
          >
            <Moon size={12} /> {t("player.sleepTimer")} · {formatClock(Math.ceil(sleepRemainingMs / 1000))} {t("player.left")}{" "}
            <span
              role="button"
              tabIndex={-1}
              onClick={(event) => {
                event.stopPropagation();
                onCancelSleep();
              }}
              className="ml-1 grid size-4 place-items-center rounded-full text-white/60 hover:text-white"
              aria-label={t("player.turnOffSleep")}
            >
              <X size={11} />
            </span>
          </button>
        ) : null}

        <div className="mx-auto flex max-w-[1600px] items-center gap-3 px-3 pb-3.5 pt-2">
          <button
            type="button"
            onClick={onExpand}
            className="relative size-11 shrink-0 overflow-hidden rounded-xl ring-1 ring-ink/10 transition hover:ring-gold/60"
            aria-label={t("player.openPlayer")}
          >
            <Image
              src={imgSrc(currentTrack.image, "/images/music-studio.jpg")}
              alt=""
              fill
              sizes="44px"
              className="object-cover warm-image"
            />
          </button>

          <button type="button" onClick={onExpand} className="min-w-0 flex-1 text-left" aria-label={t("player.openPlayer")}>
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="block truncate text-[13px] font-semibold">{currentTrack.title}</span>
              {badge ? <KindPill label={badge} /> : null}
            </span>
            <span className="block truncate text-[11.5px] text-ink-muted">{errorMessage ?? currentTrack.artist}</span>
            {currentTrack.kind === "sermon" || playbackRate !== 1 ? (
              <span
                className="mt-0.5 inline-flex items-center gap-1 rounded-full border border-line bg-surface-soft px-1.5 py-0.5 text-[9.5px] font-bold text-ink-soft"
                aria-hidden="true"
              >
                <Gauge size={9} /> {playbackRate}x
              </span>
            ) : null}
          </button>

          <div className="flex items-center gap-1.5">
            <button type="button" onClick={playPrevious} className="hidden size-8 place-items-center rounded-full text-ink-muted transition hover:text-ink sm:grid" aria-label={t("player.previous")}>
              <SkipBack size={15} fill="currentColor" />
            </button>
            <button
              type="button"
              onClick={togglePlay}
              className="grid size-10 place-items-center rounded-full bg-[linear-gradient(135deg,var(--gold)_0%,var(--terracotta)_100%)] text-white shadow-lift transition hover:brightness-110"
              aria-label={isPlaying ? t("player.pause") : t("player.play")}
            >
              {busy && !isPlaying ? (
                <span className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              ) : isPlaying ? (
                <Pause size={16} fill="currentColor" />
              ) : (
                <Play size={16} fill="currentColor" className="ml-0.5" />
              )}
            </button>
            <button type="button" onClick={playNext} className="hidden size-8 place-items-center rounded-full text-ink-muted transition hover:text-ink sm:grid" aria-label={t("player.next")}>
              <SkipForward size={15} fill="currentColor" />
            </button>
          </div>

          {/*
            The times sit at the far end of the row rather than on their own line
            above it: the line itself is the position, so the numbers only need
            to be there for someone who wants the exact figure.
          */}
          <span className="hidden shrink-0 text-[11px] tabular-nums text-ink-muted sm:block">
            {formatClock(position)} <span className="text-ink-muted/55">/ {formatClock(duration)}</span>
          </span>

          <div className="flex items-center gap-1">
            <MuteButton />
            <button
              type="button"
              onClick={onDock}
              className="hidden size-8 place-items-center rounded-full text-ink-muted transition hover:text-ink lg:grid"
              aria-label={t("player.minimise")}
              title={t("player.minimise")}
            >
              <PanelBottomClose size={16} />
            </button>
            {/*
              The one control that actually gets the bar off the page. Minimise
              keeps it docked; this stops the stream and clears the start, so the
              bar is gone until something is deliberately played again.
            */}
            <button
              type="button"
              onClick={stopPlayback}
              className="size-8 place-items-center rounded-full text-ink-muted transition hover:text-terracotta"
              aria-label={t("player.close")}
              title={t("player.close")}
            >
              <X size={16} />
            </button>
            <button type="button" onClick={onExpand} className="hidden size-8 place-items-center rounded-full text-ink-muted transition hover:text-ink sm:grid" aria-label={t("player.queue")}>
              <ListMusic size={16} />
            </button>
            <button type="button" onClick={onExpand} className="grid size-8 place-items-center rounded-full text-ink-muted transition hover:text-ink lg:hidden" aria-label={t("player.openPlayer")}>
              <ChevronUp size={16} />
            </button>
          </div>
        </div>

        {/*
          The progress line, flush with the bottom edge of the bar. It is drawn
          last so nothing can cover it, and the range input on top of it is what
          takes the drag. That input lives in the bar's own bottom padding rather
          than over the content, so a thumb reaching for the artwork never lands
          on the scrubber by accident.
        */}
        <div
          className="player-line h-1 w-full"
          style={{ ["--range-progress" as string]: `${percent}%` }}
          aria-hidden="true"
        />
        <input
          type="range"
          min={0}
          max={Math.max(1, Math.floor(duration))}
          value={Math.floor(position)}
          onChange={(event) => seek(Number(event.target.value))}
          className="range-seek absolute inset-x-0 bottom-0 h-3.5 w-full"
          aria-label="Seek"
          aria-valuetext={`${formatClock(position)} of ${formatClock(duration)}`}
        />
      </div>
    </div>
  );
}

/**
 * The minimised player.
 *
 * A square docked to the left of the page, clear of the desktop rail: the reader
 * is working in the main column and only needs the player to still be there, and
 * a full-width bar would sit across the thing they are reading. It keeps the two
 * controls that matter at that size — play/pause and expand — because a widget
 * that cannot be paused is a widget people mute at the system level instead.
 */
function DockPlayer({ onExpand }: { onExpand: () => void }) {
  const { currentTrack, isPlaying, togglePlay, status, stopPlayback } = useHymnora();
  const { t } = useI18n();
  if (!currentTrack) return null;
  return (
    <div className="fixed bottom-6 left-[268px] z-40 hidden flex-col items-center gap-2 rounded-2xl border border-line/70 bg-[linear-gradient(160deg,#fffdf8_0%,#fbf1dc_55%,#ecf1e7_100%)] p-2 shadow-lift lg:flex">
      <button type="button" onClick={onExpand} className="relative size-12 overflow-hidden rounded-xl ring-1 ring-ink/10 transition hover:ring-gold/60" aria-label={t("player.openPlayer")}>
        <Image
          src={imgSrc(currentTrack.image, "/images/music-studio.jpg")}
          alt=""
          fill
          sizes="48px"
          className="object-cover warm-image"
        />
      </button>
      <button
        type="button"
        onClick={togglePlay}
        className="grid size-9 place-items-center rounded-full bg-[linear-gradient(135deg,var(--gold)_0%,var(--terracotta)_100%)] text-white shadow-lift transition hover:brightness-110"
        aria-label={isPlaying ? t("player.pause") : t("player.play")}
      >
        {status === "loading" && !isPlaying ? (
          <span className="size-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
        ) : isPlaying ? (
          <Pause size={15} fill="currentColor" />
        ) : (
          <Play size={15} fill="currentColor" className="ml-0.5" />
        )}
      </button>
      <button
        type="button"
        onClick={stopPlayback}
        className="grid size-7 place-items-center rounded-full text-ink-muted transition hover:text-terracotta"
        aria-label={t("player.close")}
      >
        <X size={14} />
      </button>
    </div>
  );
}

function MuteButton() {
  const { volume, setVolume } = useHymnora();
  const { t } = useI18n();
  const [muted, setMuted] = useState(false);
  const target = muted ? 0 : volume;
  return (
    <div className="hidden items-center gap-1.5 sm:flex">
      <button
        type="button"
        onClick={() => setMuted((value) => !value)}
        className="grid size-8 place-items-center rounded-full text-ink-muted transition hover:text-ink"
        aria-label={muted ? t("player.unmute") : t("player.mute")}
      >
        {muted || volume === 0 ? <VolumeX size={15} /> : <Volume2 size={15} />}
      </button>
      <input
        type="range"
        min={0}
        max={100}
        value={target}
        onChange={(event) => {
          setMuted(false);
          setVolume(Number(event.target.value));
        }}
        className="range-gold h-1 w-20 cursor-pointer"
        aria-label={t("player.volume")}
        style={{ ["--range-progress" as string]: `${target}%` }}
      />
    </div>
  );
}

/** A small kind badge, for the context-aware bar (point 17). */
function KindPill({ label }: { label: string }) {
  return (
    <span className="grid shrink-0 place-items-center rounded-full border border-line bg-surface-soft px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em] text-ink-soft">
      {label}
    </span>
  );
}

/** Returns the translation key for a track's kind badge, if it has one. */
function kindKey(kind: string): MessageKey | null {
  switch (kind) {
    case "hymn":
      return "kind.hymn";
    case "sermon":
      return "kind.sermon";
    default:
      return null;
  }
}

/**
 * The full player.
 *
 * A sheet rather than a route, so closing it does not push a history entry: the
 * back button should leave the page you were reading, not peel one layer of
 * chrome off a player.
 */
function PlayerSheet({
  onClose,
  closeRef,
  sleepRemainingMs,
  onSetSleep,
  onCancelSleep,
}: {
  onClose: () => void;
  closeRef: RefObject<HTMLButtonElement | null>;
  sleepRemainingMs: number | null;
  onSetSleep: (until: number | null) => void;
  onCancelSleep: () => void;
}) {
  const {
    currentTrack,
    isPlaying,
    position,
    duration,
    playbackRate,
    status,
    errorMessage,
    queue,
    togglePlay,
    playNext,
    playPrevious,
    seek,
    setPlaybackRate,
    isFavorite,
    toggleFavorite,
    playTracks,
    removeFromQueue,
    clearQueue,
  } = useHymnora();
  const { t } = useI18n();
  const [panel, setPanel] = useState<PlayerPanel>(null);

  if (!currentTrack) return null;
  const favorite = isFavorite(currentTrack.id);
  const at = queue.findIndex((track) => track.id === currentTrack.id);
  const upcoming = queue.filter((_, index) => index !== at);
  const badge = kindKey(currentTrack.kind);
  const percent = duration > 0 ? Math.min(100, (position / duration) * 100) : 0;

  const actions: { id: PlayerPanel; label: string; icon: ReactNode; active?: boolean }[] = [
    { id: "lyrics", label: t("player.lyrics"), icon: <Captions size={16} /> },
    { id: "queue", label: t("player.queue"), icon: <ListMusic size={16} /> },
    { id: "sleep", label: t("player.sleep"), icon: <Moon size={16} />, active: sleepRemainingMs !== null },
    { id: "speed", label: t("player.speed"), icon: <Gauge size={16} />, active: playbackRate !== 1 },
  ];

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-ink-fill text-white" role="dialog" aria-modal="true" aria-label={t("player.nowPlaying")}>
      <header className="flex items-center justify-between px-4 py-3">
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          className="grid size-9 place-items-center rounded-full text-white/70 transition hover:bg-white/10 hover:text-white"
          aria-label={t("aria.closeNavigation")}
        >
          <ChevronUp size={20} className="rotate-180" />
        </button>
        <div className="flex items-center gap-2">
          {badge ? <KindPill label={t(badge)} /> : null}
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-white/45">{t("player.nowPlaying")}</p>
        </div>
        <span className="size-9" />
      </header>

      <div className="flex flex-1 flex-col items-center overflow-y-auto px-6 pb-8">
        <div className="relative aspect-square w-full max-w-[400px] shrink-0 overflow-hidden rounded-3xl shadow-player">
          <Image
            src={imgSrc(currentTrack.image, "/images/music-studio.jpg")}
            alt=""
            fill
            sizes="400px"
            priority
            className="object-cover warm-image"
          />
        </div>

        <div className="mt-6 w-full max-w-[520px] text-center">
          <div className="flex items-center justify-center gap-2">
            <h2 className="font-display text-[26px] font-semibold leading-tight">{currentTrack.title}</h2>
            {currentTrack.kind === "hymn" ? (
              <Link href="/hymns" className="shrink-0 rounded-full border border-gold-light/50 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-gold-light transition hover:bg-gold-light hover:text-ink">
                {t("player.openHymn")}
              </Link>
            ) : null}
          </div>
          <p className="mt-1.5 text-sm text-white/55">{currentTrack.artist}</p>
          {errorMessage ? <p className="mt-3 text-[13px] text-terracotta-soft">{errorMessage}</p> : null}
        </div>

        <div className="mt-6 w-full max-w-[520px]">
          <input
            type="range"
            min={0}
            max={Math.max(1, Math.floor(duration))}
            value={Math.floor(position)}
            onChange={(event) => seek(Number(event.target.value))}
            className="range-gold h-1.5 w-full cursor-pointer"
            aria-label={t("player.seek")}
            style={{ ["--range-progress" as string]: `${percent}%` }}
          />
          <div className="mt-1.5 flex justify-between text-[11.5px] tabular-nums text-white/45">
            <span>{formatClock(position)}</span>
            <span>{formatClock(duration)}</span>
          </div>
        </div>

        {/* A more useful transport than `Previous · Play · Next`: ten-second
            skips, which are the only control a listener actually reaches for. */}
        <div className="mt-4 flex items-center gap-4">
          <button type="button" onClick={() => seek(position - 10)} className="grid size-10 place-items-center rounded-full text-white/80 transition hover:text-gold-light" aria-label={t("player.back10")}>
            <RotateCcw size={19} />
          </button>
          <button type="button" onClick={playPrevious} className="grid size-10 place-items-center rounded-full text-white transition hover:text-gold-light" aria-label={t("player.previous")}>
            <SkipBack size={24} fill="currentColor" />
          </button>
          <button
            type="button"
            onClick={togglePlay}
            className="grid size-16 place-items-center rounded-full bg-white text-ink transition hover:bg-gold-light"
            aria-label={isPlaying ? t("player.pause") : t("player.play")}
          >
            {status === "loading" && !isPlaying ? (
              <span className="size-6 animate-spin rounded-full border-2 border-ink/30 border-t-ink" />
            ) : isPlaying ? (
              <Pause size={24} fill="currentColor" />
            ) : (
              <Play size={24} fill="currentColor" className="ml-1" />
            )}
          </button>
          <button type="button" onClick={playNext} className="grid size-10 place-items-center rounded-full text-white transition hover:text-gold-light" aria-label={t("player.next")}>
            <SkipForward size={24} fill="currentColor" />
          </button>
          <button type="button" onClick={() => seek(position + 10)} className="grid size-10 place-items-center rounded-full text-white/80 transition hover:text-gold-light" aria-label={t("player.forward10")}>
            <RotateCw size={19} />
          </button>
        </div>

        {/* Actions: the panel row from the plan. Equalizer and Devices exist as
            destinations, and are disabled with a reason rather than pretending. */}
        <div className="mt-8 flex w-full max-w-[520px] items-center justify-between gap-1">
          <button
            type="button"
            onClick={() => toggleFavorite(currentTrack.id)}
            className={`flex min-w-0 flex-1 flex-col items-center gap-1.5 rounded-xl px-2 py-2 text-[10.5px] font-semibold transition ${favorite ? "text-gold-light" : "text-white/60 hover:text-white"}`}
          >
            <Heart size={18} fill={favorite ? "currentColor" : "none"} />
            {favorite ? t("player.saved") : t("player.favourite")}
          </button>
          {actions.map((action) => (
            <button
              key={action.id}
              type="button"
              onClick={() => setPanel((current) => (current === action.id ? null : action.id))}
              className={`flex min-w-0 flex-1 flex-col items-center gap-1.5 rounded-xl px-2 py-2 text-[10.5px] font-semibold transition ${
                panel === action.id
                  ? "bg-white/10 text-gold-light"
                  : action.active
                    ? "text-gold-light"
                    : "text-white/60 hover:text-white"
              }`}
              aria-pressed={panel === action.id}
            >
              {action.icon}
              {action.id === "sleep" && sleepRemainingMs !== null
                ? formatClock(Math.ceil(sleepRemainingMs / 1000))
                : action.id === "speed" && playbackRate !== 1
                  ? `${playbackRate}x`
                  : action.label}
            </button>
          ))}
          <button
            type="button"
            disabled
            title="A graphical equalizer needs a mobile app; on the web it lands when the platform ships."
            className="flex min-w-0 flex-1 cursor-not-allowed flex-col items-center gap-1.5 rounded-xl px-2 py-2 text-[10.5px] font-semibold text-white/30"
          >
            <SlidersHorizontal size={18} />
            Equalizer
          </button>
          <button
            type="button"
            disabled
            title="Pick the device on the mobile app."
            className="flex min-w-0 flex-1 cursor-not-allowed flex-col items-center gap-1.5 rounded-xl px-2 py-2 text-[10.5px] font-semibold text-white/30"
          >
            <Tv size={18} />
            Devices
          </button>
        </div>

        <div className="mt-6 w-full max-w-[520px] pb-2">
          {panel === "lyrics" ? (
            <LyricsPanel kind={currentTrack.kind} />
          ) : panel === "sleep" ? (
            <SleepPanel remainingMs={sleepRemainingMs} onSet={onSetSleep} onCancel={onCancelSleep} />
          ) : panel === "speed" ? (
            <SpeedPanel rate={playbackRate} onSet={setPlaybackRate} />
          ) : panel === "queue" ? (
            <QueuePanel queue={queue} currentIndex={at} onPlay={playTracks} onRemove={removeFromQueue} onClear={clearQueue} />
          ) : (
            <UpNext upcoming={upcoming} durationLabel={currentTrack.duration} setPanel={setPanel} />
          )}
        </div>
      </div>
    </div>
  );
}

/** Panel: lyrics. Honest about what exists, rather than showing a flat fake. */
function LyricsPanel({ kind }: { kind: string }) {
  if (kind === "hymn") {
    return (
      <PanelBox
        icon={<Captions size={15} />}
        title="Hymn lyrics live in the Hymnal"
        body="The player recognises this as a hymn. The full text — version, tune and all — lives with the hymn, not the recording."
      >
        <Link href="/hymns" className="inline-flex h-9 items-center rounded-lg bg-gold-light px-4 text-xs font-bold text-ink transition hover:brightness-105">
          Open the Hymnal
        </Link>
      </PanelBox>
    );
  }
  return (
    <PanelBox
      icon={<Captions size={15} />}
      title="No lyrics for this recording yet"
      body="Synchronised lyric files are on the roadmap. Until the transcript pipeline runs, this space stays honest, not invented."
    />
  );
}

function SleepPanel({
  remainingMs,
  onSet,
  onCancel,
}: {
  remainingMs: number | null;
  onSet: (until: number | null) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  return (
    <PanelBox
      icon={<Moon size={15} />}
      title={remainingMs !== null ? `${t("player.sleepTimer")} — ${formatClock(Math.ceil(remainingMs / 1000))} ${t("player.left")}` : t("player.sleepTimer")}
      body="Music keeps playing for the chosen time, then stops."
    >
      <div className="mt-3 flex flex-wrap gap-2">
        {SLEEP_OPTIONS_MIN.map((minutes) => (
          <button
            key={minutes}
            type="button"
            onClick={() => onSet(Date.now() + minutes * 60_000)}
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
              remainingMs !== null && remainingMs <= minutes * 60_000 + 60_000 && remainingMs > (minutes - 1) * 60_000
                ? "border-gold-light bg-gold-light text-ink"
                : "border-white/20 text-white/80 hover:border-gold-light hover:text-white"
            }`}
          >
            {minutes} min
          </button>
        ))}
      </div>
      {remainingMs !== null ? (
        <button type="button" onClick={onCancel} className="mt-3 inline-flex items-center gap-1.5 text-xs font-bold text-gold-light transition hover:text-white">
          <X size={13} /> {t("player.turnOffSleep")}
        </button>
      ) : null}
    </PanelBox>
  );
}

function SpeedPanel({ rate, onSet }: { rate: number; onSet: (value: number) => void }) {
  return (
    <PanelBox
      icon={<Gauge size={15} />}
      title="Playback speed"
      body="Slower for hymns and sermons, faster when you only need the tune."
    >
      <div className="mt-3 flex flex-wrap gap-2">
        {SPEEDS.map((speed) => (
          <button
            key={speed}
            type="button"
            onClick={() => onSet(speed)}
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
              rate === speed ? "border-gold-light bg-gold-light text-ink" : "border-white/20 text-white/80 hover:border-gold-light hover:text-white"
            }`}
          >
            {speed}x
          </button>
        ))}
      </div>
    </PanelBox>
  );
}

function QueuePanel({
  queue,
  currentIndex,
  onPlay,
  onRemove,
  onClear,
}: {
  queue: Track[];
  currentIndex: number;
  onPlay: (tracks: Track[], index: number) => void;
  onRemove: (index: number) => void;
  onClear: () => void;
}) {
  const { t } = useI18n();
  const upcoming = queue.filter((_, index) => index !== currentIndex);
  // Queue rows are shown without the song that is playing, so a row's position
  // is not its queue index: anything after the current song shifts down by one.
  const toQueueIndex = (upcomingIndex: number) => (currentIndex >= 0 && upcomingIndex >= currentIndex ? upcomingIndex + 1 : upcomingIndex);

  return (
    <PanelBox
      icon={<ListMusic size={15} />}
      title={`${t("player.upNext")}${upcoming.length} ${upcoming.length === 1 ? t("player.song") : t("player.songs")}`}
      body="Tap a row to play it now. Removing is one tap — no confirm, because it is a queue, not a promise."
    >
      <div className="mt-3 space-y-1">
        {upcoming.length === 0 ? (
          <p className="text-center text-xs text-white/40">The queue is just this song. The journey ends where it began.</p>
        ) : (
          upcoming.slice(0, 20).map((track, upcomingIndex) => (
            <div key={track.id} className="group/row flex items-center gap-3">
              <button
                type="button"
                onClick={() => onPlay(queue, toQueueIndex(upcomingIndex))}
                className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-white/8"
                aria-label={`Play ${track.title}`}
              >
                <span className="w-4 shrink-0 text-[11px] tabular-nums text-white/35">{upcomingIndex + 1}</span>
                <span className="relative size-9 shrink-0 overflow-hidden rounded-lg">
                  <Image src={imgSrc(track.image, "/images/music-studio.jpg")} alt="" fill sizes="36px" className="object-cover" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold">{track.title}</span>
                  <span className="block truncate text-[11.5px] text-white/45">{track.artist}</span>
                </span>
                <span className="text-[11px] tabular-nums text-white/40">{track.duration}</span>
              </button>
              <button
                type="button"
                onClick={() => onRemove(toQueueIndex(upcomingIndex))}
                className="grid size-7 shrink-0 place-items-center rounded-full text-white/35 opacity-0 transition hover:bg-white/10 hover:text-white group-hover/row:opacity-100"
                aria-label={`Remove ${track.title} from the queue`}
              >
                <X size={13} />
              </button>
            </div>
          ))
        )}
      </div>
      {upcoming.length > 0 ? (
        <button type="button" onClick={onClear} className="mt-3 text-xs font-bold text-gold-light transition hover:text-white">
          {t("player.clearQueue")}
        </button>
      ) : null}
    </PanelBox>
  );
}

function UpNext({
  upcoming,
  durationLabel,
  setPanel,
}: {
  upcoming: Track[];
  durationLabel: string;
  setPanel: (panel: PlayerPanel) => void;
}) {
  const { t } = useI18n();
  if (upcoming.length === 0) return null;
  return (
    <div className="text-left">
      <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-white/40">
        <ListMusic size={14} />
        {t("player.upNext")}{upcoming.length} {upcoming.length === 1 ? t("player.song") : t("player.songs")}
      </p>
      <div className="mt-3 space-y-1">
        {upcoming.slice(0, 4).map((track, index) => (
          <div key={track.id} className="flex items-center gap-3 rounded-xl px-2 py-2">
            <span className="w-4 shrink-0 text-[11px] tabular-nums text-white/35">{index + 1}</span>
            <span className="relative size-9 shrink-0 overflow-hidden rounded-lg">
              <Image src={imgSrc(track.image, "/images/music-studio.jpg")} alt="" fill sizes="36px" className="object-cover" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold">{track.title}</span>
              <span className="block truncate text-[11.5px] text-white/45">{track.artist}</span>
            </span>
            <span className="text-[11px] tabular-nums text-white/40">{track.duration}</span>
          </div>
        ))}
      </div>
      <button type="button" onClick={() => setPanel("queue")} className="mt-3 text-xs font-bold text-gold-light transition hover:text-white">
        {t("player.manageQueue")}
      </button>
      {durationLabel ? <p className="mt-4 text-[10.5px] uppercase tracking-[0.12em] text-white/30">{durationLabel}</p> : null}
    </div>
  );
}

function PanelBox({ icon, title, body, children }: { icon: ReactNode; title: string; body: string; children?: ReactNode }) {
  return (
    <div className="text-center">
      <p className="flex items-center justify-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-white/40">
        {icon}
        {title}
      </p>
      <p className="mt-2 mx-auto max-w-sm text-[12.5px] leading-5 text-white/55">{body}</p>
      {children}
    </div>
  );
}