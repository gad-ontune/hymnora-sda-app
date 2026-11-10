"use client";

import Link from "next/link";
import { ArrowRight, BookOpen } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getBibleOverview, getBibleSpotlight, type BibleOverview, type SpotlightVerse } from "@/lib/api";

/** Matches the cadence the hymns page uses for its own top card. */
const ROTATE_MS = 9_000;

/**
 * The dark card at the top of the home page.
 *
 * It is a sibling of the hymns page's `RotatingQuote`: same rotation, same
 * role as the first thing you see. What it says is drawn from the Bibles that
 * are actually stored in this application's database rather than a hard-coded
 * list, so the counts cannot drift away from what the reader can open — and the
 * verses are the real text of the translations onboard, in the languages they
 * were seeded in.
 *
 * With no complete Bible seeded yet it still renders, and says so honestly
 * instead of showing a placeholder verse that reads like scripture.
 */
export function BibleSpotlight() {
  const [verses, setVerses] = useState<SpotlightVerse[]>([]);
  const [overview, setOverview] = useState<BibleOverview | null>(null);
  const [index, setIndex] = useState(0);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([getBibleSpotlight(6).catch(() => []), getBibleOverview().catch(() => null)])
      .then(([spotlight, stats]) => {
        if (!active) return;
        setVerses(Array.isArray(spotlight) ? spotlight : []);
        setOverview(stats);
      })
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const count = verses.length;
  useEffect(() => {
    if (count < 2) return;
    const timer = setTimeout(() => setIndex((current) => (current + 1) % count), ROTATE_MS);
    return () => clearTimeout(timer);
  }, [index, count]);

  const verse = useMemo(() => (count ? verses[index % count]! : null), [verses, index, count]);

  const eyebrow = overview && overview.versionCount > 0
    ? `${overview.versionCount} Bibles · ${overview.languageCount} languages`
    : "The Bible";

  return (
    <div className="relative min-h-[212px] overflow-hidden rounded-[26px] bg-ink-fill p-6 text-white shadow-soft sm:p-7">
      <div className="absolute -bottom-24 -right-16 size-72 rounded-full border border-gold/20" />
      <div className="absolute -bottom-12 -right-4 size-48 rounded-full border border-gold/20" />
      <div className="relative flex h-full flex-col">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-gold-light transition-opacity duration-500">
            {eyebrow}
          </p>
          <BookOpen size={19} className="shrink-0 text-white/45" />
        </div>

        {verse ? (
          <div key={verse.id} className="mt-7 flex-1 animate-[fade-up_600ms_ease-out]">
            <blockquote className="max-w-sm font-display text-[22px] font-semibold leading-[1.25] tracking-[-0.02em] sm:text-[25px]">
              “{verse.text}”
            </blockquote>
            <p className="mt-3 text-[12px] leading-5 text-white/60">
              <span className="font-semibold text-white/80">{verse.reference}</span>
              <span className="mx-1.5 text-white/30">·</span>
              {verse.versionName}
              <span className="mx-1.5 text-white/30">·</span>
              {verse.language}
            </p>
          </div>
        ) : (
          <div className="mt-7 flex-1">
            <h2 className="max-w-sm font-display text-[27px] font-semibold leading-[1.15] tracking-[-0.03em] sm:text-[30px]">
              A whole Bible, in the language you think in.
            </h2>
            <p className="mt-2.5 max-w-sm text-[13px] leading-6 text-white/60">
              {ready
                ? "Run the Bible seeder to bring complete translations into this application, then they read offline."
                : "Bringing the library together…"}
            </p>
          </div>
        )}

        <div className="mt-6 flex items-end justify-between gap-4 border-t border-white/10 pt-4">
          {overview && overview.versionCount > 0 ? (
            <dl className="flex flex-wrap gap-x-5 gap-y-1">
              <Figure value={overview.bookCount.toLocaleString("en-KE")} label="Books" />
              <Figure value={overview.chaptersPerVersion.toLocaleString("en-KE")} label="Chapters" />
              <Figure value={overview.verseCount.toLocaleString("en-KE")} label="Verses" />
            </dl>
          ) : (
            <p className="text-[11px] text-white/45">66 books in every translation · read offline</p>
          )}
          <Link
            href="/bible"
            className="inline-flex shrink-0 items-center gap-1.5 text-[13px] font-semibold text-gold-light transition hover:text-white"
          >
            Open the reader <ArrowRight size={15} />
          </Link>
        </div>
      </div>
    </div>
  );
}

function Figure({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <dd className="font-display text-[17px] font-semibold leading-none text-gold-light">{value}</dd>
      <dt className="mt-1 text-[9px] font-bold uppercase tracking-[0.13em] text-white/45">{label}</dt>
    </div>
  );
}
