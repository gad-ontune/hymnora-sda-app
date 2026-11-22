"use client";

/**
 * The YouTube IFrame Player API, wrapped.
 *
 * The library is YouTube video, so the only honest way to play it is through
 * YouTube itself: there is no audio URL behind an upload, and pretending
 * otherwise produces a player that shows a progress bar and no sound. So this
 * loads the IFrame API once, keeps one off-screen player, and reports its real
 * state upwards.
 *
 * Two facts about that API shape everything here:
 *
 *   1. It is a script tag and a global, not a module. It can be loaded lazily but
 *      only once, and every caller has to wait for the same `onYouTubeIframeAPIReady`.
 *   2. It has no timeupdate event. Position has to be polled, and only while
 *      playing — a 4 Hz poll on a paused player is pure waste and, on mobile, a
 *      measurable battery cost.
 */

export const YT_API_SRC = "https://www.youtube.com/iframe_api";

/** The slice of the player surface this app actually uses. */
export type YtPlayer = {
  playVideo(): void;
  pauseVideo(): void;
  stopVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  setVolume(volume: number): void;
  getVolume(): number;
  setPlaybackRate(rate: number): void;
  getPlaybackRate(): number;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  getVideoData(): { video_id: string; title: string; author: string };
  mute(): void;
  unMute(): void;
  isMuted(): boolean;
  loadVideoById(id: string): void;
  cueVideoById(id: string): void;
  destroy(): void;
};

export const YT_STATE = {
  UNSTARTED: -1,
  ENDED: 0,
  PLAYING: 1,
  PAUSED: 2,
  BUFFERING: 3,
  CUED: 5,
} as const;

type YtPlayerConstructor = new (
  element: HTMLElement | string,
  config: Record<string, unknown>,
) => YtPlayer;

/** `window.YT` is a namespace object whose `Player` member is the constructor. */
export type YtNamespace = { Player: YtPlayerConstructor };

declare global {
  interface Window {
    YT?: YtNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<YtNamespace> | null = null;

/**
 * Loads the IFrame API once per page.
 *
 * A second call returns the same promise rather than injecting a second script
 * tag: two copies of the API means two definitions of `window.YT`, and the
 * second one wins the race to `onYouTubeIframeAPIReady`, leaving the first
 * player's callbacks bound to an object nothing is listening to any more.
 */
export function loadYouTubeApi(): Promise<YtNamespace> {
  if (typeof window === "undefined") return Promise.reject(new Error("The YouTube API needs a browser"));
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;

  apiPromise = new Promise<YtNamespace>((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      // Whatever queued behind us still has to run.
      previous?.();
      if (window.YT?.Player) resolve(window.YT);
      else reject(new Error("The YouTube IFrame API loaded without a player"));
    };

    const script = document.createElement("script");
    script.src = YT_API_SRC;
    script.async = true;
    script.onerror = () => {
      // Reset so a later attempt can retry instead of resolving to a dead promise.
      apiPromise = null;
      window.onYouTubeIframeAPIReady = previous;
      reject(new Error("Could not load the YouTube player"));
    };
    document.head.appendChild(script);
  });

  return apiPromise;
}

/** Track ids are `yt-<videoId>`; the player only wants the id. */
export function youtubeVideoId(trackId: string): string {
  return trackId.startsWith("yt-") ? trackId.slice(3) : trackId;
}

/**
 * Builds a player configured for audio only.
 *
 * `controls: 0` and a 1-pixel frame are not cosmetic: the visible controls would
 * let someone scrub a video they cannot see, and the mini-player is the real
 * transport control for this player. The `iframe_api` origin is required for the
 * IFrame API to manage the frame; `youtube-nocookie` works for playback embeds
 * but not here.
 */
export function createAudioPlayer(
  YT: YtNamespace,
  element: HTMLElement,
  videoId: string,
  handlers: {
    onReady: (player: YtPlayer) => void;
    onState: (state: number) => void;
    onError: (code: number) => void;
  },
): YtPlayer {
  const player = new YT.Player(element, {
    videoId,
    playerVars: {
      autoplay: 0,
      controls: 0,
      disablekb: 1,
      modestbranding: 1,
      playsinline: 1,
      rel: 0,
      fs: 0,
    },
    width: "1",
    height: "1",
    events: {
      // `event.target` is the player the API built, not the placeholder element
      // that was passed in — the API replaces it with an iframe.
      onReady: (event: { target: YtPlayer }) => handlers.onReady(event.target),
      onStateChange: (event: { data: number }) => handlers.onState(event.data),
      onError: (event: { data: number }) => handlers.onError(event.data),
    },
  });
  return player;
}

/** A human message for the IFrame API's numeric error codes. */
export function playerErrorMessage(code: number): string {
  switch (code) {
    case 2:
      return "That video's address is wrong.";
    case 5:
      return "That video cannot be played in this browser.";
    case 100:
      return "That video is private or has been removed.";
    case 101:
    case 150:
      return "The owner of that video does not allow it to be played here.";
    default:
      return "That video could not be played.";
  }
}

/**
 * Builds a player that is actually watched.
 *
 * The difference from `createAudioPlayer` is not cosmetic, it is the whole point
 * of the reels page: `controls: 0` on a 1-pixel frame gives sound with no
 * picture, which is right for a hymn playing in the background and wrong for a
 * reel. So this is a full player — the poster frame, the IFrame API's own
 * controls, and `autoplay: 1` with `mute: 1` so a feed can start scrolling
 * without a browser policy prompt.
 *
 * Muted autoplay is the only autoplay a browser will allow without a gesture, and
 * the feed unmutes on the reader's first tap rather than on load. `playsinline`
 * keeps iOS from hijacking the reel into fullscreen the moment it starts.
 */
export function createVideoPlayer(
  YT: YtNamespace,
  element: HTMLElement,
  videoId: string,
  handlers: {
    onReady: (player: YtPlayer) => void;
    onState: (state: number) => void;
    onError: (code: number) => void;
  },
  options: { autoplay?: boolean; muted?: boolean; controls?: boolean; loop?: boolean } = {},
): YtPlayer {
  // YouTube only loops a single video when `loop=1` is paired with a one-item
  // `playlist`; the flag on its own is silently ignored. Building the object
  // conditionally also keeps `playlist=undefined` out of the player URL.
  const playerVars: Record<string, string | number> = {
    autoplay: options.autoplay === false ? 0 : 1,
    controls: options.controls === false ? 0 : 1,
    mute: options.muted === false ? 0 : 1,
    disablekb: 0,
    modestbranding: 1,
    playsinline: 1,
    rel: 0,
    fs: 1,
    // The feed is portrait; a 16:9 letterbox inside it wastes a third of the
    // screen, and `playsinline` plus a fluid container handles the rest.
    iv_load_policy: 3,
  };
  if (options.loop) {
    playerVars.loop = 1;
    playerVars.playlist = videoId;
  }

  const player = new YT.Player(element, {
    videoId,
    playerVars,
    events: {
      // Muted on ready as well as in the player vars: the API applies `mute`
      // late enough that a scrolled-into-view reel can leak half a second of
      // audio before the element's own volume is 0.
      onReady: (event: { target: YtPlayer }) => {
        if (options.muted === false) handlers.onReady(event.target);
        else {
          event.target.setVolume(0);
          if (typeof event.target.mute === "function") event.target.mute();
          handlers.onReady(event.target);
        }
      },
      onStateChange: (event: { data: number }) => handlers.onState(event.data),
      onError: (event: { data: number }) => handlers.onError(event.data),
    },
  });
  return player;
}
