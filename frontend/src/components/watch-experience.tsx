"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, Check, Link2, MoreHorizontal, Share2 } from "lucide-react";
import { useHymnora } from "@/components/hymnora-provider";
import { VideoPlayer } from "@/components/video-player";
import { formatCount, formatViews, formatWhen } from "@/lib/format";
import { imgSrc } from "@/lib/image";
import type { VideoDetail } from "@/lib/types";

const FALLBACK_ART = "/images/worship-singer.jpg";

/**
 * The watch page.
 *
 * The player is the real YouTube iframe rather than a poster, so the whole point
 * of the grid — this is where you actually watch — is delivered. Favouriting
 * reuses the audio store: it is the same human deciding they like this thing,
 * and a second store would mean they could disagree with each other.
 */
export function WatchExperience({ detail }: { detail: VideoDetail }) {
  const { video, description, channel, more } = detail;
  const { isFavorite, toggleFavorite } = useHymnora();
  const [copied, setCopied] = useState(false);

  // Keyed by the row id, not the YouTube id: it is the same key the video
  // endpoints take, so the library can resolve this favourite back to something
  // it can list.
  const favourite = isFavorite(video.id);
  const share = async () => {
    const url = `${window.location.origin}/videos/${video.videoId}`;
    // The native share sheet is the better path on a phone, and the only one that
    // reaches the apps people actually use; the clipboard is the fallback.
    if (navigator.share) {
      try {
        await navigator.share({ title: video.title, url });
        return;
      } catch {
        // Dismissed the sheet — fall through to the clipboard rather than
        // showing an error for something the user chose to cancel.
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="fade-up mx-auto max-w-[1280px]">
      <Link
        href="/videos"
        className="mb-5 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-muted transition hover:text-ink"
      >
        <ArrowLeft size={15} /> All videos
      </Link>

      <div className="grid gap-7 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">
          <VideoPlayer
            videoId={video.videoId}
            title={video.title}
            thumbnail={imgSrc(video.thumbnail, FALLBACK_ART)}
            isLive={video.isLive}
          />

          <h1 className="mt-5 font-display text-[24px] font-semibold leading-tight tracking-[-0.02em] sm:text-[30px]">
            {video.title}
          </h1>
          <p className="mt-2 text-sm text-ink-muted">
            {formatViews(video.views)} · {formatWhen(video.publishedAt)} · {video.duration}
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <ActionButton onClick={() => toggleFavorite(video.id)} active={favourite} activeLabel="Saved" label="Favourite">
              <svg viewBox="0 0 24 24" width="16" height="16" fill={favourite ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M12 20.5 3.8 12.3a5 5 0 1 1 7.1-7l1.1 1.1 1.1-1.1a5 5 0 1 1 7.1 7Z" />
              </svg>
            </ActionButton>
            {video.likes > 0 ? (
              <span className="inline-flex h-9 items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 text-sm font-semibold text-ink">
                {formatCount(video.likes)} {video.likes === 1 ? "like" : "likes"}
              </span>
            ) : null}
            <ActionButton onClick={() => void share()} active={copied} activeLabel="Link copied" label="Share">
              {copied ? <Check size={16} /> : <Share2 size={16} />}
            </ActionButton>
            <a
              href={video.watchUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 text-sm font-semibold text-ink transition hover:border-gold/60"
            >
              <Link2 size={16} /> YouTube
            </a>
            <ActionButton onClick={() => navigator.clipboard?.writeText(video.watchUrl)} label="More">
              <MoreHorizontal size={16} />
            </ActionButton>
          </div>

          {channel.title ? (
            <section className="mt-6 flex items-center gap-4 rounded-[22px] border border-line bg-surface p-4 sm:p-5">
              <div className="grid size-12 shrink-0 place-items-center rounded-full bg-ink-fill font-display text-lg font-semibold text-gold-light">
                {channel.title.slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">{channel.title}</p>
                <p className="mt-0.5 truncate text-xs text-ink-muted">
                  {[channel.handle, channel.country].filter(Boolean).join(" · ")}
                </p>
              </div>
            </section>
          ) : null}

          {description ? (
            <section className="mt-4 rounded-[22px] bg-surface-soft p-4 sm:p-5">
              <p className="whitespace-pre-line text-sm leading-6 text-ink-soft">{description}</p>
            </section>
          ) : null}
        </div>

        <aside className="min-w-0">
          <h2 className="mb-3 font-display text-[19px] font-semibold tracking-[-0.02em]">More from this choir</h2>
          {more.length === 0 ? (
            <p className="rounded-[22px] border border-dashed border-line bg-surface p-6 text-center text-sm text-ink-muted">
              Nothing else from this channel yet.
            </p>
          ) : (
            <div className="space-y-3">
              {more.map((item) => (
                <Link
                  key={item.id}
                  href={`/videos/${item.videoId}`}
                  className="group flex gap-3 rounded-2xl p-2 transition hover:bg-surface"
                >
                  <div className="relative aspect-video w-[132px] shrink-0 overflow-hidden rounded-xl bg-surface-soft">
                    <Image
                      src={imgSrc(item.thumbnail, FALLBACK_ART)}
                      alt=""
                      fill
                      sizes="132px"
                      className="object-cover transition duration-500 group-hover:scale-105"
                    />
                    <span className="absolute bottom-1 right-1 rounded bg-ink-fill/85 px-1 py-0.5 text-[10px] font-semibold tabular-nums text-white">
                      {item.duration}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-sm font-semibold leading-snug text-ink transition group-hover:text-terracotta">
                      {item.title}
                    </p>
                    <p className="mt-1 text-xs text-ink-muted">
                      {formatViews(item.views)} · {formatWhen(item.publishedAt)}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function ActionButton({
  onClick,
  active,
  activeLabel,
  label,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  activeLabel?: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold transition ${
        active
          ? "border-terracotta bg-terracotta-soft text-terracotta"
          : "border-line bg-surface text-ink hover:border-gold/60"
      }`}
    >
      {children}
      {active && activeLabel ? activeLabel : label}
    </button>
  );
}
