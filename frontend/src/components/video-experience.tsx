"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { Check, ChevronDown, Loader2, Play } from "lucide-react";
import { getVideoPageData } from "@/lib/data";
import { formatWhen } from "@/lib/format";
import { imgSrc } from "@/lib/image";
import type { VideoCard, VideoFacets, VideoPage, VideoSort } from "@/lib/types";

const FALLBACK_ART = "/images/worship-singer.jpg";
const ALL = "all";

/**
 * "Recently Added" is a genuinely different ordering from "Newest", not a second
 * name for it: `newest` ranks by the upload's own publish date, `added` by when
 * the poller first saw it. A channel uploading a five-year-old sermon today is
 * newly added and not newly published, and only one of those is what you want
 * when checking what has just turned up.
 */
const SORT_OPTIONS: { id: VideoSort; label: string }[] = [
  { id: "newest", label: "Newest" },
  { id: "views", label: "Most Viewed" },
  { id: "oldest", label: "Oldest" },
  { id: "added", label: "Recently Added" },
];

const PAGE_SIZE = 48;

/** Appended pages are kept apart from the server page so a filter reset is clean. */
function withUnique(items: VideoCard[], incoming: VideoCard[]): VideoCard[] {
  const seen = new Set(items.map((item) => item.id));
  const unique = incoming.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
  return unique.length > 0 ? [...items, ...unique] : items;
}

/**
 * The video page.
 *
 * A grid over `/api/video`, which spans songs, sermons and live broadcasts from
 * the ingested channels — deliberately a different query from `/api/videos`, so
 * sermons appear here too. The first page and the facets come from the server
 * component; only a filter change refetches, so the grid is never empty on load.
 */
export function VideoExperience({ initial, facets }: { initial: VideoPage; facets: VideoFacets }) {
  const [page, setPage] = useState(initial);
  const [appended, setAppended] = useState<VideoCard[]>([]);
  const [category, setCategory] = useState(ALL);
  const [region, setRegion] = useState(ALL);
  const [sort, setSort] = useState<VideoSort>("newest");
  const [loadingMore, setLoadingMore] = useState(false);
  const [loading, startTransition] = useTransition();
  const generationRef = useRef(0);

  const items = withUnique(page.items, appended);
  const hasMore = items.length < page.total;

  // The one place a filter change refetches. The whole request is inside the
  // transition scope, so `isPending` is true for the duration of the fetch rather
  // than only for the commit that follows it — and the current grid stays on
  // screen the whole time, so switching a chip does not flash empty.
  useEffect(() => {
    let cancelled = false;
    // A filter change increments this in its event handler, so an append from
    // the previous filters can no longer land in the new grid.
    const generation = generationRef.current;
    const query = {
      category: category === ALL ? undefined : category,
      region: region === ALL ? undefined : region,
      sort,
      limit: PAGE_SIZE,
    };
    startTransition(async () => {
      try {
        const next = await getVideoPageData(query);
        if (!cancelled && generation === generationRef.current) setPage(next);
      } catch {
        // Deliberately keep the current grid. Blanking it turns a failed request
        // into "the videos disappeared", which is both a lie and the most
        // confusing possible symptom; a stale grid is honest and still useful.
      }
    });
    return () => {
      cancelled = true;
    };
  }, [category, region, sort]);

  // Resetting here rather than in the fetch effect keeps filter changes out of
  // the effect body and invalidates any append still in flight.
  const changeFilter = () => {
    generationRef.current += 1;
    setAppended([]);
    setLoadingMore(false);
  };

  const loadMore = async () => {
    if (loading || loadingMore || !hasMore) return;
    const generation = generationRef.current;
    setLoadingMore(true);
    try {
      const next = await getVideoPageData({
        category: category === ALL ? undefined : category,
        region: region === ALL ? undefined : region,
        sort,
        limit: PAGE_SIZE,
        offset: items.length,
      });
      if (generation !== generationRef.current) return;
      const merged = withUnique(items, next.items);
      setAppended((current) => withUnique(current, next.items));
      // A page of duplicates means the catalogue moved under us; stop here
      // rather than offering a button that can never add another row.
      setPage((current) => ({ ...current, total: merged.length > items.length ? next.total : merged.length }));
    } catch {
      // Keep the on-screen grid; a failed append is not a failed catalogue.
    } finally {
      if (generation === generationRef.current) setLoadingMore(false);
    }
  };

  const chips = [
    { id: ALL, label: "All" },
    ...facets.categories.map((item) => ({ id: item.id, label: item.label })),
  ];

  return (
    <div className="fade-up mx-auto max-w-[1440px]">
      <header className="mb-6">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-gold">Watch</p>
        <h1 className="mt-2 font-display text-[34px] font-semibold leading-none tracking-[-0.04em] sm:text-[44px]">
          A front-row seat to the moments that matter.
        </h1>
      </header>

      <div className="no-scrollbar mb-6 flex gap-2 overflow-x-auto pb-1">
        {chips.map((chip) => (
          <button
            key={chip.id}
            type="button"
            onClick={() => {
              changeFilter();
              setCategory(chip.id);
            }}
            aria-pressed={category === chip.id}
            className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition ${
              category === chip.id
                ? "bg-ink-fill text-white"
                : "border border-line bg-surface text-ink-muted hover:border-gold/50 hover:text-ink"
            }`}
          >
            {chip.label}
          </button>
        ))}
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Dropdown
          label="Region"
          value={region}
          options={[
            { id: ALL, label: "Everywhere" },
            ...facets.regions.map((item) => ({ id: item.id, label: item.label })),
          ]}
          onChange={(value) => {
            changeFilter();
            setRegion(value);
          }}
        />
        <Dropdown
          label="Sort by"
          value={sort}
          options={SORT_OPTIONS.map((option) => ({ id: option.id, label: option.label }))}
          onChange={(value) => {
            changeFilter();
            setSort(value as VideoSort);
          }}
        />
      </div>

      {items.length === 0 ? (
        <div className="rounded-[22px] border border-dashed border-line bg-surface p-12 text-center text-sm text-ink-muted">
          Nothing here yet. Try a different category or region.
        </div>
      ) : (
        <div
          className={`grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 ${loading ? "opacity-60" : ""}`}
          aria-busy={loading || loadingMore}
        >
          {items.map((video, index) => (
            <GridCard key={video.id} video={video} eager={index < 4} />
          ))}
        </div>
      )}

      {hasMore && items.length > 0 ? (
        <div className="mt-8 flex justify-center">
          <button
            type="button"
            onClick={() => void loadMore()}
            disabled={loading || loadingMore}
            className="inline-flex h-12 min-w-[210px] items-center justify-center gap-2 rounded-full border border-line bg-surface px-6 text-sm font-semibold text-ink shadow-soft transition hover:border-gold/60 hover:bg-surface-soft disabled:cursor-wait disabled:opacity-60"
          >
            {loading || loadingMore ? (
              <>
                <Loader2 size={16} className="animate-spin" aria-hidden="true" /> Loading videos…
              </>
            ) : (
              "Load more videos"
            )}
          </button>
        </div>
      ) : null}

      {!hasMore && items.length > 0 && !loading ? (
        <p className="mx-auto mt-8 flex w-fit items-center gap-2 rounded-full border border-line bg-surface-soft px-4 py-2 text-xs font-medium text-ink-muted">
          <Check size={14} className="text-sage" aria-hidden="true" /> You have reached the end of the catalogue.
        </p>
      ) : null}
    </div>
  );
}

function Dropdown({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { id: string; label: string }[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((option) => option.id === value);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="inline-flex h-9 items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 text-sm font-semibold text-ink transition hover:border-gold/50"
      >
        {label}: <span className="text-ink-muted">{current?.label ?? value}</span>
        <ChevronDown size={14} className={`transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? (
        <>
          {/* Clicking away closes the list without needing a document listener. */}
          <button
            type="button"
            aria-label="Close menu"
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
          />
          <ul
            role="listbox"
            className="absolute left-0 top-11 z-20 min-w-[190px] overflow-hidden rounded-2xl border border-line bg-surface py-1.5 shadow-lift"
          >
            {options.map((option) => (
              <li key={option.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={option.id === value}
                  onClick={() => {
                    onChange(option.id);
                    setOpen(false);
                  }}
                  className="flex w-full items-center justify-between gap-3 px-3.5 py-2 text-left text-sm text-ink transition hover:bg-surface-soft"
                >
                  {option.label}
                  {option.id === value ? <Check size={14} className="text-terracotta" /> : null}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

function GridCard({ video, eager = false }: { video: VideoCard; eager?: boolean }) {
  return (
    <article className="group">
      {/* The thumb is the play affordance: it starts playback, the title does not. */}
      <Link href={`/videos/${video.videoId}?play=1`} className="block" aria-label={`Play ${video.title}`}>
        <div className="relative aspect-video overflow-hidden rounded-[18px] bg-surface-soft">
          <Image
            src={imgSrc(video.thumbnail, FALLBACK_ART)}
            alt=""
            fill
            priority={eager}
            sizes="(max-width: 640px) 100vw, (max-width: 1280px) 33vw, 25vw"
            className="object-cover transition duration-500 group-hover:scale-105"
          />
          {video.isLive ? (
            <span className="absolute left-2.5 top-2.5 inline-flex items-center gap-1.5 rounded-full bg-terracotta px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-white">
              <span className="size-1.5 rounded-full bg-white" /> Live
            </span>
          ) : null}
          <span className="absolute bottom-2.5 right-2.5 rounded-md bg-ink-fill/85 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-white">
            {video.duration}
          </span>
          <span className="absolute inset-0 grid place-items-center bg-ink-fill/25 transition group-hover:bg-ink-fill/40">
            <span className="grid size-12 place-items-center rounded-full bg-ink-fill/80 text-white shadow-lift transition group-hover:bg-terracotta">
              <Play size={18} fill="currentColor" className="translate-x-0.5" aria-hidden="true" />
            </span>
          </span>
        </div>
      </Link>
      <div className="mt-3">
        <Link href={`/videos/${video.videoId}`} className="block">
          <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-ink transition group-hover:text-terracotta">
            {video.title}
          </h3>
        </Link>
        <p className="mt-1.5 truncate text-xs text-ink-muted">{video.channel}</p>
        <p className="mt-0.5 text-xs text-ink-muted">{formatWhen(video.publishedAt)}</p>
      </div>
    </article>
  );
}
