"use client";

import { useEffect, useRef, useState } from "react";
import { loadYouTubeApi, type YtPlayer } from "@/lib/youtube-player";

/**
 * The embedded YouTube player.
 *
 * The IFrame API is loaded once per page and the player is created imperatively,
 * because Next's `<YouTube>`-style wrappers are not in this project's dependency
 * list and the same loader the audio engine uses is already here and tested.
 *
 * Two things that are easy to get wrong and that this got wrong first:
 *
 * - The host `<div>` is rendered unconditionally, and the poster is an overlay
 *   above it. The player constructor *replaces* the host element with an iframe,
 *   so the host has to exist before the effect runs; rendering it only once the
 *   player is ready means it never exists at the moment it is needed.
 * - `onReady` is held in a ref rather than listed as a dependency. A caller that
 *   passes an inline arrow function would otherwise re-run this effect — and so
 *   destroy and rebuild the player — on every single render.
 */
export function VideoPlayer({
  videoId,
  title,
  thumbnail,
  isLive,
  onReady,
}: {
  videoId: string;
  title: string;
  thumbnail: string;
  isLive: boolean;
  onReady?: () => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const onReadyRef = useRef(onReady);
  const [state, setState] = useState<"loading" | "error" | "ready">("loading");

  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  useEffect(() => {
    let disposed = false;
    let player: YtPlayer | null = null;
    const host = hostRef.current;
    if (!host) return;

    void (async () => {
      try {
        await loadYouTubeApi();
        if (disposed) return;
        player = new window.YT!.Player(host, {
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
            onReady: () => {
              if (disposed) return;
              setState("ready");
              onReadyRef.current?.();
            },
            onError: () => {
              if (disposed) return;
              // 101 and 150 are the embedding refusals. A blank rectangle is
              // worse than a link out, so the error state offers the watch link.
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
      try {
        player?.destroy();
      } catch {
        // A player whose constructor threw has nothing to destroy.
      }
    };
  }, [videoId]);

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-[22px] bg-ink-fill shadow-soft">
      {/* Always present: the constructor replaces this element with the iframe. */}
      <div ref={hostRef} className="size-full" />

      {state === "loading" ? (
        <div
          className="absolute inset-0 size-full"
          role="img"
          aria-label={`${title} — press play to start`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- the thumbnail is a
              remote YouTube URL on an unknown host, so `next/image` would need every
              one of them allow-listed in the loader config. This is the one place a
              plain `img` is the right tool. */}
          <img src={thumbnail} alt="" className="size-full object-cover opacity-70" />
          <span className="absolute inset-0 grid place-items-center bg-ink-fill/35">
            <span className="grid size-16 place-items-center rounded-full bg-terracotta text-white shadow-lift">
              <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true">
                <path d="M8 5v14l11-7z" />
              </svg>
            </span>
          </span>
        </div>
      ) : null}

      {state === "error" ? (
        <div className="absolute inset-0 grid place-items-center bg-ink-fill p-8 text-center">
          <div>
            <p className="text-sm font-semibold text-white">This video cannot be played here.</p>
            <p className="mx-auto mt-2 max-w-sm text-xs leading-5 text-white/60">
              The channel does not allow embedded playback. Open it on YouTube instead.
            </p>
            <a
              href={`https://www.youtube.com/watch?v=${videoId}`}
              target="_blank"
              rel="noreferrer"
              className="mt-5 inline-flex h-10 items-center rounded-xl bg-white px-4 text-sm font-bold text-ink transition hover:bg-white/90"
            >
              Watch on YouTube
            </a>
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
