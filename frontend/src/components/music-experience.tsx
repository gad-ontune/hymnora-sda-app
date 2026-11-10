"use client";

import Image from "next/image";
import Link from "next/link";
import { ChevronRight, Heart, Moon, Pause, Play, Sun, Sunrise } from "lucide-react";
import { useHymnora } from "@/components/hymnora-provider";
import { useFavorites } from "@/lib/favorites";
import { useHistory } from "@/lib/history";
import { formatClock, formatTotal, formatWhen } from "@/lib/format";
import { imgSrc } from "@/lib/image";
import type { MusicHome, MusicTrack } from "@/lib/types";

const FALLBACK_ART = "/images/music-studio.jpg";

/**
 * Worship Journey.
 *
 * The one idea here that a general music service does not have: organising music
 * by the *occasion* somebody is listening in, rather than by genre, mood or era.
 * "Quiet Reflection" and "Bible Study" are not categories any classifier can
 * detect from a title, and nobody goes looking for them; they are what you want
 * at 5am or at 11pm, and you want them to already be there.
 *
 * Each tile is a real entry point into a filtered slice of the catalogue, so
 * none of them is a dead end. The mapping underneath is honest about what the
 * classifier actually decided — "Quiet Reflection" points at the instrumentals,
 * because that is what devotional-without-words looks like in the data we hold.
 */
const JOURNEY: { id: string; label: string; caption: string; href: string; icon: "sunrise" | "praise" | "reflection" | "study" | "evening" | "sabbath" | "encourage" }[] = [
  { id: "morning", label: "Morning Worship", caption: "Hymns to start the day", href: "/music/browse?category=hymns", icon: "sunrise" },
  { id: "praise", label: "Praise", caption: "Choirs at full volume", href: "/music/browse?category=choirs", icon: "praise" },
  { id: "reflection", label: "Quiet Reflection", caption: "No vocals, no hurry", href: "/music/browse?category=instrumentals", icon: "reflection" },
  { id: "study", label: "Bible Study", caption: "Songs that teach the text", href: "/music/browse?category=hymns", icon: "study" },
  { id: "evening", label: "Evening Worship", caption: "Congregational praise", href: "/music/browse?category=worship", icon: "evening" },
  { id: "sabbath", label: "Sabbath", caption: "For the day of rest", href: "/music/browse?category=choirs", icon: "sabbath" },
  { id: "encourage", label: "Encouragement", caption: "When you need lifting", href: "/music/browse?category=worship", icon: "encourage" },
];

const JOURNEY_ICON = {
  sunrise: Sunrise,
  praise: Sun,
  reflection: Moon,
  study: Sun,
  evening: Moon,
  sabbath: Sun,
  encourage: Heart,
} as const;

/**
 * The music page.
 *
 * A greeting, then a shelf of what you were part-way through, then the Worship
 * Journey, then the catalogue. The shelves are real: "Continue listening" comes
 * from a local history the player writes, "Your favourites" from the same store
 * the hearts write. Nothing here is a placeholder row, and a shelf with nothing
 * in it is hidden rather than shown empty — an empty shelf is an apology, and a
 * missing one is not.
 */
export function MusicExperience({ home, greeting }: { home: MusicHome; greeting: string }) {
  const { mixes, rows, hero, totalTracks, totalDurationSeconds } = home;
  const history = useHistory();
  const favorites = useFavorites();
  const { playTracks, currentTrack, isPlaying } = useHymnora();

  const byId = new Map<string, MusicTrack>();
  for (const row of rows) for (const track of row.tracks) byId.set(track.id, track);

  // History holds ids and titles, not whole tracks, so a resume is only offered
  // for something still in the rows on this page. Anything else is still in the
  // list below, and the Library has it.
  const resumable = history
    .filter((entry) => byId.has(entry.id) && entry.position > 15)
    .slice(0, 6)
    .map((entry) => ({ entry, track: byId.get(entry.id)! }));

  // Everything that is not "continue listening" — finished, or barely started —
  // is "recently played". The two shelves are the same store, split by position.
  const resumableIds = new Set(resumable.map((item) => item.entry.id));
  const recentlyPlayed = history
    .filter((entry) => byId.has(entry.id) && !resumableIds.has(entry.id))
    .slice(0, 8)
    .map((entry) => ({ entry, track: byId.get(entry.id)! }));

  const favouriteTracks = favorites
    .map((id) => byId.get(id))
    .filter((track): track is MusicTrack => Boolean(track))
    .slice(0, 8);

  const heroIsPlaying = hero !== null && currentTrack?.id === hero.id && isPlaying;

  return (
    <div className="fade-up mx-auto max-w-[1440px]">
      <header className="mb-8">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-gold">The listening room</p>
        <h1 className="mt-2 font-display text-[36px] font-semibold leading-none tracking-[-0.04em] sm:text-[48px]">
          {greeting}
        </h1>
        <p className="mt-3 text-sm text-ink-muted">
          {totalTracks} recordings from SDA churches across East Africa · {formatTotal(totalDurationSeconds)} of singing
        </p>
      </header>

      {hero ? (
        <section className="relative mb-10 overflow-hidden rounded-[26px] bg-ink-fill shadow-soft">
          <div className="grid gap-6 p-6 sm:grid-cols-[190px_minmax(0,1fr)] sm:items-center sm:p-8">
            <div className="relative aspect-square overflow-hidden rounded-[18px] shadow-lift">
              <Image src={imgSrc(hero.image, FALLBACK_ART)} alt="" fill priority sizes="190px" className="object-cover warm-image" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-gold-light">Featured today</p>
              <h2 className="mt-2 font-display text-[26px] font-semibold leading-tight tracking-[-0.03em] text-white sm:text-[36px]">
                {hero.title}
              </h2>
              <p className="mt-2 text-sm text-white/60">{hero.artist} · {hero.duration} · {hero.language}</p>
              <div className="mt-6 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => playTracks([hero], 0)}
                  className="inline-flex h-11 items-center gap-2 rounded-xl bg-gold px-5 text-sm font-bold text-ink transition hover:bg-gold-light"
                >
                  {heroIsPlaying ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
                  {heroIsPlaying ? "Pause" : "Listen now"}
                </button>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {resumable.length > 0 ? (
        <Shelf title="Continue Listening" caption="Where you left off" href={null}>
          {resumable.map(({ entry, track }) => (
            <ResumeCard
              key={entry.id}
              track={track}
              position={entry.position}
              playing={currentTrack?.id === track.id && isPlaying}
              onPlay={() => playTracks([track], 0)}
            />
          ))}
        </Shelf>
      ) : null}

      {recentlyPlayed.length > 0 ? (
        <Shelf title="Recently Played" caption="From your listening history" href={null}>
          {recentlyPlayed.map(({ entry, track }) => (
            <RecentlyCard key={entry.id} track={track} playedAt={entry.at} queue={recentlyPlayed.map((item) => item.track)} />
          ))}
        </Shelf>
      ) : null}

      <Journey />

      {favouriteTracks.length > 0 || mixes.length > 0 ? (
        <section aria-label="Quick access" className="mb-10">
          <div className="no-scrollbar flex gap-4 overflow-x-auto pb-1">
            {favouriteTracks.map((track) => (
              <FavoritePlate key={track.id} track={track} queue={favouriteTracks} />
            ))}
            {mixes.map((mix) => (
              <MixBubble key={mix.slug} slug={mix.slug} title={mix.title} subtitle={mix.subtitle} count={mix.count} gradient={mix.gradient} />
            ))}
          </div>
        </section>
      ) : null}

      {rows.length === 0 ? (
        <div className="rounded-[22px] border border-dashed border-line bg-surface p-10 text-center text-sm text-ink-muted">
          No music has been ingested yet. Once the channel poller runs, these rows fill themselves.
        </div>
      ) : (
        rows.map((row) => <TrackRow key={row.id} title={row.title} subtitle={row.subtitle} tracks={row.tracks} />)
      )}
    </div>
  );
}

function Journey() {
  return (
    <section className="mb-11">
      <div className="mb-4">
        <h2 className="font-display text-[23px] font-semibold tracking-[-0.02em]">Worship Journey</h2>
        <p className="mt-1 text-xs text-ink-muted">Not what it is, but when you need it.</p>
      </div>
      <div className="no-scrollbar flex gap-3 overflow-x-auto pb-1 sm:grid sm:grid-cols-4 sm:gap-4 sm:overflow-visible lg:grid-cols-7">
        {JOURNEY.map((stop) => (
          <Link
            key={stop.id}
            href={stop.href}
            className="group flex w-[150px] shrink-0 flex-col rounded-[20px] border border-line bg-surface p-4 transition hover:-translate-y-0.5 hover:border-gold/50 hover:shadow-soft sm:w-auto"
          >
            <span className="grid size-10 place-items-center rounded-2xl bg-surface-soft text-terracotta transition group-hover:bg-terracotta-soft">
              {(() => {
                const Icon = JOURNEY_ICON[stop.icon];
                return <Icon size={18} />;
              })()}
            </span>
            <span className="mt-4 text-sm font-semibold leading-tight text-ink">{stop.label}</span>
            <span className="mt-1 text-[11px] leading-4 text-ink-muted">{stop.caption}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

function Shelf({
  title,
  caption,
  href,
  children,
}: {
  title: string;
  caption?: string;
  href: string | null;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-11">
      <div className="mb-4 flex items-end justify-between gap-4">
        <div className="min-w-0">
          <h2 className="font-display text-[23px] font-semibold tracking-[-0.02em]">{title}</h2>
          {caption ? <p className="mt-1 text-xs text-ink-muted">{caption}</p> : null}
        </div>
        {href ? (
          <Link href={href} className="inline-flex shrink-0 items-center gap-0.5 text-xs font-bold text-sage transition hover:text-ink">
            See all <ChevronRight size={14} />
          </Link>
        ) : null}
      </div>
      <div className="no-scrollbar flex gap-4 overflow-x-auto pb-1">{children}</div>
    </section>
  );
}

function ResumeCard({
  track,
  position,
  playing,
  onPlay,
}: {
  track: MusicTrack;
  position: number;
  playing: boolean;
  onPlay: () => void;
}) {
  return (
    <article className="group w-[168px] shrink-0">
      <button type="button" onClick={onPlay} className="block w-full text-left" aria-label={`Resume ${track.title}`}>
        <div className="relative aspect-square overflow-hidden rounded-[18px] bg-surface-soft shadow-soft">
          <Image src={imgSrc(track.image, FALLBACK_ART)} alt="" fill sizes="168px" className="object-cover warm-image transition duration-500 group-hover:scale-105" />
          <span className="absolute inset-0 grid place-items-center bg-ink-fill/35 opacity-0 transition group-hover:opacity-100">
            <span className="grid size-11 place-items-center rounded-full bg-ink-fill/85 text-white">
              {playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" className="translate-x-px" />}
            </span>
          </span>
          {/* How much is left, which is the only thing "continue" needs to say. */}
          <span className="absolute inset-x-2 bottom-2 rounded-lg bg-ink-fill/80 px-2 py-1 text-center text-[10px] font-bold tabular-nums text-white">
            {formatClock(position)} in
          </span>
        </div>
        <p className="mt-3 line-clamp-2 text-sm font-semibold leading-snug text-ink">{track.title}</p>
        <p className="mt-0.5 truncate text-[11px] text-ink-muted">{track.artist}</p>
      </button>
    </article>
  );
}

/** A played track as a plain square card; the whole card plays. */
function RecentlyCard({ track, playedAt, queue }: { track: MusicTrack; playedAt: number; queue: MusicTrack[] }) {
  const { playTracks, currentTrack, isPlaying } = useHymnora();
  const active = currentTrack?.id === track.id && isPlaying;
  const at = queue.findIndex((item) => item.id === track.id);
  return (
    <article className="group w-[168px] shrink-0">
      <button type="button" onClick={() => playTracks(queue, at)} className="block w-full text-left" aria-label={active ? `Pause ${track.title}` : `Play ${track.title}`}>
        <div className="relative aspect-square overflow-hidden rounded-[18px] bg-surface-soft shadow-soft">
          <Image src={imgSrc(track.image, FALLBACK_ART)} alt="" fill sizes="168px" className="object-cover warm-image transition duration-500 group-hover:scale-105" />
          <span className="absolute inset-0 grid place-items-center bg-ink-fill/35 opacity-0 transition group-hover:opacity-100">
            <span className="grid size-11 place-items-center rounded-full bg-ink-fill/85 text-white">
              {active ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" className="translate-x-px" />}
            </span>
          </span>
        </div>
        <p className="mt-3 line-clamp-1 text-sm font-semibold text-ink">{track.title}</p>
        <p className="mt-0.5 truncate text-[11px] text-ink-muted">{track.artist}</p>
        <p className="mt-1 text-[10.5px] text-ink-muted/70">{formatWhen(new Date(playedAt).toISOString())}</p>
      </button>
    </article>
  );
}

/** A favourite as one of the circular plates, matching the mixes beside it. The
 *  whole plate is the play button, not just a corner. */
function FavoritePlate({ track, queue }: { track: MusicTrack; queue: MusicTrack[] }) {
  const { playTracks, currentTrack, isPlaying } = useHymnora();
  const active = currentTrack?.id === track.id && isPlaying;
  const at = queue.findIndex((item) => item.id === track.id);
  return (
    <article className="group w-[150px] shrink-0 text-center sm:w-[160px]">
      <button
        type="button"
        onClick={() => playTracks(queue, at)}
        aria-label={active ? `Pause ${track.title}` : `Play ${track.title}`}
        className="block w-full text-center"
      >
        <div
          className="aspect-square w-full overflow-hidden rounded-full p-[3px] transition duration-500 group-hover:scale-[1.04]"
          style={{ backgroundImage: "linear-gradient(135deg, #b68935, #a34a32)" }}
        >
          <div className="relative size-full overflow-hidden rounded-full bg-surface-soft">
            <Image src={imgSrc(track.image, FALLBACK_ART)} alt="" fill sizes="160px" className="object-cover warm-image transition duration-500 group-hover:scale-105" />
            <span className="absolute inset-0 grid place-items-center bg-ink-fill/40 text-white opacity-0 transition group-hover:opacity-100">
              {active ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" className="translate-x-px" />}
            </span>
          </div>
        </div>
        <p className="mt-3 truncate text-[13px] font-semibold text-ink">{track.title}</p>
        <p className="mt-0.5 truncate text-[11px] text-ink-muted">{track.artist}</p>
      </button>
    </article>
  );
}

function MixBubble({
  slug,
  title,
  subtitle,
  count,
  gradient,
}: {
  slug: string;
  title: string;
  subtitle: string;
  count: number;
  gradient: [string, string];
}) {
  return (
    <Link href={`/music/${slug}`} className="group relative flex w-[150px] shrink-0 flex-col items-center text-center sm:w-[160px]">
      <div
        className="grid aspect-square w-full place-items-center overflow-hidden rounded-full p-[3px] transition duration-500 group-hover:scale-[1.04]"
        style={{ backgroundImage: `linear-gradient(135deg, ${gradient[0]}, ${gradient[1]})` }}
      >
        <div className="grid size-full place-items-center rounded-full" style={{ backgroundImage: `linear-gradient(135deg, ${gradient[1]}, ${gradient[0]})` }}>
          <span className="px-3 text-center font-display text-[14px] font-semibold leading-tight tracking-[-0.02em] text-white/95">{title}</span>
        </div>
      </div>
      {/* The title is already in the circle; the line below carries what it cannot. */}
      <p className="mt-3 text-[11px] leading-4 text-ink-muted">
        {subtitle} · {count} {count === 1 ? "track" : "tracks"}
      </p>
    </Link>
  );
}

function TrackRow({ title, subtitle, tracks }: { title: string; subtitle: string; tracks: MusicTrack[] }) {
  const { playTracks, currentTrack, isPlaying } = useHymnora();
  if (tracks.length === 0) return null;
  const rowIsPlaying = isPlaying && tracks.some((track) => track.id === currentTrack?.id);

  return (
    <section className="mb-9">
      <div className="mb-3 flex items-end justify-between gap-4">
        <div className="min-w-0">
          <h2 className="truncate font-display text-[22px] font-semibold tracking-[-0.02em]">{title}</h2>
          <p className="mt-0.5 truncate text-xs text-ink-muted">{subtitle}</p>
        </div>
        <button
          type="button"
          onClick={() =>
            playTracks(tracks, rowIsPlaying ? Math.max(0, tracks.findIndex((track) => track.id === currentTrack?.id)) : 0)
          }
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 py-1.5 text-xs font-bold text-ink transition hover:border-gold/60 hover:text-terracotta"
        >
          {rowIsPlaying ? <Pause size={11} fill="currentColor" /> : <Play size={11} fill="currentColor" />}
          {rowIsPlaying ? "Resume" : "Play all"}
        </button>
      </div>
      <div className="rounded-[22px] border border-line bg-surface p-2 sm:p-3">
        {tracks.map((track, index) => (
          <TrackLine key={track.id} track={track} index={index} queue={tracks} />
        ))}
      </div>
    </section>
  );
}

function TrackLine({ track, index, queue }: { track: MusicTrack; index: number; queue: MusicTrack[] }) {
  const { playTracks, currentTrack, isPlaying, isFavorite, toggleFavorite } = useHymnora();
  const active = currentTrack?.id === track.id && isPlaying;
  const favourite = isFavorite(track.id);

  return (
    <div className={`group flex items-center gap-3 rounded-2xl px-2.5 py-2 transition sm:gap-4 sm:px-3 ${active ? "bg-surface-soft" : "hover:bg-surface-soft"}`}>
      <button
        type="button"
        onClick={() => playTracks(queue, index)}
        aria-label={active ? `Pause ${track.title}` : `Play ${track.title}`}
        className="flex min-w-0 flex-1 items-center gap-3 text-left sm:gap-4"
      >
        <span className="w-4 shrink-0 text-center text-xs tabular-nums text-ink-muted">{index + 1}</span>
        <span className="relative size-11 shrink-0 overflow-hidden rounded-xl">
          <Image src={imgSrc(track.image, FALLBACK_ART)} alt="" fill sizes="44px" className="object-cover warm-image" />
          <span className="absolute inset-0 grid place-items-center bg-ink-fill/45 text-white opacity-0 transition group-hover:opacity-100">
            {active ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" className="translate-x-px" />}
          </span>
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-sm font-semibold ${active ? "text-terracotta" : "text-ink"}`}>{track.title}</span>
          <span className="mt-0.5 block truncate text-xs text-ink-muted">{track.artist}</span>
        </span>
        <span className="hidden shrink-0 rounded-full bg-surface-soft px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.1em] text-ink-soft sm:inline">
          {track.subCategory ?? track.genre ?? "Music"}
        </span>
        <span className="hidden w-20 shrink-0 truncate text-right text-xs text-ink-muted md:block">{track.language}</span>
        <span className="w-10 shrink-0 text-right text-xs tabular-nums text-ink-muted">{track.duration}</span>
      </button>
      <button
        type="button"
        onClick={() => toggleFavorite(track.id)}
        aria-pressed={favourite}
        aria-label={favourite ? `Remove ${track.title} from favourites` : `Add ${track.title} to favourites`}
        className={`grid size-8 shrink-0 place-items-center rounded-full transition ${favourite ? "text-terracotta" : "text-ink-muted opacity-0 hover:text-terracotta group-hover:opacity-100 focus-visible:opacity-100"}`}
      >
        <svg viewBox="0 0 24 24" width="15" height="15" fill={favourite ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
          <path d="M12 20.5 3.8 12.3a5 5 0 1 1 7.1-7l1.1 1.1 1.1-1.1a5 5 0 1 1 7.1 7Z" />
        </svg>
      </button>
    </div>
  );
}
