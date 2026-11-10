"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft, Bookmark, Check, Church as ChurchIcon, Film, Link2, Play, Share2,
  Sparkles, Square, Volume2,
} from "lucide-react";
import { useHymnora } from "@/components/hymnora-provider";
import { recordArticleView } from "@/lib/data";
import type { NewsArticle, RelatedItem } from "@/lib/types";
import { imgSrc } from "@/lib/image";

/**
 * The reading view for one story.
 *
 * Kept deliberately close to a newspaper: eyebrow, headline, dateline, byline,
 * hero, body. The extras — "listen to this article", the save/share bar, and the
 * related rail — are what make it Hymnora rather than a wire copy. That rail is
 * the real relationship the server holds for this story: the reels an editor
 * linked, the church and event it is about, the other stories it sits beside,
 * each labelled when it was worked out from shared words instead of chosen.
 */

type Props = {
  article: NewsArticle;
  related: RelatedItem[];
  relatedReels: RelatedItem[];
  /** The church and event this story is about, when the links know of one. */
  places: RelatedItem[];
  relatedIsInferred: boolean;
  reelsAreInferred: boolean;
};

function formatArticleDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-GB", { day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
}

function paragraphsOf(article: NewsArticle): string[] {
  const raw = (article.body ?? "").trim();
  if (!raw) return [];
  const parts = raw.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  // Seed rows repeat the excerpt as the body; do not print it twice.
  return parts.filter((part, index) => index === 0 || part !== parts[index - 1]);
}

export function ArticleExperience({ article, related, relatedReels, places, relatedIsInferred, reelsAreInferred }: Props) {
  const { isFavorite, toggleFavorite } = useHymnora();
  const saved = isFavorite(article.id);
  const [speaking, setSpeaking] = useState(false);
  const [copied, setCopied] = useState(false);

  const paragraphs = useMemo(() => paragraphsOf(article), [article]);

  useEffect(() => {
    void recordArticleView(article.slug);
  }, [article.slug]);

  useEffect(() => {
    return () => {
      if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, []);

  function toggleSpeech() {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    const utterance = new SpeechSynthesisUtterance([article.title, ...paragraphs, article.excerpt].join(". "));
    utterance.rate = 0.98;
    utterance.onend = () => setSpeaking(false);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
    setSpeaking(true);
  }

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
    <article className="fade-up mx-auto max-w-[760px]">
      <div className="mb-6 flex items-center gap-2">
        <Link href="/news" className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-line bg-surface px-3.5 text-sm font-semibold text-ink-soft transition hover:text-ink">
          <ArrowLeft size={16} /> Newsroom
        </Link>
        <button
          type="button"
          onClick={() => toggleFavorite(article.id)}
          className={`ml-auto inline-flex h-10 items-center gap-1.5 rounded-xl px-3.5 text-sm font-semibold transition ${saved ? "bg-terracotta-soft text-terracotta" : "border border-line bg-surface text-ink-soft hover:text-ink"}`}
        >
          <Bookmark size={16} fill={saved ? "currentColor" : "none"} /> {saved ? "Saved" : "Save"}
        </button>
        <button type="button" onClick={share} className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-line bg-surface px-3.5 text-sm font-semibold text-ink-soft transition hover:text-ink">
          {copied ? <Check size={16} className="text-sage" /> : <Share2 size={16} />} {copied ? "Copied" : "Share"}
        </button>
      </div>

      <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-gold">{article.category}{article.region ? ` · ${article.region}` : ""}</p>
      <h1 className="mt-3 font-display text-[34px] font-semibold leading-[1.08] tracking-[-0.035em] text-ink sm:text-[44px]">{article.title}</h1>

      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink-muted">
        <span className="font-semibold text-ink-soft">{article.author ?? article.source}</span>
        <span aria-hidden>·</span>
        <span>{formatArticleDate(article.publishedAt)}</span>
        <span aria-hidden>·</span>
        <span className="flex items-center gap-1"><Check size={13} className="text-gold" /> {article.readTime}</span>
      </div>

      <div className="relative mt-6 aspect-[16/9] overflow-hidden rounded-3xl border border-line">
        <Image src={imgSrc(article.image, "/images/golden-hour.jpg")} alt="" fill sizes="760px" className="object-cover warm-image" priority />
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={toggleSpeech}
          className="inline-flex h-11 items-center gap-2 rounded-xl bg-ink-fill px-4 text-sm font-bold text-white transition hover:bg-ink-fill/80"
        >
          {speaking ? <Square size={15} fill="currentColor" /> : <Volume2 size={16} />}
          {speaking ? "Stop listening" : "Listen to this article"}
        </button>
        <span className="text-xs text-ink-muted">Read aloud by your device</span>
      </div>

      <div className="mt-8 space-y-5">
        {paragraphs.length > 0 ? (
          paragraphs.map((paragraph, index) => (
            <p key={index} className="text-[17px] leading-8 text-ink-soft first:text-[19px] first:leading-9 first:text-ink">{paragraph}</p>
          ))
        ) : (
          <>
            <p className="text-[19px] leading-9 text-ink">{article.excerpt}</p>
            <p className="rounded-2xl border border-dashed border-line bg-surface p-4 text-sm text-ink-muted">The full text of this story is being prepared by the news desk.</p>
          </>
        )}
      </div>

      {article.tags.length > 0 ? (
        <div className="mt-8 flex flex-wrap gap-2">
          {article.tags.map((tag) => (
            <span key={tag} className="rounded-full bg-canvas px-3 py-1.5 text-xs font-semibold text-ink-muted">#{tag}</span>
          ))}
        </div>
      ) : null}

      {relatedReels.length > 0 ? (
        <section className="mt-12">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 font-display text-[22px] font-semibold tracking-[-0.02em] text-ink">
              <Film size={19} className="text-gold" />
              {reelsAreInferred ? "Reels to watch now" : "Reels on this story"}
            </h2>
            <Link href="/reels" className="text-sm font-semibold text-sage hover:text-ink">Open reels</Link>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {relatedReels.slice(0, 4).map((reel) => (
              <Link key={`${reel.type}-${reel.id}`} href={reel.href} className="group relative aspect-[3/4] overflow-hidden rounded-2xl border border-line">
                {reel.imageUrl ? (
                  <Image src={imgSrc(reel.imageUrl, "/images/church.jpg")} alt="" fill sizes="(max-width: 640px) 50vw, 180px" className="object-cover warm-image transition duration-500 group-hover:scale-105" />
                ) : (
                  <span className="absolute inset-0 bg-canvas" />
                )}
                <span className="absolute inset-0 bg-gradient-to-t from-ink/85 to-transparent" />
                <span className="absolute inset-x-0 bottom-0 p-3 text-white">
                  <span className="block text-[11px] font-semibold text-gold-light">{reel.subtitle}</span>
                  <span className="mt-0.5 line-clamp-2 block text-xs font-medium leading-snug">{reel.title}</span>
                </span>
                <span className="absolute right-2 top-2 grid size-8 place-items-center rounded-full bg-ink-fill/55 text-white backdrop-blur-sm"><Play size={14} fill="currentColor" /></span>
              </Link>
            ))}
          </div>
          <p className="mt-2.5 text-[11.5px] text-ink-muted">
            {reelsAreInferred
              ? "This story has no reels linked to it yet, so these are the newest from the feed."
              : "Linked to this story by the newsroom."}
          </p>
        </section>
      ) : null}

      {places.length > 0 ? (
        <section className="mt-12">
          <h2 className="mb-4 font-display text-[22px] font-semibold tracking-[-0.02em] text-ink">Where this is happening</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {places.slice(0, 2).map((place) => (
              <Link key={`${place.type}-${place.id}`} href={place.href} className="group flex items-center gap-3 rounded-2xl border border-line bg-surface p-4 shadow-soft transition hover:shadow-lift">
                {place.imageUrl ? (
                  <Image src={imgSrc(place.imageUrl, "/images/church.jpg")} alt="" width={56} height={56} className="size-14 shrink-0 rounded-xl object-cover warm-image" />
                ) : (
                  <span className="grid size-14 shrink-0 place-items-center rounded-xl bg-sage-soft text-sage">
                    <ChurchIcon size={20} />
                  </span>
                )}
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-gold">
                    <Link2 size={11} aria-hidden /> {place.type === "church" ? "Church" : "Event"}
                  </span>
                  <span className="mt-1 block text-sm font-semibold leading-snug text-ink group-hover:text-sage">{place.title}</span>
                  {place.meta ? <span className="mt-0.5 block text-xs text-ink-muted">{place.meta}</span> : null}
                </span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {related.length > 0 ? (
        <section className="mt-12">
          <h2 className="mb-4 font-display text-[22px] font-semibold tracking-[-0.02em] text-ink">Related stories</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            {related.slice(0, 3).map((story) => (
              <Link key={story.id} href={story.href} className="group rounded-2xl border border-line bg-surface p-4 shadow-soft transition hover:shadow-lift">
                {story.subtitle ? <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-gold">{story.subtitle}</p> : null}
                <h3 className="mt-1.5 text-sm font-semibold leading-snug text-ink group-hover:text-sage">{story.title}</h3>
                {story.meta ? <p className="mt-2 text-xs text-ink-muted">{story.meta}</p> : null}
              </Link>
            ))}
          </div>
          {relatedIsInferred ? (
            <p className="mt-2.5 text-[11.5px] text-ink-muted">No editor links yet, so these are the other stories on this desk.</p>
          ) : null}
        </section>
      ) : null}

      <section className="mt-12 rounded-3xl border border-line bg-surface p-6 shadow-soft">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-sage-soft text-sage"><ChurchIcon size={20} /></span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink">{article.region ? `Following this from ${article.region}?` : "Find this ministry near you"}</p>
            <p className="text-[13px] text-ink-muted">Every story here belongs to a real congregation or ministry. Follow one and their updates come first.</p>
          </div>
          <Link href="/churches" className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-ink-fill px-4 text-sm font-bold text-white transition hover:bg-ink-fill/80">
            <Sparkles size={15} /> Churches
          </Link>
        </div>
      </section>
    </article>
  );
}
