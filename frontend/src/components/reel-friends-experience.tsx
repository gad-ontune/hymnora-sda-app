"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  ArrowLeft, Check, ChevronRight, Compass, Heart, Info, LoaderCircle,
  Plus, Sparkles, UserPlus, Users,
} from "lucide-react";
import { SectionHeading } from "@/components/section-heading";
import { followTarget, getFollows, getReelFacets, getReels, unfollowTarget } from "@/lib/api";
import { hasSession } from "@/lib/session";
import type {
  FollowEntry, FollowTargetType, FollowsSummary, Reel, ReelFacets, ReelPage,
} from "@/lib/types";

/**
 * Friends — the social view of the reels feed.
 *
 * Follows and the "Following" feed are personal, so the server's first paint is
 * deliberately only a starting point; once the browser knows there is a token
 * both are asked again. Suggestions are built from public facets and shelves,
 * which is why they are still useful to somebody who has not signed in.
 */

type Props = {
  initialFacets: ReelFacets | null;
  initialFollowing: ReelPage | null;
  initialPublic: ReelPage | null;
};

type Suggestion = {
  type: FollowTargetType;
  id: string;
  label: string;
  detail: string;
  badge: string;
};

const SIGN_IN = "/signin?next=%2Freels%2Ffriends";

const FOLLOW_GROUPS: { type: FollowTargetType; label: string }[] = [
  { type: "creator", label: "Channels" },
  { type: "choir", label: "Choirs" },
  { type: "church", label: "Churches" },
  { type: "ministry", label: "Ministries" },
  { type: "topic", label: "Topics" },
  { type: "region", label: "Regions" },
];

const FALLBACK_SUGGESTIONS: Suggestion[] = [
  { type: "topic", id: "worship", label: "Worship", detail: "Songs, praise and divine service", badge: "Topic" },
  { type: "topic", id: "choirs", label: "Choirs", detail: "Voices raised together", badge: "Topic" },
  { type: "topic", id: "testimonies", label: "Testimonies", detail: "What God has done", badge: "Topic" },
  { type: "region", id: "East Africa", label: "East Africa", detail: "Reels from the region", badge: "Region" },
  { type: "region", id: "North America", label: "North America", detail: "Reels from the region", badge: "Region" },
];

function subscribeToSession(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}
const readSession = () => hasSession();
const readSessionOnServer = () => false;

function keyFor(type: FollowTargetType, id: string): string {
  return `${type}:${id}`;
}

function initials(label: string): string {
  const words = label.split(/\s+/).filter(Boolean).slice(0, 2);
  return words.map((word) => word[0]?.toUpperCase() ?? "").join("") || "?";
}

function avatarClass(seed: string): string {
  const palettes = [
    "bg-gold-soft text-ink",
    "bg-sage-soft text-ink",
    "bg-terracotta-soft text-ink",
    "bg-surface-soft text-ink",
  ];
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return palettes[hash % palettes.length] ?? palettes[0];
}

function formatCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(value);
}

function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-terracotta/30 bg-terracotta-soft/50 p-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-ink-soft">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="shrink-0 rounded-full border border-line bg-surface px-3 py-1.5 text-[12px] font-semibold text-ink transition hover:border-gold"
      >
        Try again
      </button>
    </div>
  );
}

function RowSkeleton() {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-3">
      <span className="size-10 shrink-0 animate-pulse rounded-full bg-surface-soft" />
      <div className="flex-1 space-y-2">
        <span className="block h-3 w-2/3 animate-pulse rounded bg-surface-soft" />
        <span className="block h-2.5 w-1/3 animate-pulse rounded bg-surface-soft" />
      </div>
    </div>
  );
}

function CardSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="aspect-[9/13] animate-pulse bg-surface-soft" />
      <div className="space-y-2 p-3">
        <span className="block h-3 w-4/5 animate-pulse rounded bg-surface-soft" />
        <span className="block h-2.5 w-1/2 animate-pulse rounded bg-surface-soft" />
      </div>
    </div>
  );
}

function FollowButton({
  target,
  isFollowing,
  pending,
  signedIn,
  onClick,
}: {
  target: Suggestion | FollowEntry;
  isFollowing: boolean;
  pending: boolean;
  signedIn: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={pending}
      onClick={onClick}
      title={signedIn ? (isFollowing ? `Unfollow ${target.label}` : `Follow ${target.label}`) : "Sign in to follow"}
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-[11px] font-bold transition disabled:opacity-50 ${
        isFollowing
          ? "border border-line bg-surface-soft text-ink-soft hover:border-terracotta/50"
          : "bg-ink-fill text-white hover:opacity-90"
      }`}
    >
      {pending ? <LoaderCircle size={12} className="animate-spin" aria-hidden /> : null}
      {!pending && isFollowing ? <Check size={12} aria-hidden /> : null}
      {!pending && !isFollowing ? <Plus size={12} aria-hidden /> : null}
      {pending ? "Saving" : isFollowing ? "Following" : "Follow"}
    </button>
  );
}

export function ReelFriendsExperience({ initialFacets, initialFollowing, initialPublic }: Props) {
  const signedIn = useSyncExternalStore(subscribeToSession, readSession, readSessionOnServer);

  const [facets, setFacets] = useState<ReelFacets | null>(initialFacets);
  const [circle, setCircle] = useState<ReelPage | null>(initialFollowing);
  const [publicFeed, setPublicFeed] = useState<ReelPage | null>(initialPublic);
  const [follows, setFollows] = useState<FollowEntry[]>([]);
  const [summary, setSummary] = useState<FollowsSummary | null>(null);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [loadingFollows, setLoadingFollows] = useState(false);
  const [loadingCircle, setLoadingCircle] = useState(false);
  const [followsError, setFollowsError] = useState<string | null>(null);
  const [circleError, setCircleError] = useState<string | null>(null);
  const [suggestionsError, setSuggestionsError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [brokenThumbs, setBrokenThumbs] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      if (!signedIn) {
        setFollows([]);
        setSummary(null);
        setFollowsError(null);
        setCircleError(null);
        return;
      }
      setLoadingFollows(true);
      setLoadingCircle(true);
      void Promise.allSettled([getFollows(), getReels({ feed: "following", limit: 12 })]).then(
        ([followResult, circleResult]) => {
          if (cancelled) return;
          if (followResult.status === "fulfilled") {
            setFollows(followResult.value.items);
            setSummary(followResult.value.summary);
            setFollowsError(null);
          } else {
            setFollowsError("Your following list could not be loaded right now.");
          }
          if (circleResult.status === "fulfilled") {
            setCircle(circleResult.value);
            setCircleError(null);
          } else {
            setCircleError("Your circle could not be loaded right now.");
          }
          setLoadingFollows(false);
          setLoadingCircle(false);
        },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [signedIn, reloadKey]);

  useEffect(() => {
    if (facets && publicFeed) return;
    let cancelled = false;
    void Promise.allSettled([
      facets ? Promise.resolve(facets) : getReelFacets(),
      publicFeed ? Promise.resolve(publicFeed) : getReels({ feed: "for-you", limit: 12 }),
    ]).then(([facetResult, publicResult]) => {
      if (cancelled) return;
      if (facetResult.status === "fulfilled") {
        setFacets(facetResult.value);
        setSuggestionsError(null);
      } else {
        setSuggestionsError("Suggestions could not be refreshed, so a short curated list is shown.");
      }
      if (publicResult.status === "fulfilled") setPublicFeed(publicResult.value);
    });
    return () => {
      cancelled = true;
    };
  }, [facets, publicFeed, reloadKey]);

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(null), 3200);
    return () => clearTimeout(timer);
  }, [message]);

  const followed = useMemo(
    () => new Set(follows.map((entry) => keyFor(entry.type, entry.id))),
    [follows],
  );

  const groupedFollows = useMemo(() => {
    const groups = new Map<FollowTargetType, FollowEntry[]>();
    for (const entry of follows) {
      const bucket = groups.get(entry.type) ?? [];
      bucket.push(entry);
      groups.set(entry.type, bucket);
    }
    return groups;
  }, [follows]);

  const suggestions = useMemo(() => {
    const list: Suggestion[] = [];
    const seen = new Set<string>();
    const add = (suggestion: Suggestion) => {
      const key = keyFor(suggestion.type, suggestion.id);
      if (seen.has(key) || followed.has(key)) return;
      seen.add(key);
      list.push(suggestion);
    };

    const shelves = [...(facets?.categories ?? [])].sort((a, b) => b.count - a.count).slice(0, 7);
    for (const shelf of shelves) {
      add({
        type: "topic",
        id: shelf.id,
        label: shelf.label,
        detail: `${shelf.count} ${shelf.count === 1 ? "reel" : "reels"} on this shelf`,
        badge: "Topic",
      });
    }

    const regions = [...(facets?.regions ?? [])].sort((a, b) => b.count - a.count).slice(0, 3);
    for (const region of regions) {
      add({
        type: "region",
        id: region.id,
        label: region.label,
        detail: `${region.count} ${region.count === 1 ? "reel" : "reels"} from this region`,
        badge: "Region",
      });
    }

    const channels = new Map<string, { label: string; count: number; followers: number }>();
    for (const reel of publicFeed?.items ?? []) {
      const current = channels.get(reel.channelId);
      channels.set(reel.channelId, {
        label: reel.channel,
        count: (current?.count ?? 0) + 1,
        followers: Math.max(current?.followers ?? 0, reel.channelFollowers),
      });
    }
    const topChannels = [...channels.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 4);
    for (const [id, info] of topChannels) {
      add({
        type: "creator",
        id,
        label: info.label,
        detail: info.followers > 0 ? `${formatCount(info.followers)} followers` : `${info.count} reels in the mix`,
        badge: "Channel",
      });
    }

    if (list.length === 0) for (const fallback of FALLBACK_SUGGESTIONS) add(fallback);
    return list.slice(0, 12);
  }, [facets, publicFeed, followed]);

  const toggleFollow = useCallback(
    async (target: Suggestion | FollowEntry) => {
      if (!signedIn) {
        setMessage("Sign in to follow channels, choirs and topics.");
        return;
      }
      const key = keyFor(target.type, target.id);
      if (pending.has(key)) return;
      const wasFollowing = followed.has(key);
      setPending((current) => new Set(current).add(key));
      try {
        if (wasFollowing) await unfollowTarget(target.type, target.id);
        else await followTarget(target.type, target.id, target.label);
        setFollows((current) =>
          wasFollowing
            ? current.filter((entry) => keyFor(entry.type, entry.id) !== key)
            : [
                ...current,
                {
                  type: target.type,
                  id: target.id,
                  label: target.label,
                  meta: {},
                  notifyNew: true,
                  createdAt: new Date().toISOString(),
                },
              ],
        );
        setMessage(wasFollowing ? `Unfollowed ${target.label}` : `Following ${target.label}`);
        // The follow itself succeeded; a stale circle is better than a false error.
        const refreshed = await getReels({ feed: "following", limit: 12 }).catch(() => null);
        if (refreshed) setCircle(refreshed);
      } catch {
        setMessage("That did not save. Try again in a moment.");
      } finally {
        setPending((current) => {
          const next = new Set(current);
          next.delete(key);
          return next;
        });
      }
    },
    [signedIn, pending, followed],
  );

  const markThumbFailed = useCallback((id: string) => {
    setBrokenThumbs((current) => (current.has(id) ? current : new Set(current).add(id)));
  }, []);

  const circleItems = circle?.items ?? [];
  const personalised = signedIn && circle?.personalised === true;

  return (
    <main className="min-h-screen bg-canvas text-ink">
      <header className="sticky top-0 z-20 border-b border-line bg-surface/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:px-6">
          <Link
            href="/reels"
            className="flex shrink-0 items-center gap-1.5 rounded-full bg-surface-soft px-3 py-1.5 text-[12px] font-semibold text-ink-soft transition hover:bg-gold-soft"
          >
            <ArrowLeft size={16} aria-hidden />
            <span className="hidden sm:inline">Reels</span>
          </Link>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="font-display text-xl font-semibold tracking-tight sm:text-2xl">Friends</h1>
              <span className="rounded-full bg-gold-soft px-2 py-0.5 text-[10px] font-bold text-ink">
                {summary ? summary.total : follows.length} following
              </span>
            </div>
            <p className="truncate text-xs text-ink-muted">
              The people, choirs and causes behind the reels you watch.
            </p>
          </div>
          <Link
            href="/reels/create"
            className="hidden shrink-0 rounded-full bg-ink-fill px-3 py-1.5 text-[12px] font-semibold text-white transition hover:opacity-90 sm:inline-flex"
          >
            Create a reel
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-6xl space-y-10 px-4 py-7 sm:px-6">
        {!signedIn ? (
          <div className="flex flex-col gap-3 rounded-2xl border border-gold/30 bg-gold-soft/55 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex gap-3">
              <Info size={18} className="mt-0.5 shrink-0 text-ink-soft" aria-hidden />
              <div>
                <p className="text-sm font-bold">Make this page yours</p>
                <p className="mt-0.5 text-[12px] leading-5 text-ink-soft">
                  Sign in to see who you follow and to follow new channels. Public suggestions stay visible.
                </p>
              </div>
            </div>
            <Link
              href={SIGN_IN}
              className="inline-flex shrink-0 items-center justify-center gap-1 rounded-full bg-ink-fill px-4 py-2 text-[12px] font-semibold text-white transition hover:opacity-90"
            >
              Sign in <ChevronRight size={14} aria-hidden />
            </Link>
          </div>
        ) : null}

        {message ? (
          <p role="status" className="rounded-xl bg-sage-soft px-3 py-2 text-center text-[12px] font-semibold text-ink">
            {message}
          </p>
        ) : null}

        <section>
          <SectionHeading
            eyebrow="Your circle"
            title="People you follow"
            description="Channels, choirs and ministries whose new reels deserve a place in your feed."
          />
          {!signedIn ? (
            <div className="rounded-2xl border border-dashed border-line bg-surface p-6 text-center">
              <UserPlus size={24} className="mx-auto text-gold" aria-hidden />
              <p className="mt-2 text-sm font-semibold">Sign in to see the people you follow</p>
              <p className="mt-1 text-[12px] text-ink-muted">
                Your follows live with your account, not in this browser.
              </p>
              <Link
                href={SIGN_IN}
                className="mt-3 inline-flex rounded-full bg-ink-fill px-4 py-2 text-[12px] font-semibold text-white transition hover:opacity-90"
              >
                Sign in
              </Link>
            </div>
          ) : followsError ? (
            <ErrorCard message={followsError} onRetry={() => setReloadKey((value) => value + 1)} />
          ) : loadingFollows && follows.length === 0 ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }, (_, index) => <RowSkeleton key={index} />)}
            </div>
          ) : follows.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-line bg-surface p-6 text-center">
              <Users size={24} className="mx-auto text-gold" aria-hidden />
              <p className="mt-2 text-sm font-semibold">You are not following anyone yet</p>
              <p className="mt-1 text-[12px] leading-5 text-ink-muted">
                Follow a topic or a channel below and its reels will gather here.
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {FOLLOW_GROUPS.filter((group) => (groupedFollows.get(group.type)?.length ?? 0) > 0).map((group) => {
                const entries = groupedFollows.get(group.type) ?? [];
                return (
                  <div key={group.type}>
                    <div className="mb-2 flex items-center gap-2">
                      <Users size={15} className="text-gold" aria-hidden />
                      <h3 className="text-[13px] font-bold text-ink">{group.label}</h3>
                      <span className="rounded-full bg-surface-soft px-2 py-0.5 text-[10px] font-bold text-ink-muted">
                        {entries.length}
                      </span>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {entries.map((entry) => {
                        const key = keyFor(entry.type, entry.id);
                        return (
                          <div key={key} className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-3 shadow-soft">
                            <span
                              className={`grid size-10 shrink-0 place-content-center rounded-full text-sm font-bold ${avatarClass(entry.label)}`}
                            >
                              {initials(entry.label)}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-semibold">{entry.label}</p>
                              <p className="truncate text-[11px] text-ink-muted">{group.label} · Following</p>
                            </div>
                            <FollowButton
                              target={entry}
                              isFollowing
                              pending={pending.has(key)}
                              signedIn={signedIn}
                              onClick={() => {
                                void toggleFollow(entry);
                              }}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section>
          <SectionHeading
            eyebrow="Grow your feed"
            title="Suggested for you"
            description="Drawn from the Reels shelves, regions and channels already in the catalogue."
          />
          {suggestionsError ? (
            <p className="mb-3 rounded-xl bg-terracotta-soft/60 px-3 py-2 text-[12px] text-ink-soft">
              {suggestionsError}
            </p>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {suggestions.map((suggestion) => {
              const key = keyFor(suggestion.type, suggestion.id);
              return (
                <div key={key} className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-3 shadow-soft">
                  <span
                    className={`grid size-10 shrink-0 place-content-center rounded-full text-sm font-bold ${avatarClass(suggestion.label)}`}
                  >
                    {initials(suggestion.label)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <p className="truncate text-sm font-semibold">{suggestion.label}</p>
                      <span className="shrink-0 rounded-full bg-gold-soft px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-ink">
                        {suggestion.badge}
                      </span>
                    </div>
                    <p className="truncate text-[11px] text-ink-muted">{suggestion.detail}</p>
                  </div>
                  <FollowButton
                    target={suggestion}
                    isFollowing={followed.has(key)}
                    pending={pending.has(key)}
                    signedIn={signedIn}
                    onClick={() => {
                      void toggleFollow(suggestion);
                    }}
                  />
                </div>
              );
            })}
          </div>
        </section>

        <section>
          <SectionHeading
            eyebrow="From your follows"
            title="Reels from your circle"
            description="A smaller, closer feed built from the channels and topics you follow."
          />
          {!signedIn || !personalised ? (
            <div className="mb-4 flex items-start gap-2 rounded-2xl bg-gold-soft/45 px-4 py-3 text-[12px] leading-5 text-ink-soft">
              <Sparkles size={15} className="mt-0.5 shrink-0 text-gold" aria-hidden />
              <p>
                {signedIn
                  ? "Nothing from your follows has landed here yet, so a taste of the public feed is shown instead."
                  : "This is a public taste of Reels. Sign in and follow a channel to make it your circle."}
              </p>
            </div>
          ) : null}

          {circleError ? (
            <ErrorCard message={circleError} onRetry={() => setReloadKey((value) => value + 1)} />
          ) : loadingCircle && !circle ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }, (_, index) => <CardSkeleton key={index} />)}
            </div>
          ) : circleItems.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-line bg-surface p-8 text-center">
              <Compass size={26} className="mx-auto text-gold" aria-hidden />
              <p className="mt-2 text-sm font-semibold">No reels in this circle yet</p>
              <p className="mt-1 text-[12px] leading-5 text-ink-muted">
                Follow a topic above, or browse the full feed and follow a channel from there.
              </p>
              <Link
                href="/reels"
                className="mt-3 inline-flex rounded-full bg-ink-fill px-4 py-2 text-[12px] font-semibold text-white transition hover:opacity-90"
              >
                Browse Reels
              </Link>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {circleItems.map((item: Reel) => (
                <Link
                  key={item.videoId}
                  href={`/reels?reel=${encodeURIComponent(item.videoId)}`}
                  className="group overflow-hidden rounded-2xl border border-line bg-surface shadow-soft transition hover:-translate-y-0.5 hover:shadow-lift"
                >
                  <div className="relative aspect-[9/13] overflow-hidden bg-ink-fill">
                    {brokenThumbs.has(item.videoId) ? (
                      <div className={`grid size-full place-content-center gap-2 text-center ${avatarClass(item.channel)}`}>
                        <span className="mx-auto text-2xl font-bold">{initials(item.channel)}</span>
                        <span className="px-4 text-[11px] font-semibold">{item.channel}</span>
                      </div>
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={item.thumbnail}
                        alt=""
                        loading="lazy"
                        onError={() => markThumbFailed(item.videoId)}
                        className="size-full object-cover transition duration-500 group-hover:scale-105"
                      />
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
                    <span className="absolute left-2 top-2 rounded-full bg-gold px-2 py-0.5 text-[10px] font-bold text-ink">
                      {item.reelCategoryLabel}
                    </span>
                    <span className="absolute right-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-bold text-white">
                      {item.duration}
                    </span>
                    <div className="absolute inset-x-0 bottom-0 p-3">
                      <p className="line-clamp-2 font-display text-base leading-tight text-white">{item.title}</p>
                      <p className="mt-1 truncate text-[11px] text-white/70">{item.channel}</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2 px-3 py-2.5 text-[11px] text-ink-muted">
                    <span className="truncate">{item.regionLabel}</span>
                    <span className="inline-flex shrink-0 items-center gap-1">
                      <Heart size={12} aria-hidden /> {formatCount(item.likeCount)}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
