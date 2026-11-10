"use client";

import Image from "next/image";
import Link from "next/link";
import { BookOpen, ChevronRight, Search, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { SectionHeading } from "@/components/section-heading";
import { RotatingQuote } from "@/components/hymn-quote";
import { getHymnEditions, getHymnThemes, getHymnsPage, type HymnQuery } from "@/lib/api";
import type { Hymn, HymnEdition, HymnTheme } from "@/lib/types";
import { imgSrc } from "../lib/image";

const ALL = "all";

/** The all-languages view opens with a short preview; one language gets a full page. */
const ALL_LANGUAGES_PAGE_SIZE = 10;
const LANGUAGE_PAGE_SIZE = 100;

/** Matches shown in the card while the search box has something in it. */
const SEARCH_RESULT_LIMIT = 5;

/**
 * The languages people are most likely to open first, in the order they should
 * appear. Everything else follows, biggest first.
 */
const PRIORITY_LANGUAGES = ["English", "Swahili", "Dholuo", "Abagusii", "Kikuyu"];

/** Friendlier names than the ones stored on the hymn rows. */
const DISPLAY_NAMES: Record<string, string> = {
  Swahili: "Kiswahili",
  "Ndebele/IsiZulu": "Ndebele / IsiZulu",
  "русский язык": "Russian",
};

const displayName = (language: string) => DISPLAY_NAMES[language] ?? language;

export function HymnExperience({
  initialEditions = [],
  initialThemes = [],
}: {
  initialEditions?: HymnEdition[];
  initialThemes?: HymnTheme[];
}) {
  const [editions, setEditions] = useState<HymnEdition[]>(initialEditions);
  const [language, setLanguage] = useState<string>(ALL);
  const [theme, setTheme] = useState<string | null>(null);
  const [themes, setThemes] = useState<HymnTheme[]>(initialThemes);
  // Most recently chosen languages, newest first. Choosing a language lifts it
  // to the top slot and pushes the others down; the fourth drops off.
  const [languageSearch, setLanguageSearch] = useState("");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [listState, setListState] = useState<{ key: string; items: Hymn[]; offset: number } | null>(null);

  // The server normally supplies the editions; this is the fallback for when it
  // could not reach the API during render.
  useEffect(() => {
    if (initialEditions.length === 0) getHymnEditions().then(setEditions).catch(() => setEditions([]));
  }, [initialEditions]);

  // Theme cards follow the selected language: choosing Kiswahili shows only the
  // Kiswahili hymns on each card, so the counts and the filter agree.
  useEffect(() => {
    let cancelled = false;
    getHymnThemes(language)
      .then((next) => {
        if (!cancelled) setThemes(next);
      })
      .catch(() => {
        if (!cancelled) setThemes([]);
      });
    return () => {
      cancelled = true;
    };
  }, [language]);

  // Debounce so each keystroke does not hit the API.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  // A theme is a narrower grouping than a language, so it gets the full page.
  const pageSize = language === ALL && !theme ? ALL_LANGUAGES_PAGE_SIZE : LANGUAGE_PAGE_SIZE;

  const buildQuery = useCallback(
    (nextOffset: number): HymnQuery => {
      const params: HymnQuery = { sort: "number", order: "asc", limit: pageSize, offset: nextOffset };
      if (language !== ALL) params.language = language;
      if (theme) params.theme = theme;
      if (search) params.q = search;
      return params;
    },
    [language, theme, search, pageSize],
  );

  // Loading is derived from whether the stored page matches the current query,
  // so no effect has to synchronously reset a flag before fetching.
  const requestKey = useMemo(() => JSON.stringify(buildQuery(0)), [buildQuery]);
  const listReady = listState?.key === requestKey;
  const hymns = listReady ? listState.items : [];
  const listLoading = !listReady;
  const offset = listReady ? listState.offset : 0;

  useEffect(() => {
    let cancelled = false;
    getHymnsPage(buildQuery(0))
      .then((items) => {
        if (!cancelled) setListState({ key: requestKey, items, offset: 0 });
      })
      .catch(() => {
        if (!cancelled) setListState({ key: requestKey, items: [], offset: 0 });
      });
    return () => {
      cancelled = true;
    };
  }, [requestKey, buildQuery]);

  /**
   * Appends the next page.
   *
   * The offset only advances when the page actually arrives, so a failed
   * fetch leaves the list where it was rather than skipping a page. A second
   * click while the first is still in flight is ignored — without that guard
   * both clicks read the same `offset` and the same page lands twice. And the
   * response is dropped if the query changed while it was travelling: the
   * list's key is re-checked on arrival, so a slow page of Kiswahili hymns
   * cannot land on top of the English list that replaced it.
   */
  const [loadingMore, setLoadingMore] = useState(false);

  const loadMore = useCallback(() => {
    if (loadingMore) return;
    const keyAtCall = requestKey;
    const next = offset + pageSize;
    setLoadingMore(true);
    getHymnsPage(buildQuery(next))
      .then((more) =>
        setListState((current) =>
          current && current.key === keyAtCall ? { ...current, items: [...current.items, ...more], offset: next } : current,
        ),
      )
      .catch(() => undefined)
      .finally(() => setLoadingMore(false));
  }, [loadingMore, offset, pageSize, buildQuery, requestKey]);

  /** Choosing a language promotes it to the first slot and demotes the rest. */
  const chooseLanguage = useCallback((name: string) => {
    setLanguage(name);
    setTheme(null);
  }, []);

  const showAllLanguages = useCallback(() => {
    setLanguage(ALL);
  }, []);

  /**
   * The language is deliberately left alone: the cards are already scoped to the
   * selected language, so choosing Kiswahili and then a theme should show the
   * Kiswahili hymns in that theme, not every language's.
   */
  const chooseTheme = useCallback((slug: string) => {
    setTheme(slug);
    document.getElementById("hymn-results")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const clearTheme = useCallback(() => {
    setTheme(null);
  }, []);

  /** Language totals, summed from the editions themselves. */
  const languages = useMemo(() => {
    const totals = new Map<string, number>();
    for (const edition of editions) {
      totals.set(edition.language, (totals.get(edition.language) ?? 0) + edition.hymnCount);
    }
    return [...totals.entries()].sort(([a, aCount], [b, bCount]) => {
      const rankA = PRIORITY_LANGUAGES.indexOf(a);
      const rankB = PRIORITY_LANGUAGES.indexOf(b);
      if (rankA !== rankB) {
        if (rankA === -1) return 1;
        if (rankB === -1) return -1;
        return rankA - rankB;
      }
      return bCount - aCount;
    });
  }, [editions]);

  const visibleLanguages = useMemo(() => {
    const needle = languageSearch.trim().toLowerCase();
    if (!needle) return languages;
    return languages.filter(([name]) => displayName(name).toLowerCase().includes(needle));
  }, [languages, languageSearch]);

  /**
   * The card lists every language in the catalogue and scrolls inward to reach
   * them, so the "Browse by language" section below it is redundant. Typing in
   * the search box narrows the list to matches.
   */
  const cardLanguages = useMemo(() => {
    if (languageSearch.trim()) return visibleLanguages.slice(0, SEARCH_RESULT_LIMIT);
    return languages;
  }, [languageSearch, visibleLanguages, languages]);

  const catalogueTotal = useMemo(
    () => editions.reduce((sum, edition) => sum + edition.hymnCount, 0),
    [editions],
  );

  /** Count for the current selection; null while a search makes it unknowable. */
  const selectionTotal = useMemo(() => {
    if (search) return null;
    if (theme) return themes.find((entry) => entry.slug === theme)?.count ?? 0;
    if (language !== ALL) return languages.find(([name]) => name === language)?.[1] ?? 0;
    return catalogueTotal;
  }, [search, theme, themes, language, languages, catalogueTotal]);

  const activeLanguage = language === ALL ? null : displayName(language);
  const activeTheme = themes.find((entry) => entry.slug === theme)?.theme ?? null;
  const listHeading = [activeTheme, activeLanguage].filter(Boolean).join(" · ") || "All languages";

  return (
    <div className="fade-up mx-auto max-w-[1440px]">
      <section className="mb-9 grid gap-5 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <RotatingQuote />

        <div className="rounded-[26px] border border-line bg-surface p-6 shadow-soft sm:p-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-gold">Start here</p>
              <h2 className="mt-1.5 font-display text-[26px] font-semibold">Choose a language</h2>
              <p className="mt-1 text-sm text-ink-muted">
                {languages.length} languages · {catalogueTotal} hymns
              </p>
            </div>
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-gold-soft text-gold">
              <BookOpen size={18} />
            </span>
          </div>

          <label className="relative mt-5 block">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-muted" size={16} />
            <input
              value={languageSearch}
              onChange={(event) => setLanguageSearch(event.target.value)}
              placeholder="Search for a language"
              aria-label="Search for a language"
              className="h-11 w-full rounded-xl border border-line bg-canvas/50 pl-10 pr-3 text-sm outline-none focus:border-gold/60 focus:ring-4 focus:ring-gold/10"
            />
          </label>

          <div className="mt-4 max-h-[196px] space-y-2 overflow-y-auto pr-1">
            {cardLanguages.length > 0 ? (
              cardLanguages.map(([name, count]) => (
                <LanguageRow
                  key={name}
                  name={displayName(name)}
                  subtitle={`${count} ${count === 1 ? "hymn" : "hymns"}`}
                  active={language === name}
                  onSelect={() => chooseLanguage(name)}
                />
              ))
            ) : (
              <p className="rounded-2xl bg-surface-soft p-5 text-center text-sm text-ink-muted">
                No language matches “{languageSearch}”.
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2 pt-1">
              {language !== ALL && (
                <button
                  type="button"
                  onClick={showAllLanguages}
                  className="rounded-full border border-line bg-canvas/50 px-3 py-1.5 text-[11px] font-semibold text-ink-muted transition hover:border-gold/60 hover:text-gold"
                >
                  Show all languages
                </button>
              )}
            </div>
          </div>
        </div>
      </section>

      <div id="hymn-results" className="mb-8 scroll-mt-8 grid gap-3 sm:grid-cols-3 sm:items-center">
        <p className="text-sm text-ink-muted sm:text-left">
          <span className="font-semibold text-ink">
            {activeTheme ? <ThemeLabel name={activeTheme} /> : listHeading}
          </span>
          {selectionTotal === null
            ? ` · ${hymns.length} found`
            : ` · ${hymns.length} of ${selectionTotal} ${selectionTotal === 1 ? "hymn" : "hymns"}`}
        </p>
        <label className="relative block sm:mx-auto sm:w-full sm:max-w-sm">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-muted" size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a hymn by title or number"
            aria-label="Find a hymn by title or number"
            className="h-10 w-full rounded-xl border border-line bg-surface pl-10 pr-3 text-sm outline-none focus:border-gold/60 focus:ring-4 focus:ring-gold/10"
          />
        </label>
      </div>

      {hymns.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {hymns.map((hymn) => (
            <Link
              key={hymn.id}
              href={`/hymns/${hymn.id}`}
              className="group flex items-center gap-3 rounded-2xl border border-line bg-surface p-3 transition hover:border-gold/60 hover:shadow-soft"
            >
              <div className="relative size-14 shrink-0 overflow-hidden rounded-xl">
                <Image
                  src={imgSrc(hymn.image, "/images/bible-study.jpg")}
                  alt=""
                  fill
                  sizes="56px"
                  className="object-cover warm-image"
                />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[10px] font-bold uppercase tracking-[0.12em] text-gold">
                  Hymn {hymn.number}
                  {/* Hymn numbers only mean something inside one hymnal, so the
                      code is shown: without it "Hymn 5" from SDAH and "Hymn 5"
                      from HCASDA look like a duplicate. */}
                  {hymn.editionCode ? <span className="ml-1.5 font-semibold text-ink-muted">{hymn.editionCode}</span> : null}
                </p>
                <p className="mt-0.5 line-clamp-2 text-sm font-semibold text-ink">{hymn.title}</p>
                <p className="mt-0.5 truncate text-xs text-ink-muted">{hymn.language}</p>
              </div>
              <ChevronRight
                size={16}
                className="shrink-0 text-ink-muted transition group-hover:text-gold"
              />
            </Link>
          ))}
        </div>
      ) : (
        <p className="rounded-2xl bg-surface p-10 text-center text-sm text-ink-muted">
          {listLoading ? "Loading hymns…" : "No hymns match this yet."}
        </p>
      )}

      {hymns.length > 0 &&
        hymns.length % pageSize === 0 &&
        hymns.length < (selectionTotal ?? Number.MAX_SAFE_INTEGER) && (
          <div className="mt-6 flex justify-center">
            <button
              type="button"
              onClick={loadMore}
              className="rounded-2xl border border-line bg-surface px-6 py-3 text-sm font-semibold text-ink-muted transition hover:border-gold/60 hover:text-gold"
            >
              Load more hymns
            </button>
          </div>
        )}


      {themes.length > 0 && (
        <section id="browse-themes" className="mt-12 scroll-mt-8">
          <SectionHeading
            eyebrow="Sing what you mean"
            title="Browse by theme"
            description="Pick a theme and every hymn in it comes to the top of the list."
          />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {themes.map((entry) => {
              const slug = entry.slug ?? entry.theme;
              const active = theme === slug;
              return (
                <button
                  key={slug}
                  type="button"
                  onClick={() => (active ? clearTheme() : chooseTheme(slug))}
                  aria-pressed={active}
                  className={`min-w-0 rounded-2xl border p-4 text-left transition hover:border-gold/60 hover:shadow-soft ${active ? "border-sage bg-sage-soft" : "border-line bg-surface"}`}
                >
                  <span className="grid size-8 place-items-center rounded-xl bg-sage-soft text-sage">
                    <Sparkles size={17} />
                  </span>
                  <h3 className="mt-3 break-words font-semibold">
                    <ThemeLabel name={entry.theme} />
                  </h3>
                  <p className="mt-1 text-xs text-ink-muted">
                    {entry.count} {entry.count === 1 ? "hymn" : "hymns"}
                  </p>
                </button>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

/**
 * Theme names in the local language read "Sifa na Kuabudu (Praise)". The local
 * name leads in the card's own weight and the bracketed English gloss is dimmed,
 * so the two never look like one run of equal text on a long translated name.
 */
function ThemeLabel({ name }: { name: string }) {
  const match = name.match(/^(.*?)\s*\(([^()]*)\)\s*$/);
  if (!match) return <>{name}</>;
  return (
    <>
      <span className="[overflow-wrap:anywhere]">{match[1]}</span>{" "}
      <span className="inline-block text-[11px] font-medium text-ink-muted [overflow-wrap:anywhere]">
        ({match[2]})
      </span>
    </>
  );
}

function LanguageRow({
  name,
  subtitle,
  active,
  onSelect,
}: {
  name: string;
  subtitle: string;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={`flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left transition ${active ? "border-sage bg-sage-soft" : "border-line bg-canvas/50 hover:border-gold/50"}`}
    >
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold">{name}</span>
        <span className="mt-0.5 block truncate text-xs text-ink-muted">{subtitle}</span>
      </span>
      <ChevronRight size={17} className={`shrink-0 ${active ? "text-sage" : "text-ink-muted"}`} />
    </button>
  );
}
