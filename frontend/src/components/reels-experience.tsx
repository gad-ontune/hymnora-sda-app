"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  ArrowLeft, Bookmark, Check, Compass, Heart, Home, MessageCircle, MoreVertical,
  Pause, Play, Plus, Send, Share2, Sparkles, Users, Volume2, VolumeX, X,
} from "lucide-react";
import {
  getComments, getFollows, getReel, getReels, hideReel, postComment, toggleCommentLike,
  toggleReelLike, followTarget, unfollowTarget,
} from "@/lib/api";
import { hasSession } from "@/lib/session";
import { createVideoPlayer, loadYouTubeApi, playerErrorMessage, type YtPlayer, YT_STATE } from "@/lib/youtube-player";
import type { Comment, FollowsSummary, Reel, ReelFacets, ReelFeedName, ReelPage } from "@/lib/types";

/**
 * Reels — a page of its own, not a tab inside the newsroom.
 *
 * The thing this screen exists to do is play video, so the player is a real,
 * visible YouTube embed with the footage in it, not a thumbnail standing in for
 * a picture. Everything else here follows from that: audio belongs to the reel
 * that is on screen, so the app's own mini-player is not on this page at all
 * (the shell hides and stops it), and muting is a per-reel decision because a
 * feed that starts loud in a queue is the fastest way to get the tab closed.
 *
 * The state that used to be invented is now asked for: the comment thread, the
 * follow buttons, the like, and "not interested" are all the API, and a signed
 * out reader is told so at the moment they press something, rather than being
 * left with a button that quietly does nothing.
 */

type Tab = "following" | "for-you" | "categories";

type Props = {
  initialPage: ReelPage;
  facets: ReelFacets | null;
  /**
   * A reel to open, from `?reel=`. The article pages link their related rail
   * here, and a linked reel is not necessarily in the first page of the feed,
   * so it is fetched on its own and put in front of the stack rather than
   * quietly landing the reader on a different video than the one they clicked.
   */
  initialReelId?: string | null;
};

/**
 * Whether there is a session, read as the external store it is.
 *
 * The token lives in `localStorage`, so the server-rendered feed behind this
 * could not know, and a sign-in in another tab arrives as a `storage` event.
 * Both of those are exactly what `useSyncExternalStore` is for, and it means the
 * Follow buttons never sit there claiming a session that is not there.
 */
function subscribeToSession(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}
const readSession = () => hasSession();
const readSessionOnServer = () => false;

function formatCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(value);
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h`;
  if (seconds < 604_800) return `${Math.round(seconds / 86_400)}d`;
  return new Date(then).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function ReelsExperience({ initialPage, facets, initialReelId = null }: Props) {
  const router = useRouter();
  const signedIn = useSyncExternalStore(subscribeToSession, readSession, readSessionOnServer);
  const [tab, setTab] = useState<Tab>("for-you");
  const [feed, setFeed] = useState<ReelFeedName>("for-you");
  const [category, setCategory] = useState<string | null>(null);
  const [page, setPage] = useState<ReelPage>(initialPage);
  const [active, setActive] = useState(0);
  const [chrome, setChrome] = useState(true);
  const [sheet, setSheet] = useState<null | "comments" | "more" | "categories" | "create">(null);
  const [toast, setToast] = useState<string | null>(null);
  const [muted, setMuted] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [following, setFollowing] = useState<Set<string>>(new Set());
  const [summary, setSummary] = useState<FollowsSummary | null>(null);

  const scrollerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YtPlayer | null>(null);
  const itemRefs = useRef<(HTMLElement | null)[]>([]);
  const chromeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reels = page.items;
  const reel = reels[active] ?? null;

  // ── Feed loading ───────────────────────────────────────────────────────────
  const load = useCallback(
    async (nextFeed: ReelFeedName, nextCategory: string | null) => {
      try {
        const result = await getReels({ feed: nextFeed, category: nextCategory ?? undefined, limit: 10 });
        setPage(result);
        setActive(0);
        scrollerRef.current?.scrollTo({ top: 0 });
      } catch {
        setToast("Could not load the feed");
      }
    },
    [],
  );

  useEffect(() => {
    if (!signedIn) return;
    getFollows()
      .then((response) => {
        setFollowing(new Set(response.items.map((entry) => `${entry.type}:${entry.id}`)));
        setSummary(response.summary);
      })
      .catch(() => {
        /* The follow buttons degrade to signed-out; the feed still works. */
      });
  }, [signedIn]);

  useEffect(() => {
    if (!initialReelId) return;
    const inFeed = initialPage.items.findIndex((item) => item.videoId === initialReelId);
    if (inFeed >= 0) {
      // Already in the first page: scroll the stack to it and let the observer
      // notice it is on screen, which is what sets the active reel.
      scrollerRef.current?.scrollTo({ top: inFeed * (scrollerRef.current?.clientHeight ?? 0) });
      return;
    }
    let cancelled = false;
    getReel(initialReelId)
      .then(({ reel }) => {
        if (cancelled) return;
        setPage((current) => ({ ...current, items: [reel, ...current.items] }));
      })
      .catch(() => {
        if (!cancelled) setToast("That reel is not available");
      });
    return () => {
      cancelled = true;
    };
  }, [initialReelId, initialPage.items]);

  /**
   * The first page came from the server, which could not see the token, so its
   * hearts and Follow buttons are the anonymous view. Refetching quietly once a
   * session is found fixes that without moving the screen — the reader is
   * already watching reel one, and a reload of the list under them would be a
   * worse trade than a heart that fills in a moment later.
   */
  useEffect(() => {
    if (!hasSession()) return;
    let cancelled = false;
    getReels({ feed, category: category ?? undefined, limit: page.items.length || 10 })
      .then((next) => {
        if (cancelled) return;
        setPage((current) => ({
          ...next,
          // Keep what is on screen if the refetch came back a different length.
          items: next.items.length > 0 ? next.items : current.items,
        }));
      })
      .catch(() => {
        /* The server-rendered feed stands; nothing here is worth interrupting it for. */
      });
    return () => {
      cancelled = true;
    };
    // Deliberately once, on mount: a later feed change already fetches with the token.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Chrome starts visible and fades out on its own. Only the timer is set below,
  // and the state change happens when it fires: scrolling and tapping call
  // `showChrome`, which are interactions rather than renders.
  const showChrome = useCallback(() => {
    setChrome(true);
    if (chromeTimer.current) clearTimeout(chromeTimer.current);
    chromeTimer.current = setTimeout(() => setChrome(false), 4200);
  }, []);

  // ── Which reel is on screen ────────────────────────────────────────────────
  useEffect(() => {
    const root = scrollerRef.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!visible) return;
        const index = itemRefs.current.indexOf(visible.target as HTMLDivElement);
        if (index >= 0) {
          setActive(index);
          setPaused(false);
          setError(null);
          showChrome();
        }
      },
      { root, threshold: [0.55] },
    );
    for (const node of itemRefs.current) if (node) observer.observe(node);
    return () => observer.disconnect();
  }, [reels.length, showChrome]);

  // ── The player, for whichever reel is current ──────────────────────────────
  useEffect(() => {
    if (!reel) return;
    const node = itemRefs.current[active];
    if (!node) return;
    let cancelled = false;
    setPlaying(false);

    loadYouTubeApi()
      .then((YT) => {
        if (cancelled) return;
        // The container is replaced per reel, so a stale player bound to a
        // detached node would keep playing into nothing.
        playerRef.current?.destroy();
        const host = node.querySelector<HTMLElement>("[data-player]");
        if (!host) return;
        createVideoPlayer(
          YT,
          host,
          reel.videoId,
          {
            onReady: (instance) => {
              if (cancelled) return;
              playerRef.current = instance;
              setPlaying(true);
            },
            onState: (state) => {
              if (cancelled) return;
              setPlaying(state === YT_STATE.PLAYING);
              if (state === YT_STATE.ENDED) setPaused(true);
            },
            onError: (code) => {
              if (!cancelled) setError(playerErrorMessage(code));
            },
          },
          { autoplay: true, muted: true },
        );
      })
      .catch(() => {
        if (!cancelled) setError("The player could not be loaded");
      });

    return () => {
      cancelled = true;
      const player = playerRef.current;
      playerRef.current = null;
      if (player) {
        player.pauseVideo();
        player.destroy();
      }
    };
  }, [active, reel?.videoId, reel]);

  const toggleSound = useCallback(() => {
    const player = playerRef.current;
    if (!player) return;
    if (muted) {
      player.setVolume(0.85);
      if (typeof player.unMute === "function") player.unMute();
      setMuted(false);
    } else {
      player.setVolume(0);
      if (typeof player.mute === "function") player.mute();
      setMuted(true);
    }
  }, [muted]);

  const togglePlayback = useCallback(() => {
    const player = playerRef.current;
    if (!player) return;
    if (paused) {
      player.playVideo();
      setPaused(false);
    } else {
      player.pauseVideo();
      setPaused(true);
    }
  }, [paused]);

  // On a new reel, the chrome gets its own run. The timer is all this effect
  // sets: the state change happens when it fires, and `showChrome` — which does
  // set state — is called from the scroll and tap handlers instead.
  useEffect(() => {
    if (chromeTimer.current) clearTimeout(chromeTimer.current);
    chromeTimer.current = setTimeout(() => setChrome(false), 4200);
    return () => {
      if (chromeTimer.current) clearTimeout(chromeTimer.current);
    };
  }, [active]);

  // ── Actions ────────────────────────────────────────────────────────────────
  const requireSession = useCallback(
    (what: string): boolean => {
      if (hasSession()) return true;
      setToast(`Sign in to ${what}`);
      return false;
    },
    [],
  );

  const onLike = useCallback(async () => {
    if (!reel || !requireSession("like a reel")) return;
    // Optimistic, then the server's answer: the heart must respond to the tap,
    // and the count must be the count.
    setPage((current) => patchReel(current, reel.videoId, { liked: !reel.liked, likeCount: reel.likeCount + (reel.liked ? -1 : 1) }));
    try {
      const result = await toggleReelLike(reel.videoId);
      setPage((current) => patchReel(current, reel.videoId, result));
    } catch {
      setPage((current) => patchReel(current, reel.videoId, { liked: reel.liked, likeCount: reel.likeCount }));
      setToast("That did not save");
    }
  }, [reel, requireSession]);

  const onFollow = useCallback(async () => {
    if (!reel || !requireSession("follow a channel")) return;
    const key = `creator:${reel.channelId}`;
    const was = following.has(key);
    setFollowing((current) => {
      const next = new Set(current);
      if (was) next.delete(key);
      else next.add(key);
      return next;
    });
    try {
      if (was) await unfollowTarget("creator", reel.channelId);
      else await followTarget("creator", reel.channelId, reel.channel);
    } catch {
      setFollowing((current) => {
        const next = new Set(current);
        if (was) next.add(key);
        else next.delete(key);
        return next;
      });
      setToast("That did not save");
    }
  }, [reel, following, requireSession]);

  const onNotInterested = useCallback(async () => {
    if (!reel) return;
    hideReel(reel.videoId, "not-interested").catch(() => undefined);
    setPage((current) => {
      const items = current.items.filter((item) => item.videoId !== reel.videoId);
      return { ...current, items, total: Math.max(0, current.total - 1) };
    });
    setSheet(null);
    setToast("Hidden — you will not see it again");
  }, [reel]);

  const onReport = useCallback(async () => {
    if (!reel) return;
    hideReel(reel.videoId, "reported").catch(() => undefined);
    setSheet(null);
    setToast("Reported. It has been removed from your feed.");
  }, [reel]);

  const onShare = useCallback(async () => {
    if (!reel) return;
    const url = `${window.location.origin}/reels?reel=${reel.videoId}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: reel.title, text: `${reel.channel} on Hymnora`, url });
        return;
      } catch {
        /* The reader dismissed the sheet; falling through to the clipboard is wrong. */
        return;
      }
    }
    await navigator.clipboard?.writeText(url);
    setToast("Link copied");
  }, [reel]);

  const switchTab = useCallback(
    (next: Tab) => {
      setTab(next);
      if (next === "categories") {
        setSheet("categories");
        return;
      }
      const name: ReelFeedName = next === "following" ? "following" : "for-you";
      setFeed(name);
      if (name !== feed || category) {
        setCategory(null);
        load(name, null);
      }
    },
    [feed, category, load],
  );

  const chooseCategory = useCallback(
    (id: string) => {
      setCategory(id === "for-you" ? null : id);
      setSheet(null);
      load(feed, id === "for-you" ? null : id);
    },
    [feed, load],
  );

  // ── Bottom bar ─────────────────────────────────────────────────────────────
  const goHome = () => router.push("/");

  return (
    <div
      className="fixed inset-0 z-30 flex flex-col bg-ink-fill text-white"
      data-chrome={chrome ? "on" : "off"}
    >
      <header className="flex h-14 shrink-0 items-center gap-3 px-3 sm:h-16 sm:px-5">
        <Link
          href="/news"
          className="flex shrink-0 items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-[12px] font-semibold text-white/85 transition hover:bg-white/20"
          aria-label="Back to the newsroom"
        >
          <ArrowLeft size={16} aria-hidden />
          <span className="hidden sm:inline">Newsroom</span>
        </Link>
        <nav className="flex flex-1 items-center justify-center gap-1" aria-label="Reel feeds">
          {(["following", "for-you", "categories"] as Tab[]).map((name) => (
            <button
              key={name}
              type="button"
              className="rounded-full px-3.5 py-1.5 text-[13px] font-bold text-white/55 transition data-[active=true]:bg-white data-[active=true]:text-ink sm:px-4 sm:text-sm"
              data-active={tab === name}
              onClick={() => switchTab(name)}
            >
              {name === "for-you" ? "For You" : name === "following" ? "Following" : "Categories"}
            </button>
          ))}
        </nav>
        <span className="w-8 shrink-0 sm:w-24" aria-hidden />
      </header>

      {page.feed === "following" && !page.personalised ? (
        <div
          className="absolute left-1/2 top-[76px] z-10 flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/15 bg-ink-fill/85 px-4 py-2 text-[12px] text-white/80 backdrop-blur"
          role="status"
        >
          <Sparkles size={20} aria-hidden />
          <p>
            {signedIn
              ? "You are not following anyone with reels yet, so this is everything for now."
              : "Sign in and follow a channel to fill this feed."}
          </p>
        </div>
      ) : null}

      <div className="no-scrollbar relative flex-1 snap-y snap-mandatory overflow-y-auto" ref={scrollerRef}>
        {reels.length === 0 ? (
          <div className="grid h-full place-content-center gap-3 text-center text-sm text-white/60">
            <Compass size={28} aria-hidden />
            <p>No reels on this shelf yet.</p>
            <button
              type="button"
              onClick={() => chooseCategory("for-you")}
              className="mx-auto rounded-full bg-white/10 px-4 py-2 text-[12px] font-semibold text-white"
            >
              Back to For You
            </button>
          </div>
        ) : null}

        {reels.map((item, index) => (
          <article
            key={item.videoId}
            ref={(node) => {
              itemRefs.current[index] = node;
            }}
            className="relative h-full w-full snap-start snap-always overflow-hidden bg-black"
            data-active={index === active}
            onClick={showChrome}
          >
            <div className="absolute inset-0 grid place-items-center [&>iframe]:absolute [&>iframe]:inset-0 [&>iframe]:h-full [&>iframe]:w-full" data-player="">
              {/* The thumbnail is the poster frame and the fallback: YouTube paints
                  its own, and this is what is there before it does. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.thumbnail}
                alt=""
                className="absolute inset-0 size-full object-cover"
                loading={index < 2 ? "eager" : "lazy"}
              />
            </div>

            {error && index === active ? (
              <Link
              className="absolute inset-0 z-10 grid place-content-center gap-2 bg-ink-fill/85 px-6 text-center text-[13px] text-white/80"
              href={`https://www.youtube.com/watch?v=${item.videoId}`}
            >
              {error} Watch on YouTube
            </Link>
            ) : null}

            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/85 via-black/40 to-transparent pb-28 pt-24 transition-opacity duration-500 sm:pb-24">
              <div className="pointer-events-auto px-4 sm:px-5">
                <Link
                  href={`/news?q=${encodeURIComponent(item.channel)}`}
                  className="text-[15px] font-bold tracking-[-0.01em] text-white drop-shadow"
                >
                  {item.channel}
                </Link>
                <button
                  type="button"
                  className="ml-3 rounded-full border border-white/40 px-3 py-1 text-[11px] font-bold text-white transition data-following:border-sage data-following:bg-sage"
                  data-following={following.has(`creator:${item.channelId}`)}
                  onClick={(event) => {
                    event.stopPropagation();
                    onFollow();
                  }}
                >
                  {following.has(`creator:${item.channelId}`) ? (
                    <>
                      <Check size={14} aria-hidden /> Following
                    </>
                  ) : (
                    "Follow"
                  )}
                </button>
                <h2 className="mt-2 line-clamp-2 max-w-[70%] text-[15px] font-semibold leading-snug text-white drop-shadow sm:max-w-[62%]">
                  {item.title}
                </h2>
                <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-[11.5px] text-white/70">
                  <span>{item.reelCategoryLabel}</span>
                  <span>{item.regionLabel}</span>
                  {item.publishedAt ? <span>{new Date(item.publishedAt).toLocaleDateString()}</span> : null}
                </p>
              </div>
            </div>

            <div className="absolute bottom-24 right-3 z-20 flex flex-col items-center gap-5 sm:bottom-20 sm:right-5">
              <button
                type="button"
                className="flex flex-col items-center gap-1 text-[11px] font-semibold text-white/85 transition data-active:text-terracotta"
                data-active={item.liked}
                aria-pressed={item.liked}
                onClick={(event) => {
                  event.stopPropagation();
                  onLike();
                }}
              >
                <Heart size={22} fill={item.liked ? "currentColor" : "none"} aria-hidden />
                <span>{formatCount(item.likeCount)}</span>
              </button>
              <button
                type="button"
                className="flex flex-col items-center gap-1 text-[11px] font-semibold text-white/85 transition"
                onClick={(event) => {
                  event.stopPropagation();
                  if (!requireSession("comment")) return;
                  setSheet("comments");
                  showChrome();
                }}
              >
                <MessageCircle size={22} aria-hidden />
                <span>{formatCount(item.commentCount)}</span>
              </button>
              <button
                type="button"
                className="flex flex-col items-center gap-1 text-[11px] font-semibold text-white/85 transition"
                onClick={(event) => {
                  event.stopPropagation();
                  onShare();
                }}
              >
                <Share2 size={22} aria-hidden />
                <span>{formatCount(item.shareCount)}</span>
              </button>
              <button
                type="button"
                className="flex flex-col items-center gap-1 text-[11px] font-semibold text-white/85 transition"
                onClick={(event) => {
                  event.stopPropagation();
                  setSheet("more");
                  showChrome();
                }}
              >
                <MoreVertical size={22} aria-hidden />
                <span>More</span>
              </button>
            </div>

            {index === active ? (
              <div className="absolute left-1/2 top-1/2 z-20 flex -translate-x-1/2 -translate-y-1/2 gap-3">
                <button
                type="button"
                onClick={togglePlayback}
                className="grid size-12 place-items-center rounded-full bg-ink-fill/60 text-white backdrop-blur"
                aria-label={paused ? "Play" : "Pause"}
              >
                  {paused ? <Play size={20} aria-hidden /> : <Pause size={20} aria-hidden />}
                </button>
                <button
                type="button"
                onClick={toggleSound}
                className="grid size-12 place-items-center rounded-full bg-ink-fill/60 text-white backdrop-blur"
                aria-label={muted ? "Unmute" : "Mute"}
              >
                  {muted ? <VolumeX size={20} aria-hidden /> : <Volume2 size={20} aria-hidden />}
                </button>
              </div>
            ) : null}

            {!playing && index === active && !error ? (
              <p className="pointer-events-none absolute left-1/2 top-4 z-10 -translate-x-1/2 rounded-full bg-ink-fill/60 px-3 py-1 text-[11px] text-white/75 backdrop-blur" role="status">
                Loading the video…
              </p>
            ) : null}
          </article>
        ))}
      </div>

      <nav
        className="grid h-[68px] shrink-0 grid-cols-4 border-t border-white/10 bg-ink-fill/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl"
        aria-label="Reels sections"
      >
        <button type="button" onClick={goHome} className="flex flex-col items-center justify-center gap-1 text-[10px] font-semibold text-white/60">
          <Home size={19} aria-hidden />
          Home
        </button>
        <Link href="/news?q=church" className="flex flex-col items-center justify-center gap-1 text-[10px] font-semibold text-white/60">
          <Users size={19} aria-hidden />
          Friends
        </Link>
        <button type="button" onClick={() => setSheet("create")} className="flex flex-col items-center justify-center gap-1 text-[10px] font-semibold text-white/60">
          <span className="grid size-8 place-items-center rounded-full bg-gold text-ink">
            <Plus size={18} aria-hidden />
          </span>
          Create
        </button>
        <Link href="/churches" className="relative flex flex-col items-center justify-center gap-1 text-[10px] font-semibold text-white/60">
          <Bookmark size={19} aria-hidden />
          Churches
          {summary && summary.churches > 0 ? (
            <em className="absolute right-[22%] top-1 grid size-4 place-items-center rounded-full bg-sage text-[9px] not-italic text-white">
              {summary.churches}
            </em>
          ) : null}
        </Link>
      </nav>

      {sheet === "comments" && reel ? (
        <CommentSheet reel={reel} onClose={() => setSheet(null)} onCount={(count) => setPage((c) => patchReel(c, reel.videoId, { commentCount: count }))} signedIn={signedIn} />
      ) : null}

      {sheet === "more" && reel ? (
        <Sheet title="More" onClose={() => setSheet(null)}>
          <button type="button" onClick={onShare}>
            <Share2 size={18} aria-hidden /> Send to a friend
          </button>
          <button type="button" onClick={onFollow}>
            {following.has(`creator:${reel.channelId}`) ? "Unfollow this channel" : "Follow this channel"}
          </button>
          <button type="button" onClick={onNotInterested}>
            <X size={18} aria-hidden /> Not interested
          </button>
          <button type="button" onClick={onReport}>
            Report this reel
          </button>
          <Link href={`https://www.youtube.com/watch?v=${reel.videoId}`}>Watch on YouTube</Link>
        </Sheet>
      ) : null}

      {sheet === "categories" ? (
        <Sheet title="Categories" onClose={() => setSheet(null)}>
          <p className="sheet-note">Every shelf with reels on it. Empty shelves are not offered.</p>
          {facets?.categories.map((entry) => (
            <button key={entry.id} type="button" data-active={category === entry.id} onClick={() => chooseCategory(entry.id)}>
              <span>{entry.label}</span>
              <em>{entry.count}</em>
            </button>
          ))}
          {facets?.categories.length === 0 ? <p className="sheet-note">No shelves yet.</p> : null}
        </Sheet>
      ) : null}

      {sheet === "create" ? (
        <Sheet title="Create" onClose={() => setSheet(null)}>
          <p className="sheet-note">
            Publishing a reel is not open in this build. What you can do from here is comment on a reel, share
            one, and follow the channels you want more of.
          </p>
          <button
            type="button"
            onClick={() => {
              setSheet("comments");
            }}
          >
            <MessageCircle size={18} aria-hidden /> Comment on this reel
          </button>
          <button type="button" onClick={onShare}>
            <Share2 size={18} aria-hidden /> Share this reel
          </button>
          <Link href="/news">Back to the newsroom</Link>
        </Sheet>
      ) : null}

      {toast ? (
        <p
          className="absolute bottom-24 left-1/2 z-30 -translate-x-1/2 cursor-pointer rounded-full bg-ink-fill/90 px-4 py-2 text-[12px] font-medium text-white shadow-lift backdrop-blur"
          role="status"
          onClick={() => setToast(null)}
        >
          {toast}
        </p>
      ) : null}
    </div>
  );
}

function patchReel(page: ReelPage, videoId: string, patch: Partial<Reel>): ReelPage {
  return {
    ...page,
    items: page.items.map((item) => (item.videoId === videoId ? { ...item, ...patch } : item)),
  };
}

// ─── Comments ─────────────────────────────────────────────────────────────────

function CommentSheet({
  reel,
  onClose,
  onCount,
  signedIn,
}: {
  reel: Reel;
  onClose: () => void;
  onCount: (count: number) => void;
  signedIn: boolean;
}) {
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getComments("reel", reel.videoId)
      .then((thread) => {
        if (cancelled) return;
        setComments(thread.items);
        onCount(thread.summary.comments);
      })
      .catch(() => {
        if (!cancelled) {
          setComments([]);
          setError("Comments could not be loaded");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [reel.videoId, onCount]);

  const submit = useCallback(async () => {
    const body = draft.trim();
    if (!body) return;
    if (!hasSession()) {
      setError("Sign in to comment");
      return;
    }
    setBusy(true);
    setError(null);
    // Shown immediately, marked pending, and replaced by the server's row — a
    // comment that waits for a round trip before appearing reads as a dead box.
    const optimistic: Comment = {
      id: `pending-${Date.now()}`,
      targetType: "reel",
      targetId: reel.videoId,
      body,
      likeCount: 0,
      liked: false,
      createdAt: new Date().toISOString(),
      author: { id: "me", name: "You", avatarUrl: null },
      replies: [],
      replyCount: 0,
      pending: true,
    };
    setComments((current) => (current ? [optimistic, ...current] : [optimistic]));
    setDraft("");
    const parentId = replyTo?.id ?? null;
    setReplyTo(null);
    try {
      const saved = await postComment("reel", reel.videoId, body, parentId);
      setComments((current) =>
        (current ?? []).map((item) => (item.id === optimistic.id ? saved : item)),
      );
      onCount(reel.commentCount + 1);
    } catch {
      setComments((current) => (current ?? []).filter((item) => item.id !== optimistic.id));
      setDraft(body);
      setError("Your comment did not post");
    } finally {
      setBusy(false);
    }
  }, [draft, reel, replyTo, onCount]);

  const like = useCallback(async (comment: Comment) => {
    if (!hasSession()) {
      setError("Sign in to like a comment");
      return;
    }
    setComments((current) =>
      (current ?? []).map((item) =>
        item.id === comment.id
          ? { ...item, liked: !item.liked, likeCount: item.likeCount + (item.liked ? -1 : 1) }
          : item,
      ),
    );
    try {
      const result = await toggleCommentLike(comment.id);
      setComments((current) =>
        (current ?? []).map((item) => (item.id === comment.id ? { ...item, ...result } : item)),
      );
    } catch {
      setComments((current) =>
        (current ?? []).map((item) =>
          item.id === comment.id ? { ...item, liked: comment.liked, likeCount: comment.likeCount } : item,
        ),
      );
    }
  }, []);

  return (
    <Sheet title={`${reel.commentCount} comment${reel.commentCount === 1 ? "" : "s"}`} onClose={onClose}>
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={signedIn ? (replyTo ? `Replying to ${replyTo.author.name}` : "Add a comment…") : "Sign in to comment"}
          onKeyDown={(event) => {
            if (event.key === "Enter") void submit();
          }}
          disabled={!signedIn}
        />
        <button
          type="button"
          onClick={submit}
          disabled={busy || !draft.trim()}
          className="grid size-9 shrink-0 place-items-center rounded-full bg-ink-fill text-white disabled:opacity-40"
          aria-label="Post comment"
        >
          <Send size={18} aria-hidden />
        </button>
      </div>
      {error ? <p className="px-4 py-2 text-[12px] text-terracotta">{error}</p> : null}

      {comments === null ? <p className="px-4 py-3 text-[13px] text-ink-muted">Loading comments…</p> : null}
      {comments?.length === 0 ? <p className="px-4 py-3 text-[13px] text-ink-muted">No comments yet. Be the first.</p> : null}

      {comments?.map((comment) => (
        <div
          key={comment.id}
          className="border-b border-line/60 px-4 py-3 last:border-b-0 data-[pending]:opacity-60"
          data-pending={comment.pending || undefined}
        >
          <p className="text-[13.5px] leading-6 text-ink-soft">
            <strong>{comment.author.name}</strong> {comment.body}
          </p>
          <p className="mt-1 flex items-center gap-3 text-[11px] text-ink-muted">
            <span>{comment.pending ? "Sending…" : relativeTime(comment.createdAt)}</span>
            <button type="button" onClick={() => like(comment)} disabled={comment.pending}>
              <Heart size={13} fill={comment.liked ? "currentColor" : "none"} aria-hidden />
              {comment.likeCount > 0 ? comment.likeCount : "Like"}
            </button>
            <button type="button" onClick={() => setReplyTo(comment)} disabled={comment.pending}>
              Reply
            </button>
          </p>
          {comment.replies.map((reply) => (
            <div key={reply.id} className="mt-2 border-l-2 border-line pl-3">
              <p className="text-[13px] leading-6 text-ink-soft">
                <strong>{reply.author.name}</strong> {reply.body}
              </p>
              <p className="mt-0.5 text-[11px] text-ink-muted">{relativeTime(reply.createdAt)}</p>
            </div>
          ))}
        </div>
      ))}
    </Sheet>
  );
}

function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="absolute inset-0 z-40 flex items-end justify-center bg-ink-fill/60 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="fade-up max-h-[82vh] w-full max-w-[520px] overflow-y-auto rounded-t-[26px] bg-surface pb-[calc(env(safe-area-inset-bottom)+12px)] text-ink shadow-lift sm:rounded-[26px] sm:pb-3">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-surface px-5 py-4">
          <h2 className="font-display text-[17px] font-semibold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close">
            <X size={18} aria-hidden />
          </button>
        </header>
        <div className="space-y-1 p-2">{children}</div>
      </div>
    </div>
  );
}
