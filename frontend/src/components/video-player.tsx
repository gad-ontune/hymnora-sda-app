"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Play, VolumeX } from "lucide-react";
import { loadYouTubeApi, type YtPlayer } from "@/lib/youtube-player";

/**
 * The embedded YouTube player.
 *
 * The IFrame API is loaded once per page and the player is created imperatively,
 * because Next's `<YouTube>`-style wrappers are not in this project's dependency
 * list and the same loader the audio engine uses is already here and tested.
 *
 * Three things that are easy to get wrong and that this got wrong first:
 *
 * - The YouTube constructor *replaces* the element it is given with an iframe.
 *   The React-owned host div must never be that element: React would lose track
 *   of its own DOM node. A plain mount node lives inside the host instead.
 * - The poster is a real button. A click before the iframe is ready has to be
 *   remembered, or the first tap on the play triangle does nothing at all.
 * - `onReady` is held in a ref rather than listed as an effect dependency. A
 *   caller that passes an inline arrow function would otherwise re-run this
 *   effect — and so destroy and rebuild the player — on every single render.
 */
export function VideoPlayer({
  videoId,
  title,
  thumbnail,
  isLive,
  onReady,
  autoplay = false,
}: {
  videoId: string;
  title: string;
  thumbnail: string;
  isLive: boolean;
  onReady?: () => void;
  autoplay?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YtPlayer | null>(null);
  const pendingPlayRef = useRef(false);
  const onReadyRef = useRef(onReady);
  const autoplayRef = useRef(autoplay);
  const [state, setState] = useState<"loading" | "error" | "ready">("loading");
  const [posterVisible, setPosterVisible] = useState(true);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  useEffect(() => {
    autoplayRef.current = autoplay;
  }, [autoplay]);

  /** Plays only when the API is actually ready; a click before then is queued. */
  const playIfReady = useCallback(() => {
    const player = playerRef.current;
    if (!player) return false;
    try {
      player.playVideo();
      return true;
    } catch {
      return false;
    }
  }, []);

  const unmute = useCallback(() => {
    const player = playerRef.current;
    if (!player) return;
    try {
      player.unMute();
      setMuted(player.isMuted());
    } catch {
      // The iframe controls remain available if the API refuses the call.
    }
  }, []);

  const requestPlay = () => {
    pendingPlayRef.current = true;
    // Hide the poster in this click's render: waiting for onReady is exactly the
    // dead first tap this component used to have.
    setPosterVisible(false);
    const player = playerRef.current;
    if (player) {
      // This is a real gesture, unlike onReady after a navigation, so audio can
      // be restored here if autoplay started us muted.
      try {
        if (player.isMuted()) player.unMute();
      } catch {
        // The visible unmute button remains as the fallback.
      }
      if (playIfReady()) pendingPlayRef.current = false;
      setMuted(player.isMuted());
    }
  };

  useEffect(() => {
    let disposed = false;
    let player: YtPlayer | null = null;
    const host = hostRef.current;
    if (!host) return;

    // The API owns this node and will replace it with its iframe. React never
    // sees it, so its reconciliation stays intact.
    const mount = document.createElement("div");
    mount.className = "size-full";
    host.replaceChildren(mount);

    void (async () => {
      try {
        await loadYouTubeApi();
        if (disposed) return;
        player = new window.YT!.Player(mount, {
          videoId,
          playerVars: {
            autoplay: 0,
            controls: 1,
            rel: 0,
            modestbranding: 1,
            playsinline: 1,
            origin: window.location.origin,
          },
          events: {
            onReady: (event: { target: YtPlayer }) => {
              if (disposed) return;
              // `event.target` is authoritative even if the constructor callback
              // fired before the assignment below completed.
              playerRef.current = event.target;
              setState("ready");

              // A navigation carries no user gesture, so autoplay must start
              // muted; the unmute button is the reliable way to restore sound.
              if (autoplayRef.current) {
                event.target.mute();
                setMuted(true);
              }
              if (autoplayRef.current || pendingPlayRef.current) {
                if (playIfReady()) pendingPlayRef.current = false;
                setPosterVisible(false);
                setMuted(event.target.isMuted());
              }
              onReadyRef.current?.();
            },
            onError: () => {
              if (disposed) return;
              // 101 and 150 are the embedding refusals. An in-app explanation is
              // better than a dead rectangle and keeps the viewer in the app.
              setState("error");
            },
          },
        });
      } catch {
        if (!disposed) setState("error");
      }
    })();

    return () => {
      disposed = true;
      playerRef.current = null;
      pendingPlayRef.current = false;
      try {
        player?.destroy();
      } catch {
        // A player whose constructor threw has nothing to destroy.
      }
      host.replaceChildren();
    };
  }, [videoId, playIfReady]);

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-[22px] bg-ink-fill shadow-soft">
      {/* React owns this div; the IFrame API owns a plain node inside it. */}
      <div ref={hostRef} className="size-full" />

      {state === "loading" && posterVisible ? (
        <button
          type="button"
          onClick={requestPlay}
          aria-label={`Play ${title}`}
          className="group absolute inset-0 size-full overflow-hidden focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-gold"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- the thumbnail is a
              remote YouTube URL on an unknown host, so `next/image` would need every
              one of them allow-listed in the loader config. This is the one place a
              plain `img` is the right tool. */}
          <img src={thumbnail} alt="" loading="eager" fetchPriority="high" className="size-full object-cover opacity-70" />
          <span className="absolute inset-0 grid place-items-center bg-ink-fill/35 transition group-hover:bg-ink-fill/45">
            <span className="grid size-16 place-items-center rounded-full bg-terracotta text-white shadow-lift transition-transform group-hover:scale-105">
              <Play size={26} fill="currentColor" className="translate-x-0.5" aria-hidden="true" />
            </span>
          </span>
        </button>
      ) : null}

      {state === "loading" && !posterVisible ? (
        <div className="pointer-events-none absolute inset-0 grid place-items-center bg-canvas/60">
          <span className="inline-flex items-center gap-2 rounded-full bg-ink-fill/85 px-4 py-2 text-xs font-semibold text-white">
            <Loader2 size={15} className="animate-spin" aria-hidden="true" /> Starting playback…
          </span>
        </div>
      ) : null}

      {muted && state === "ready" ? (
        <button
          type="button"
          onClick={unmute}
          className="absolute bottom-4 left-4 inline-flex h-9 items-center gap-2 rounded-full bg-ink-fill/90 px-4 text-xs font-semibold text-white shadow-lift transition hover:bg-ink-fill focus-visible:outline-2 focus-visible:outline-gold"
        >
          <VolumeX size={15} aria-hidden="true" /> Tap to unmute
        </button>
      ) : null}

      {state === "error" ? (
        <div className="absolute inset-0 grid place-items-center bg-canvas p-8 text-center">
          <div>
            <p className="text-sm font-semibold text-ink">This video cannot be played here.</p>
            <p className="mx-auto mt-2 max-w-sm text-xs leading-5 text-ink-muted">
              Try another from the catalogue — every video here plays inside the app.
            </p>
            <Link
              href="/videos"
              className="mt-5 inline-flex h-10 items-center rounded-xl bg-gold px-4 text-sm font-bold text-canvas transition hover:opacity-90"
            >
              Back to all videos
            </Link>
          </div>
        </div>
      ) : null}

      {isLive ? (
        <span className="pointer-events-none absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-terracotta px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-white">
          <span className="size-1.5 rounded-full bg-white" /> Live
        </span>
      ) : null}
    </div>
  );
}
