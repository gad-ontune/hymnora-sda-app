"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  createAudioPlayer,
  loadYouTubeApi,
  playerErrorMessage,
  youtubeVideoId,
  YT_STATE,
  type YtPlayer,
} from "@/lib/youtube-player";
import { recordPlayed, recordPosition } from "@/lib/history";
import { toggleFavoriteSync, useFavorites } from "@/lib/favorites";
import type { Track } from "@/lib/types";

/**
 * The player, and the only thing in the app that knows how music is played.
 *
 * This used to simulate: a one-second interval that nudged a percentage up while
 * `isPlaying` was true. It looked convincing and was completely disconnected from
 * whether any sound came out. Everything below is now read off a real YouTube
 * player — position, duration, buffering and errors are whatever the player says.
 *
 * YouTube has no audio-only playback, so the player is a 1x1 frame parked
 * off-screen and everything visible is the mini-player this module renders.
 */

export type PlayerStatus = "idle" | "loading" | "ready" | "error";

type HymnoraContextValue = {
  currentTrack: Track | null;
  isPlaying: boolean;
  /** Real position in seconds, not a percentage. */
  position: number;
  /** Real duration in seconds, once the player has reported it. */
  duration: number;
  volume: number;
  status: PlayerStatus;
  /** Set when this video cannot be played here: private, removed, no embedding. */
  errorMessage: string | null;
  favorites: string[];
  queue: Track[];
  playTrack: (track: Track) => void;
  /** Plays a list from an index — what "Play" on any row or card means. */
  playTracks: (tracks: Track[], startIndex?: number) => void;
  togglePlay: () => void;
  playNext: () => void;
  playPrevious: () => void;
  seek: (seconds: number) => void;
  setVolume: (value: number) => void;
  /** Playback speed as a factor (0.5, 1, 1.25…). Applied to the live player. */
  playbackRate: number;
  setPlaybackRate: (value: number) => void;
  toggleFavorite: (id: string) => void;
  isFavorite: (id: string) => boolean;
  addToQueue: (track: Track) => void;
  removeFromQueue: (index: number) => void;
  clearQueue: () => void;
  /**
   * Bumped on every deliberate start. The mini-player keys off this rather than
   * off "a track is loaded", so a track that was only prefetched never puts a
   * bar on someone's screen uninvited.
   */
  startedAt: number;
  /**
   * Stops playback and withdraws the player, without forgetting the track.
   *
   * Used when another surface takes over the audio — the reels page — where
   * leaving a stream running behind a full-screen video would have two players
   * fighting for audio focus, and where the bar must not come back on its own.
   */
  stopPlayback: () => void;
  /**
   * Pauses the stream while a video surface owns the sound, without withdrawing
   * the player or forgetting the track. Several surfaces can hold a claim at
   * once (a watch page opening over reels, for example); the last one to let go
   * is the one that gives the audio back.
   */
  suspendForVideo: (owner: string) => void;
  /** Releases a claim and resumes only if the audio was playing before it. */
  resumeFromVideo: (owner: string) => void;
};

const HymnoraContext = createContext<HymnoraContextValue | null>(null);

const VOLUME_KEY = "hymnora-volume";
/** 4 Hz: smooth enough for a scrub bar, cheap enough for a phone. */
const POLL_MS = 250;
/** Under this many seconds, "previous" goes to the last track rather than to zero. */
const RESTART_THRESHOLD_S = 5;

function readVolume(): number {
  if (typeof window === "undefined") return 80;
  const stored = Number(window.localStorage.getItem(VOLUME_KEY));
  return Number.isFinite(stored) && stored >= 0 && stored <= 100 ? stored : 80;
}

export function HymnoraProvider({ children }: { children: React.ReactNode }) {
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  // Volume is safe as a lazy initialiser even though it reads storage: nothing
  // renders it until a track is deliberately played, which is long after
  // hydration. Favourites cannot, because the Library page prints the count.
  const [volume, setVolumeState] = useState(readVolume);
  const [status, setStatus] = useState<PlayerStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const favorites = useFavorites();
  const [queue, setQueue] = useState<Track[]>([]);
  const [startedAt, setStartedAt] = useState(0);
  const [playbackRate, setPlaybackRateState] = useState(1);

  const mountRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YtPlayer | null>(null);
  /**
   * The video the player is actually loaded with. Checked before every load, so a
   * re-render — or React double-invoking an effect in development — cannot restart
   * a song somebody is four minutes into.
   */
  const loadedIdRef = useRef<string | null>(null);
  /** A track asked for before the API script finished loading. */
  const pendingTrackRef = useRef<Track | null>(null);
  // The poll and the state handler need the current queue, track and position
  // without being rebuilt on every tick. These are synced after commit rather
  // than during render: a render that React throws away must not leave a ref
  // pointing at a track that was never shown.
  const queueRef = useRef<Track[]>([]);
  const trackRef = useRef<Track | null>(null);
  /**
   * Set by stopPlayback and consumed by the next playTrack. `trackRef` cannot
   * be used for this: the sync effect further down re-copies `currentTrack`
   * into it after every render, so a cleared value is back before the next
   * play. This flag survives that, and is what lets a closed player be started
   * again from the very same track.
   */
  const stoppedRef = useRef(false);
  const positionRef = useRef(0);
  /** Routes currently holding the audio focus — see `suspendForVideo`. */
  const suspendedByRef = useRef<Set<string>>(new Set());
  /** Whether the stream was actually playing when the first claim arrived. */
  const resumeAfterVideoRef = useRef(false);
  const isPlayingRef = useRef(false);
  const startedAtRef = useRef(0);

  useEffect(() => {
    queueRef.current = queue;
    trackRef.current = currentTrack;
    positionRef.current = position;
    isPlayingRef.current = isPlaying;
    startedAtRef.current = startedAt;
  });

  // ─── Loading and advancing ──────────────────────────────────────────────────

  const load = useCallback((track: Track, autoplay: boolean) => {
    const player = playerRef.current;
    const videoId = youtubeVideoId(track.id);
    if (!player) {
      pendingTrackRef.current = track;
      return;
    }
    if (loadedIdRef.current === videoId) {
      // Already loaded, so this is a resume rather than a restart.
      if (autoplay) player.playVideo();
      return;
    }
    loadedIdRef.current = videoId;
    setPosition(0);
    setDuration(0);
    setErrorMessage(null);
    if (autoplay) player.loadVideoById(videoId);
    else player.cueVideoById(videoId);
  }, []);

  /** Moves to a track in the queue and starts it, replacing whatever is loaded. */
  const switchTo = useCallback((track: Track) => {
    trackRef.current = track;
    setCurrentTrack(track);
    setStartedAt((count) => count + 1);
    // Recorded here because this is the one place a track genuinely begins —
    // `playTrack` reaches the same state without going through it, and does its
    // own call.
    recordPlayed(track);
    const videoId = youtubeVideoId(track.id);
    loadedIdRef.current = videoId;
    setPosition(0);
    setErrorMessage(null);
    const player = playerRef.current;
    if (!player) {
      pendingTrackRef.current = track;
      return;
    }
    player.loadVideoById(videoId);
    player.playVideo();
  }, []);

  const advance = useCallback(() => {
    const list = queueRef.current;
    const playing = trackRef.current;
    if (!list.length || !playing) return;
    const index = list.findIndex((track) => track.id === playing.id);
    // Reaching the end stops. Quietly restarting is the behaviour of a jukebox,
    // not of a player somebody is listening to.
    if (index < 0 || index >= list.length - 1) {
      setIsPlaying(false);
      return;
    }
    switchTo(list[index + 1]);
  }, [switchTo]);

  // ─── The player ─────────────────────────────────────────────────────────────
  // Built once, on mount.

  useEffect(() => {
    const host = mountRef.current;
    if (!host) return;
    let disposed = false;

    // As on the reels page: the IFrame API replaces the element it is given
    // with an iframe, so hand it a node React does not own. React keeps the
    // host, and destroying the player can never strand a child it manages.
    const element = document.createElement("div");
    host.replaceChildren(element);

    void loadYouTubeApi()
      .then((YT) => {
        if (disposed) return;
        playerRef.current = createAudioPlayer(YT, element, "", {
          onReady: (player) => {
            if (disposed) return;
            player.setVolume(readVolume());
            setStatus("ready");
            // A track may have been pressed while the script was still loading.
            const pending = pendingTrackRef.current;
            if (pending) {
              pendingTrackRef.current = null;
              load(pending, true);
            }
          },
          onState: (state) => {
            if (disposed) return;
            if (state === YT_STATE.PLAYING) {
              setIsPlaying(true);
              setErrorMessage(null);
            } else if (state === YT_STATE.PAUSED || state === YT_STATE.CUED) {
              setIsPlaying(false);
            } else if (state === YT_STATE.ENDED) {
              setIsPlaying(false);
              setPosition(0);
              advance();
            }
            // BUFFERING is deliberately not surfaced as "not playing": the audio
            // has not stopped, it is late, and flipping the button to a pause
            // state mid-buffer is how a player appears to have frozen.
          },
          onError: (code) => {
            if (disposed) return;
            setIsPlaying(false);
            setStatus("error");
            setErrorMessage(playerErrorMessage(code));
          },
        });
      })
      .catch((error: unknown) => {
        if (disposed) return;
        setStatus("error");
        setErrorMessage(error instanceof Error ? error.message : "The player could not be loaded.");
      });

    return () => {
      disposed = true;
      try {
        playerRef.current?.destroy();
      } catch {
        /* The frame is going away with the document anyway. */
      }
      playerRef.current = null;
      loadedIdRef.current = null;
      host.replaceChildren();
    };
  }, [advance, load]);

  // ─── Position ───────────────────────────────────────────────────────────────
  // There is no timeupdate event, so position is polled, and only while playing.

  useEffect(() => {
    if (!isPlaying) return;
    const timer = window.setInterval(() => {
      const player = playerRef.current;
      if (!player) return;
      const now = player.getCurrentTime();
      if (Number.isFinite(now)) setPosition(now);
      const total = player.getDuration();
      if (Number.isFinite(total) && total > 0) setDuration(total);
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [isPlaying]);

  // Save where you got to, but only while paused or part-way in: writing on every
  // 4 Hz tick would mean a synchronous localStorage write four times a second,
  // which is the single most expensive thing this app could do on a cheap phone.
  useEffect(() => {
    if (!currentTrack || isPlaying) return;
    if (position < 3) return;
    const timer = window.setTimeout(() => {
      recordPosition(currentTrack.id, position);
    }, 1_500);
    return () => window.clearTimeout(timer);
  }, [currentTrack, isPlaying, position]);

  // Capture the duration when a track is cued, so the scrub bar has a real length
  // before playback starts rather than after the first tick.
  useEffect(() => {
    if (!currentTrack || isPlaying || duration > 0) return;
    const total = playerRef.current?.getDuration();
    if (typeof total === "number" && Number.isFinite(total) && total > 0) setDuration(total);
  }, [currentTrack, duration, isPlaying]);

  // ─── Controls ───────────────────────────────────────────────────────────────

  const playTrack = useCallback(
    (track: Track) => {
      if (!track?.id) return;
      if (trackRef.current?.id !== track.id || stoppedRef.current) {
        trackRef.current = track;
        setCurrentTrack(track);
        setStartedAt((count) => count + 1);
        recordPlayed(track);
        stoppedRef.current = false;
      }
      if (!playerRef.current) setStatus("loading");
      load(track, true);
    },
    [load],
  );

  const playTracks = useCallback(
    (tracks: Track[], startIndex = 0) => {
      if (!tracks.length) return;
      setQueue(tracks);
      playTrack(tracks[Math.max(0, Math.min(startIndex, tracks.length - 1))]);
    },
    [playTrack],
  );

  const stopPlayback = useCallback(() => {
    const player = playerRef.current;
    if (player) {
      // The YouTube player is not always a real player: a blocked iframe, an
      // offline tab or a headless browser leaves a stub without these methods,
      // and a throw here would skip the state reset below and leave the bar up.
      try {
        player.pauseVideo?.();
        player.stopVideo?.();
      } catch {
        // Nothing to stop; the state reset is the part that matters.
      }
    }
    setIsPlaying(false);
    // Ask the next play to announce itself even if it is the same track: the
    // bar is gone, and a listener who replays what they were just hearing
    // expects it back. `stoppedRef` rather than clearing `trackRef`, because
    // the sync effect below restores `trackRef` after every render.
    stoppedRef.current = true;
    // Zero, not "now": this is a withdrawal, not a new start, so the bar stays
    // gone until the reader deliberately plays again from anywhere.
    setStartedAt(0);
    // A deliberate close also cancels any pending handoff: nobody expects music
    // to come back after they pressed the X, even if a video is still on screen.
    suspendedByRef.current.clear();
    resumeAfterVideoRef.current = false;
  }, []);

  /**
   * A video page takes the audio focus by *pausing*, not by stopping. Stopping
   * would throw away the track and the listening position, which is exactly what
   * someone leaving a reel expects to find waiting for them.
   *
   * `startedAt` deliberately stays put: the mini-player is hidden by the shell
   * while the claim is held, and comes back with the same track on exit.
   */
  const suspendForVideo = useCallback((owner: string) => {
    const first = suspendedByRef.current.size === 0;
    suspendedByRef.current.add(owner);
    if (!first) return;

    const player = playerRef.current;
    let wasPlaying = isPlayingRef.current;
    if (player) {
      try {
        wasPlaying = player.getPlayerState() === YT_STATE.PLAYING;
      } catch {
        /* A stub player has no state; the mirrored flag is the fallback. */
      }
    }
    resumeAfterVideoRef.current = wasPlaying && startedAtRef.current > 0 && !stoppedRef.current;
    if (player && wasPlaying) {
      try {
        player.pauseVideo();
      } catch {
        /* Nothing to pause; the state below is what matters. */
      }
    }
    setIsPlaying(false);
  }, []);

  const resumeFromVideo = useCallback(
    (owner: string) => {
      suspendedByRef.current.delete(owner);
      if (suspendedByRef.current.size > 0) return;

      const shouldResume = resumeAfterVideoRef.current;
      resumeAfterVideoRef.current = false;
      if (!shouldResume || !trackRef.current || startedAtRef.current === 0 || stoppedRef.current) return;

      // The player may still be booting; `load` remembers a pending track and
      // starts it as soon as the iframe reports ready.
      if (!playerRef.current) setStatus("loading");
      load(trackRef.current, true);
    },
    [load],
  );

  const togglePlay = useCallback(() => {
    const player = playerRef.current;
    if (!player || !trackRef.current) return;
    if (player.getPlayerState() === YT_STATE.PLAYING) player.pauseVideo();
    else player.playVideo();
  }, []);

  const playNext = useCallback(() => {
    const list = queueRef.current;
    const playing = trackRef.current;
    if (!list.length || !playing) return;
    // A deliberate skip wraps: going past the last track and hearing the first
    // again is expected, which is the opposite of arriving at the end yourself.
    const index = list.findIndex((track) => track.id === playing.id);
    switchTo(list[(index + 1) % list.length]);
  }, [switchTo]);

  const playPrevious = useCallback(() => {
    const player = playerRef.current;
    const list = queueRef.current;
    const playing = trackRef.current;
    if (!list.length || !playing) return;
    // Under a few seconds in, "previous" means the track before this one. Past
    // that it means "start this one again", which is what every other player does.
    if (positionRef.current > RESTART_THRESHOLD_S && player) {
      player.seekTo(0, true);
      setPosition(0);
      return;
    }
    const index = list.findIndex((track) => track.id === playing.id);
    switchTo(list[(index - 1 + list.length) % list.length]);
  }, [switchTo]);

  const seek = useCallback((seconds: number) => {
    const player = playerRef.current;
    if (!player) return;
    const clamped = Math.max(0, seconds);
    player.seekTo(clamped, true);
    setPosition(clamped);
  }, []);

  const setVolume = useCallback((value: number) => {
    const clamped = Math.max(0, Math.min(100, Math.round(value)));
    setVolumeState(clamped);
    playerRef.current?.setVolume(clamped);
    try {
      window.localStorage.setItem(VOLUME_KEY, String(clamped));
    } catch {
      /* Volume simply will not be remembered. */
    }
  }, []);

  const toggleFavorite = useCallback((id: string) => {
    toggleFavoriteSync(id);
  }, []);

  const addToQueue = useCallback((track: Track) => {
    setQueue((current) => (current.some((item) => item.id === track.id) ? current : [...current, track]));
  }, []);

  const removeFromQueue = useCallback((index: number) => {
    setQueue((current) => current.filter((_, at) => at !== index));
  }, []);

  const clearQueue = useCallback(() => {
    // The queue becomes just the track that is actually playing; a player with
    // nothing after the current song is a fair picture of "you cleared it".
    const playing = trackRef.current;
    setQueue((current) => (playing && current.some((track) => track.id === playing.id) ? [playing] : []));
  }, []);

  const setPlaybackRate = useCallback((value: number) => {
    setPlaybackRateState(value);
    try {
      playerRef.current?.setPlaybackRate(value);
    } catch {
      /* Some embeds refuse a rate change; the stored value still applies next load. */
    }
  }, []);

  const value = useMemo<HymnoraContextValue>(
    () => ({
      currentTrack,
      isPlaying,
      position,
      duration,
      volume,
      status,
      errorMessage,
      favorites,
      queue,
      playTrack,
      playTracks,
      togglePlay,
      stopPlayback,
      suspendForVideo,
      resumeFromVideo,
      playNext,
      playPrevious,
      seek,
      setVolume,
      playbackRate,
      setPlaybackRate,
      toggleFavorite,
      isFavorite: (id: string) => favorites.includes(id),
      startedAt,
      addToQueue,
      removeFromQueue,
      clearQueue,
    }),
    [
      addToQueue,
      currentTrack,
      duration,
      errorMessage,
      favorites,
      isPlaying,
      playNext,
      playPrevious,
      playTrack,
      playTracks,
      playbackRate,
      position,
      queue,
      removeFromQueue,
      clearQueue,
      seek,
      setPlaybackRate,
      setVolume,
      startedAt,
      status,
      stopPlayback,
      suspendForVideo,
      resumeFromVideo,
      toggleFavorite,
      togglePlay,
      volume,
    ],
  );

  return (
    <HymnoraContext.Provider value={value}>
      {children}
      {/* The off-screen player. `aria-hidden` because it is a 1x1 frame with no
          controls, and announcing it would be noise. */}
      <div ref={mountRef} aria-hidden="true" className="pointer-events-none absolute h-px w-px overflow-hidden opacity-0" />
    </HymnoraContext.Provider>
  );
}

export function useHymnora() {
  const context = useContext(HymnoraContext);
  if (!context) throw new Error("useHymnora must be used within HymnoraProvider");
  return context;
}
