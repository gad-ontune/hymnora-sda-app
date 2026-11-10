"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  ArrowRight, Bookmark, Check, Film, Heart, Newspaper, Search, Share2, Sparkles,
} from "lucide-react";
import { useHymnora } from "@/components/hymnora-provider";
import { useFavorites } from "@/lib/favorites";
import { toggleFollowSync, useFollows } from "@/lib/follows";
import type { NewsArticle, NewsFacets } from "@/lib/types";
import { imgSrc } from "@/lib/image";

/**
 * News & Reels — one destination, two ways in.
 *
 * The newsroom is editorial: a featured story, categories with real counts, a
 * searchable list and a trending rail. Reels is its opposite — full-bleed, sound
 * first, organised around the people and ministries who made it. They share a
 * section because they are the same promise (what the church is saying right
 * now), but they deliberately do not share a layout.
 */

type Props = {
  articles: NewsArticle[];
  facets: NewsFacets;
  /** Only for the "Reels" link's counter; the feed itself lives on /reels. */
  reelCount: number;
};

/**
 * Which face of the section is on screen, held in the URL hash so the two can be
 * linked to directly. `history.replaceState` does not fire `hashchange`, hence
 * the local event the switch dispatches itself.
 */
const SECTION_EVENT = "hymnora:section";

function subscribeSection(listener: () => void) {
  window.addEventListener("hashchange", listener);
  window.addEventListener(SECTION_EVENT, listener);
  return () => {
    window.removeEventListener("hashchange", listener);
    window.removeEventListener(SECTION_EVENT, listener);
  };
}

function readSection(): "news" | "reels" {
  return window.location.hash === "#reels" ? "reels" : "news";
}

/**
 * Reels is a whole page of its own, so "Reels" here is a link and not a tab.
 * The tab survived only because older links still arrive with `#reels` on the
 * URL; that view redirects, and the real page takes over from there.
 */
const REELS_HREF = "/reels";

const readSectionOnServer = () => "news" as const;

function useSectionView() {
  return useSyncExternalStore(subscribeSection, readSection, readSectionOnServer);
}

export function NewsExperience({ articles, facets, reelCount }: Props) {
  const view = useSectionView();
  const [category, setCategory] = useState("All");
  const [query, setQuery] = useState("");

  // Back to the newsroom proper: drop `#reels` without reloading, so the
  // reader's filters and scroll position survive a trip to the reels page.
  const open = useCallback(() => {
    if (typeof window === "undefined") return;
    window.history.replaceState(null, "", window.location.pathname);
    window.dispatchEvent(new Event(SECTION_EVENT));
  }, []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return articles.filter((article) => {
      if (category !== "All" && article.category !== category) return false;
      if (!needle) return true;
      return [article.title, article.excerpt, article.source, article.category, ...article.tags]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [articles, category, query]);

  const featured = useMemo(
    () => filtered.find((article) => article.featured) ?? filtered[0] ?? null,
    [filtered],
  );
  const rest = featured ? filtered.filter((article) => article.id !== featured.id) : filtered;

  return (
    <div className="fade-up">
      <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.2em] text-gold">News &amp; Reels</p>
          <h1 className="font-display text-[36px] font-semibold leading-[1.04] tracking-[-0.035em] text-ink sm:text-[44px]">The Hymnora newsroom.</h1>
          <p className="mt-3 max-w-xl text-[15px] leading-7 text-ink-muted">Stories from across the world church, and the voices worth watching — gathered in one place.</p>
        </div>
        <div className="flex shrink-0 gap-1.5 rounded-full border border-line bg-surface p-1.5 shadow-soft">
          <SwitchButton active={view === "news"} onClick={open} icon={<Newspaper size={15} />} label="News" count={articles.length} />
          <ReelsButton count={reelCount} />
        </div>
      </div>

      {view === "reels" ? (
        /* Deep-linked from an older #reels link: hand over to the real page. */
        <RedirectToReels />
      ) : (
        <div className="lg:grid lg:grid-cols-[210px_minmax(0,1fr)_300px] lg:gap-6">
          {/* Left rail — the section's own navigation, then the desks. */}
          <aside className="hidden lg:block">
            <div className="sticky top-24 space-y-5">
              <div className="rounded-2xl border border-line bg-surface p-2 shadow-soft">
                <p className="px-3 pb-2 pt-1 text-[10px] font-bold uppercase tracking-[0.18em] text-ink-muted">News &amp; Reels</p>
                <RailLink active onClick={open} icon={<Newspaper size={16} />} label="Newsroom" />
                <a href={REELS_HREF}>
                  <RailLink active={false} icon={<Film size={16} />} label="Reels" />
                </a>
              </div>
              <div className="rounded-2xl border border-line bg-surface p-4 shadow-soft">
                <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.18em] text-ink-muted">Desks</p>
                <div className="space-y-1">
                  <DeskButton active={category === "All"} onClick={() => setCategory("All")} label="All stories" count={articles.length} />
                  {facets.categories.map((desk) => (
                    <DeskButton key={desk.category} active={category === desk.category} onClick={() => setCategory(desk.category)} label={desk.category} count={desk.count} />
                  ))}
                </div>
              </div>
            </div>
          </aside>

          {/* Centre column — search, chips, featured story and the list. */}
          <div className="min-w-0">
            <div className="mb-4 flex items-center gap-2">
              <label className="relative flex-1">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-muted" size={17} />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  type="search"
                  placeholder="Search the newsroom…"
                  className="h-12 w-full rounded-2xl border border-line bg-surface pl-11 pr-4 text-sm text-ink outline-none transition placeholder:text-ink-muted/80 focus:border-gold/70 focus:ring-4 focus:ring-gold/10"
                />
              </label>
            </div>

            <div className="no-scrollbar mb-5 flex gap-2 overflow-x-auto pb-1">
              <DeskChip active={category === "All"} onClick={() => setCategory("All")} label="All" />
              {facets.categories.map((desk) => (
                <DeskChip key={desk.category} active={category === desk.category} onClick={() => setCategory(desk.category)} label={desk.category} count={desk.count} />
              ))}
            </div>

            {featured ? <FeaturedCard article={featured} /> : null}

            <div className="mt-6 space-y-4">
              {rest.map((article) => <ArticleRow key={article.id} article={article} onTag={() => setCategory(article.category)} />)}
              {rest.length === 0 && featured ? (
                <p className="rounded-2xl border border-line bg-surface p-6 text-center text-sm text-ink-muted">That is the whole desk for now.</p>
              ) : null}
              {!featured ? (
                <div className="rounded-2xl border border-dashed border-line bg-surface p-10 text-center">
                  <p className="font-display text-lg font-semibold text-ink">No stories match that search.</p>
                  <p className="mt-1.5 text-sm text-ink-muted">Try another desk or clear the search.</p>
                </div>
              ) : null}
            </div>
          </div>

          {/* Right rail — trending, most saved, and who to follow. */}
          <aside className="mt-8 lg:mt-0">
            <div className="sticky top-24 space-y-5">
              <div className="rounded-2xl border border-line bg-surface p-5 shadow-soft">
                <p className="mb-3 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-gold"><Sparkles size={13} /> Trending</p>
                <div className="flex flex-wrap gap-2">
                  {facets.categories.slice(0, 6).map((topic) => (
                    <button
                      key={topic.category}
                      type="button"
                      onClick={() => setCategory(topic.category)}
                      className="rounded-full border border-line bg-canvas px-3 py-1.5 text-xs font-semibold text-ink-soft transition hover:border-gold/60 hover:text-ink"
                    >
                      #{topic.category} <span className="text-ink-muted">{topic.count}</span>
                    </button>
                  ))}
                </div>
              </div>
              <MostSaved articles={articles} onTag={setCategory} />
              <FollowTopics facets={facets} />
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

function SwitchButton({ active, onClick, icon, label, count }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; count: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold transition ${active ? "bg-ink-fill text-white shadow-lift" : "text-ink-muted hover:text-ink"}`}
    >
      {icon}
      {label}
      <span className={`text-[10px] tabular-nums ${active ? "text-gold-light" : "text-ink-muted/60"}`}>{count}</span>
    </button>
  );
}

function RailLink({ active, onClick, icon, label }: { active: boolean; onClick?: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${active ? "bg-canvas text-ink" : "text-ink-muted hover:text-ink"}`}
    >
      {icon}
      {label}
    </button>
  );
}

/** The reels entry point, styled as the second half of the News/Reels switch. */
function ReelsButton({ count }: { count: number }) {
  return (
    <Link
      href={REELS_HREF}
      className="flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold text-ink-muted transition hover:text-ink"
    >
      <Film size={15} />
      Reels
      <span className="text-[10px] tabular-nums text-ink-muted/60">{count}</span>
    </Link>
  );
}

/** `#reels` on the newsroom URL is an old deep link; the page has its own route. */
function RedirectToReels() {
  useEffect(() => {
    window.location.replace(REELS_HREF);
  }, []);
  return (
    <p className="py-16 text-center text-sm text-ink-muted">Taking you to Reels…</p>
  );
}

function DeskButton({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-sm font-medium transition ${active ? "bg-sage-soft text-sage" : "text-ink-muted hover:bg-canvas hover:text-ink"}`}
    >
      {label}
      <span className="text-xs tabular-nums text-ink-muted">{count}</span>
    </button>
  );
}

function DeskChip({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count?: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition ${active ? "bg-ink-fill text-white" : "border border-line bg-surface text-ink-soft hover:border-gold/60"}`}
    >
      {label}{count !== undefined ? <span className={`ml-1.5 text-xs ${active ? "text-gold-light" : "text-ink-muted"}`}>{count}</span> : null}
    </button>
  );
}

function FeaturedCard({ article }: { article: NewsArticle }) {
  return (
    <Link href={`/news/${article.slug}`} className="group block overflow-hidden rounded-3xl border border-line bg-surface shadow-soft transition hover:shadow-lift">
      <div className="relative aspect-[16/9] w-full overflow-hidden">
        <Image src={imgSrc(article.image, "/images/golden-hour.jpg")} alt="" fill sizes="(max-width: 1024px) 100vw, 640px" className="object-cover warm-image transition duration-500 group-hover:scale-[1.03]" priority />
        <span className="absolute left-4 top-4 rounded-full bg-gold px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-ink">{article.category}</span>
      </div>
      <div className="p-5 sm:p-6">
        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-gold">Featured · {article.source}</p>
        <h2 className="mt-2 font-display text-[24px] font-semibold leading-snug tracking-[-0.025em] text-ink sm:text-[28px]">{article.title}</h2>
        <p className="mt-2.5 line-clamp-2 text-sm leading-7 text-ink-muted">{article.excerpt}</p>
        <div className="mt-4 flex items-center gap-3 text-xs text-ink-muted">
          <span className="font-semibold text-ink-soft">{article.author ?? article.source}</span>
          <span>{article.region ?? article.category}</span>
          <span>{article.date}</span>
          <span className="flex items-center gap-1"><Check size={13} className="text-gold" /> {article.readTime}</span>
        </div>
      </div>
    </Link>
  );
}

function ArticleRow({ article, onTag }: { article: NewsArticle; onTag: () => void }) {
  const { isFavorite, toggleFavorite } = useHymnora();
  const saved = isFavorite(article.id);
  const [copied, setCopied] = useState(false);

  async function share() {
    const url = typeof window !== "undefined" ? `${window.location.origin}/news/${article.slug}` : "";
    try {
      if (navigator.share) await navigator.share({ title: article.title, text: `${article.title} — Hymnora`, url });
      else {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      }
    } catch {
      /* dismissed */
    }
  }

  return (
    <article className="group flex gap-4 rounded-2xl border border-line bg-surface p-4 shadow-soft transition hover:shadow-lift">
      <Link href={`/news/${article.slug}`} className="relative hidden size-28 shrink-0 overflow-hidden rounded-xl sm:block">
        <Image src={imgSrc(article.image, "/images/golden-hour.jpg")} alt="" fill sizes="112px" className="object-cover warm-image" />
      </Link>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <button type="button" onClick={onTag} className="rounded-full bg-canvas px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-gold">{article.category}</button>
          <span className="text-[11px] text-ink-muted">{article.region ?? article.source} · {article.date}</span>
        </div>
        <Link href={`/news/${article.slug}`}>
          <h3 className="mt-1.5 font-display text-[17px] font-semibold leading-snug tracking-[-0.015em] text-ink group-hover:text-sage">{article.title}</h3>
          <p className="mt-1 line-clamp-2 text-[13px] leading-6 text-ink-muted">{article.excerpt}</p>
        </Link>
        <div className="mt-3 flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => toggleFavorite(article.id)}
            className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold transition ${saved ? "bg-terracotta-soft text-terracotta" : "bg-canvas text-ink-soft hover:text-ink"}`}
          >
            <Heart size={14} fill={saved ? "currentColor" : "none"} /> {saved ? "Saved" : "Save"}
          </button>
          <button type="button" onClick={share} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-canvas px-2.5 text-xs font-semibold text-ink-soft transition hover:text-ink">
            {copied ? <Check size={14} className="text-sage" /> : <Share2 size={14} />} {copied ? "Copied" : "Share"}
          </button>
          <Link href={`/news/${article.slug}`} className="ml-auto inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-xs font-semibold text-sage transition hover:text-ink">
            Read <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    </article>
  );
}

function MostSaved({ articles, onTag }: { articles: NewsArticle[]; onTag: (category: string) => void }) {
  const favorites = useFavorites();
  const saved = articles.filter((article) => favorites.includes(article.id)).slice(0, 4);
  const list = saved.length > 0 ? saved : articles.slice(0, 3);
  const label = saved.length > 0 ? "Your saved stories" : "Most read this week";

  return (
    <div className="rounded-2xl border border-line bg-surface p-5 shadow-soft">
      <p className="mb-3 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-gold"><Bookmark size={13} /> {label}</p>
      <div className="space-y-3">
        {list.map((article, index) => (
          <Link key={article.id} href={`/news/${article.slug}`} className="group flex gap-3">
            <span className="font-display text-lg font-semibold text-line">{String(index + 1).padStart(2, "0")}</span>
            <span className="min-w-0">
              <span className="block text-[13px] font-semibold leading-snug text-ink group-hover:text-sage">{article.title}</span>
              <button type="button" onClick={() => onTag(article.category)} className="mt-1 text-[11px] font-medium text-ink-muted hover:text-gold">{article.category} · {article.readTime}</button>
            </span>
          </Link>
        ))}
        {list.length === 0 ? <p className="text-sm text-ink-muted">Saved stories will collect here.</p> : null}
      </div>
    </div>
  );
}

function FollowTopics({ facets }: { facets: NewsFacets }) {
  const follows = useFollows();
  return (
    <div className="rounded-2xl border border-line bg-surface p-5 shadow-soft">
      <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.18em] text-gold">Follow a topic</p>
      <div className="flex flex-wrap gap-2">
        {facets.categories.map((topic) => {
          const id = `topic:${topic.category}`;
          const following = follows.some((entry) => entry.id === id);
          return (
            <button
              key={topic.category}
              type="button"
              onClick={() => toggleFollowSync({ id, label: topic.category, kind: "topic" })}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${following ? "border-sage bg-sage-soft text-sage" : "border-line bg-canvas text-ink-soft hover:border-gold/60"}`}
            >
              {following ? <Check size={12} /> : null}
              {topic.category}
            </button>
          );
        })}
      </div>
    </div>
  );
}
