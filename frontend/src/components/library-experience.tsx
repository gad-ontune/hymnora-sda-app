"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Clock3, Download, Heart, ListMusic, LockKeyhole, Play, Plus, Radio } from "lucide-react";
import { useMemo, useState, useEffect } from "react";
import { ContentCard } from "@/components/content-card";
import { FavoriteButton } from "@/components/favorite-button";
import { PageIntro } from "@/components/page-intro";
import { SectionHeading } from "@/components/section-heading";
import { useHymnora } from "@/components/hymnora-provider";
import { clearHistory, useHistory } from "@/lib/history";
import { getHymnsData, getNewsData, getSermonsData, getTracksData, getVideoPageData } from "@/lib/data";
import type { Hymn, NewsItem, Sermon, Track, VideoCard } from "@/lib/types";
import { imgSrc } from "../lib/image";

const tabs = ["Saved", "Playlists", "Recently played", "Downloads"] as const;
type Tab = (typeof tabs)[number];

export function LibraryExperience() {
  const [tab, setTab] = useState<Tab>("Saved");
  const [newPlaylist, setNewPlaylist] = useState(false);
  const [playlistName, setPlaylistName] = useState("");
  const { favorites } = useHymnora();
  const [tracks, setTracks] = useState<Track[]>([]);
  const [hymns, setHymns] = useState<Hymn[]>([]);
  const [sermons, setSermons] = useState<Sermon[]>([]);
  const [newsItems, setNewsItems] = useState<NewsItem[]>([]);
  const [videos, setVideos] = useState<VideoCard[]>([]);

  useEffect(() => {
    Promise.all([getTracksData(), getHymnsData(), getSermonsData(), getNewsData()]).then(([t, h, s, n]) => {
      setTracks(t);
      setHymns(h);
      setSermons(s);
      setNewsItems(n);
    });
  }, []);

  // A video can be favourited from its watch page, so the library has to be able
  // to resolve that id back to something it can list. Kept intact from the old
  // view — paged only as far as it needs to go, so an empty library costs nothing.
  const resolvedElsewhere = useMemo(() => {
    const ids = new Set([...tracks, ...hymns, ...sermons, ...newsItems].map((item: { id: string }) => item.id));
    return favorites.filter((id) => !ids.has(id));
  }, [favorites, tracks, hymns, sermons, newsItems]);

  useEffect(() => {
    if (resolvedElsewhere.length === 0) return;
    let cancelled = false;
    void (async () => {
      const found: VideoCard[] = [];
      const wanted = new Set(resolvedElsewhere);
      for (let offset = 0; offset < 144 && wanted.size > 0; offset += 48) {
        const page = await getVideoPageData({ limit: 48, offset });
        if (cancelled) return;
        for (const video of page.items) {
          if (wanted.has(video.id)) {
            found.push(video);
            wanted.delete(video.id);
          }
        }
        if (page.items.length < 48) break;
      }
      if (!cancelled) setVideos(found);
    })().catch(() => {
      if (!cancelled) setVideos([]);
    });
    return () => {
      cancelled = true;
    };
  }, [resolvedElsewhere]);

  const favoriteTracks = useMemo(() => tracks.filter((track) => favorites.includes(track.id)), [favorites, tracks]);
  const favoriteHymns = useMemo(() => hymns.filter((hymn) => favorites.includes(hymn.id)), [favorites, hymns]);
  const favoriteSermons = useMemo(() => sermons.filter((sermon) => favorites.includes(sermon.id)), [favorites, sermons]);
  const favoriteNews = newsItems.filter((article) => favorites.includes(article.id));
  const favoriteVideos = useMemo(() => {
    const byId = new Map(videos.map((video) => [video.id, video]));
    return resolvedElsewhere
      .map((id) => byId.get(id))
      .filter((video): video is VideoCard => Boolean(video));
  }, [resolvedElsewhere, videos]);

  const savedKinds = [
    { label: "Songs", count: favoriteTracks.length, icon: Play, tone: "bg-gold-soft text-gold" },
    { label: "Hymns", count: favoriteHymns.length, icon: ListMusic, tone: "bg-sage-soft text-sage" },
    { label: "Sermons", count: favoriteSermons.length, icon: Radio, tone: "bg-terracotta-soft text-terracotta" },
    { label: "Videos", count: favoriteVideos.length, icon: ArrowRight, tone: "bg-surface-soft text-ink-soft" },
  ];

  function createPlaylist(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (playlistName.trim()) {
      setPlaylistName("");
      setNewPlaylist(false);
    }
  }

  return (
    <div className="fade-up mx-auto max-w-[1440px]">
      <PageIntro
        eyebrow="Your quiet corner"
        title="Keep what you want close."
        description="Your saved songs, hymns, sermons and stories live here — private, organized and ready whenever you are."
        action={
          <button type="button" onClick={() => setNewPlaylist(true)} className="inline-flex h-11 items-center gap-2 rounded-xl bg-ink-fill px-4 text-sm font-bold text-white transition hover:bg-sage">
            <Plus size={16} className="text-gold-light" /> New playlist
          </button>
        }
      />

      <div className="mb-9 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {savedKinds.map((kind) => {
          const Icon = kind.icon;
          return (
            <button
              key={kind.label}
              type="button"
              onClick={() => setTab("Saved")}
              className="group flex items-center gap-4 rounded-[22px] border border-line bg-surface p-5 text-left shadow-soft transition hover:-translate-y-0.5 hover:border-gold/50"
            >
              <span className={`grid size-12 shrink-0 place-items-center rounded-2xl ${kind.tone}`}><Icon size={20} /></span>
              <span>
                <span className="block font-display text-[26px] font-semibold leading-none">{kind.count}</span>
                <span className="mt-1 block text-xs font-medium text-ink-muted">{kind.label} saved</span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="no-scrollbar mb-8 flex gap-1.5 overflow-x-auto rounded-full border border-line bg-surface p-1.5 shadow-soft sm:w-fit">
        {tabs.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setTab(item)}
            className={`shrink-0 rounded-full px-5 py-2.5 text-sm font-semibold transition ${tab === item ? "bg-ink-fill text-white shadow-lift" : "text-ink-muted hover:text-ink"}`}
          >
            {item}
          </button>
        ))}
      </div>

      {tab === "Saved" ? <SavedView favoriteTracks={favoriteTracks} favoriteHymns={favoriteHymns} favoriteSermons={favoriteSermons} favoriteNews={favoriteNews} favoriteVideos={favoriteVideos} favorites={favorites} /> : null}
      {tab === "Playlists" ? <PlaylistsView onCreate={() => setNewPlaylist(true)} /> : null}
      {tab === "Recently played" ? <RecentView /> : null}
      {tab === "Downloads" ? <DownloadsView /> : null}

      {newPlaylist ? (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-ink-fill/45 p-5 backdrop-blur-sm">
          <form onSubmit={createPlaylist} className="w-full max-w-md rounded-[26px] bg-surface p-6 shadow-lift sm:p-8">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-gold">New playlist</p>
                <h2 className="mt-1 font-display text-[28px] font-semibold">Give it a feeling.</h2>
              </div>
              <button type="button" onClick={() => setNewPlaylist(false)} className="text-sm text-ink-muted">Close</button>
            </div>
            <label className="mt-6 block">
              <span className="text-xs font-bold uppercase tracking-[0.14em] text-ink-muted">Playlist name</span>
              <input
                autoFocus
                value={playlistName}
                onChange={(event) => setPlaylistName(event.target.value)}
                placeholder="Saturday Worship"
                className="mt-2 h-12 w-full rounded-xl border border-line bg-canvas px-3 text-sm outline-none focus:border-gold/60 focus:ring-4 focus:ring-gold/10"
              />
            </label>
            <button type="submit" className="mt-5 h-11 w-full rounded-xl bg-ink-fill text-sm font-bold text-white transition hover:bg-sage">Create playlist</button>
          </form>
        </div>
      ) : null}
    </div>
  );
}

function SavedView({ favoriteTracks, favoriteHymns, favoriteSermons, favoriteNews, favoriteVideos, favorites }: { favoriteTracks: Track[]; favoriteHymns: Hymn[]; favoriteSermons: Sermon[]; favoriteNews: NewsItem[]; favoriteVideos: VideoCard[]; favorites: string[] }) {
  return favorites.length === 0 ? (
    <div className="rounded-[26px] border border-line bg-surface p-10 text-center shadow-soft sm:p-16">
      <span className="mx-auto grid size-16 place-items-center rounded-2xl bg-gold-soft text-gold"><Heart size={26} /></span>
      <h2 className="mt-5 font-display text-[28px] font-semibold">Nothing saved yet.</h2>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-ink-muted">Tap the heart on any song, hymn, sermon or story you want to keep close — everything lands here.</p>
      <Link href="/music" className="mt-6 inline-flex h-11 items-center gap-2 rounded-xl bg-ink-fill px-5 text-sm font-bold text-white transition hover:bg-sage">Explore music <ArrowRight size={15} /></Link>
    </div>
  ) : (
    <div className="grid gap-6 lg:grid-cols-2 xl:grid-cols-3">
      <SavedColumn
        title="Songs"
        count={favoriteTracks.length}
        empty="You have not saved any music yet."
        cta={{ label: "Add songs", href: "/music" }}
      >
        <div className="grid grid-cols-2 gap-3">
          {favoriteTracks.map((track) => <ContentCard key={track.id} track={track} href="/music" compact />)}
        </div>
      </SavedColumn>

      <SavedColumn title="Hymns" count={favoriteHymns.length} empty="You have not saved any hymns yet." cta={{ label: "Browse hymns", href: "/hymns" }}>
        <div className="grid grid-cols-2 gap-3">
          {favoriteHymns.map((hymn) => <ContentCard key={hymn.id} track={{ id: hymn.id, title: `Hymn ${hymn.number} · ${hymn.title ?? "Untitled"}`, artist: hymn.edition, album: hymn.theme ?? "", image: hymn.image, duration: hymn.duration, language: hymn.language, kind: "hymn" }} href="/hymns" compact />)}
        </div>
      </SavedColumn>

      <SavedColumn title="Sermons" count={favoriteSermons.length} empty="No saved sermons yet." cta={{ label: "Find sermons", href: "/sermons" }}>
        {favoriteSermons.map((sermon) => <SavedRow key={sermon.id} id={sermon.id} image={imgSrc(sermon.image, "/images/speaker-daniel.jpg")} title={sermon.title} sub={`${sermon.speaker} · ${sermon.duration}`} href="/sermons" />)}
      </SavedColumn>

      <SavedColumn title="Videos" count={favoriteVideos.length} empty="No saved videos yet." cta={{ label: "Watch videos", href: "/videos" }}>
        {favoriteVideos.map((video) => (
          <Link key={video.id} href={`/videos/${video.videoId}`} className="group flex items-center gap-3 rounded-2xl p-2 transition hover:bg-surface-soft">
            <div className="relative size-12 shrink-0 overflow-hidden rounded-xl"><Image src={imgSrc(video.thumbnail, "/images/church.jpg")} alt="" fill sizes="48px" className="object-cover warm-image" /></div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-ink group-hover:text-sage">{video.title}</p>
              <p className="mt-1 flex items-center gap-1 text-xs text-ink-muted"><Clock3 size={12} /> {video.duration}</p>
            </div>
            <FavoriteButton id={video.id} className="size-8 bg-surface-soft text-terracotta" />
          </Link>
        ))}
      </SavedColumn>

      <SavedColumn title="Stories" count={favoriteNews.length} empty="No saved stories yet." cta={{ label: "Read news", href: "/news" }}>
        {favoriteNews.map((article) => (
          <Link key={article.id} href="/news" className="group flex items-center gap-3 rounded-2xl p-2 transition hover:bg-surface-soft">
            <div className="relative size-12 shrink-0 overflow-hidden rounded-xl"><Image src={imgSrc(article.image, "/images/golden-hour.jpg")} alt="" fill sizes="48px" className="object-cover warm-image" /></div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-terracotta">{article.category}</p>
              <p className="mt-0.5 line-clamp-2 text-sm font-semibold leading-5 text-ink group-hover:text-sage">{article.title}</p>
            </div>
            <FavoriteButton id={article.id} className="size-8 bg-surface-soft text-terracotta" />
          </Link>
        ))}
      </SavedColumn>
    </div>
  );
}

function SavedColumn({ title, count, empty, cta, children }: { title: string; count: number; empty: string; cta: { label: string; href: string }; children: React.ReactNode }) {
  return (
    <div className="rounded-[26px] border border-line bg-surface p-5 shadow-soft">
      <div className="flex items-end justify-between px-1">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-gold">Saved for later</p>
          <h3 className="mt-1 font-display text-[23px] font-semibold">{title} <span className="text-ink-muted">· {count}</span></h3>
        </div>
        {count > 0 ? <Link href={cta.href} className="text-xs font-semibold text-sage hover:text-ink">{cta.label}</Link> : null}
      </div>
      <div className="mt-4">
        {count > 0 ? (
          <div className="space-y-1 rounded-2xl border border-line/70 bg-canvas/40 p-2">{children}</div>
        ) : (
          <div className="rounded-2xl border border-dashed border-line p-6 text-center">
            <p className="text-sm text-ink-muted">{empty}</p>
            <Link href={cta.href} className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-sage hover:text-ink">{cta.label} <ArrowRight size={14} /></Link>
          </div>
        )}
      </div>
    </div>
  );
}

function SavedRow({ id, image, title, sub, href }: { id: string; image: string; title: string; sub: string; href: string }) {
  return (
    <div className="group flex items-center gap-3 rounded-2xl p-2 transition hover:bg-surface-soft">
      <Link href={href} className="relative size-12 shrink-0 overflow-hidden rounded-xl">
        <Image src={image} alt="" fill sizes="48px" className="object-cover warm-image" />
      </Link>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-ink">{title}</p>
        <p className="mt-1 text-xs text-ink-muted">{sub}</p>
      </div>
      <FavoriteButton id={id} className="size-8 bg-surface-soft text-terracotta" />
    </div>
  );
}

function PlaylistsView({ onCreate }: { onCreate: () => void }) {
  return (
    <div>
      <SectionHeading eyebrow="Your collections" title="Playlists with a purpose." description="Build a worship session for a particular day, place or person." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <button type="button" onClick={onCreate} className="flex min-h-[220px] flex-col items-center justify-center rounded-[22px] border border-dashed border-gold/60 bg-gold-soft/40 text-center transition hover:bg-gold-soft">
          <span className="grid size-11 place-items-center rounded-2xl bg-gold text-ink shadow-lift"><Plus size={20} /></span>
          <span className="mt-4 text-sm font-semibold">Create a new playlist</span>
          <span className="mt-1 text-xs text-ink-muted">Start with a feeling</span>
        </button>
        <PlaylistCard title="Saturday Worship" count="12 pieces" image="/images/church.jpg" color="bg-sage" tag="Sabbath" />
        <PlaylistCard title="Quiet mornings" count="8 pieces" image="/images/piano.jpg" color="bg-gold" tag="Devotion" />
        <PlaylistCard title="For the road" count="16 pieces" image="/images/golden-hour.jpg" color="bg-terracotta" tag="Listen" />
      </div>
    </div>
  );
}

function RecentView() {
  const history = useHistory();
  const { playTrack } = useHymnora();
  const resumed = history.filter((entry) => entry.position > 15);
  const recent = history.filter((entry) => entry.position <= 15);

  function playEntry(entry: { id: string; title: string; artist: string; image: string; duration: string }) {
    playTrack({ ...entry, album: "", language: "English", kind: "audio" });
  }

  return (
    <div>
      <SectionHeading
        eyebrow="Your path"
        title="Recently played"
        description="A gentle trail of where your attention has been."
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-1 rounded-[26px] border border-line bg-surface p-3 shadow-soft">
          {history.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-line p-8 text-center text-sm text-ink-muted">Play something to start leaving a trail here.</p>
          ) : (
            <>
              {resumed.map((entry) => (
                <div key={entry.id} className="group flex items-center gap-3 rounded-2xl px-2 py-2.5 transition hover:bg-surface-soft">
                  <div className="relative size-12 shrink-0 overflow-hidden rounded-xl">
                    <Image src={imgSrc(entry.image, "/images/piano.jpg")} alt="" fill sizes="48px" className="object-cover warm-image" />
                    <button type="button" onClick={() => playEntry(entry)} className="absolute inset-0 grid place-items-center bg-ink-fill/35 opacity-0 transition group-hover:opacity-100" aria-label={`Resume ${entry.title}`}>
                      <span className="grid size-8 place-items-center rounded-full bg-gold text-ink shadow-lift"><Play size={14} fill="currentColor" /></span>
                    </button>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ink">{entry.title}</p>
                    <p className="truncate text-xs text-ink-muted">{entry.artist}</p>
                  </div>
                  <span className="hidden rounded-full bg-sage-soft px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.1em] text-sage sm:block">Resume</span>
                  <span className="relative h-1.5 w-16 overflow-hidden rounded-full bg-line sm:w-24">
                    <span className="absolute inset-y-0 left-0 rounded-full bg-gold" style={{ width: `${Math.min(100, (entry.position / parseDuration(entry.duration)) * 100)}%` }} />
                  </span>
                  <span className="text-xs tabular-nums text-ink-muted">{when(entry.at)}</span>
                </div>
              ))}
              {recent.map((entry) => (
                <div key={entry.id} className="group flex items-center gap-3 rounded-2xl px-2 py-2.5 transition hover:bg-surface-soft">
                  <div className="relative size-12 shrink-0 overflow-hidden rounded-xl">
                    <Image src={imgSrc(entry.image, "/images/piano.jpg")} alt="" fill sizes="48px" className="object-cover warm-image" />
                    <button type="button" onClick={() => playEntry(entry)} className="absolute inset-0 grid place-items-center bg-ink-fill/35 opacity-0 transition group-hover:opacity-100" aria-label={`Play ${entry.title}`}>
                      <span className="grid size-8 place-items-center rounded-full bg-gold text-ink shadow-lift"><Play size={14} fill="currentColor" /></span>
                    </button>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ink">{entry.title}</p>
                    <p className="truncate text-xs text-ink-muted">{entry.artist}</p>
                  </div>
                  <span className="text-xs tabular-nums text-ink-muted">{entry.duration}</span>
                  <span className="text-xs tabular-nums text-ink-muted">{when(entry.at)}</span>
                </div>
              ))}
            </>
          )}
        </div>
        <div className="h-fit rounded-[26px] bg-ink-fill p-6 text-white shadow-soft">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-gold-light">Your rhythm</p>
          <p className="mt-2 font-display text-[38px] font-semibold">{history.length}</p>
          <p className="mt-1 text-sm text-white/50">recent pieces this week</p>
          <div className="mt-6 space-y-3">
            <Progress label="Resumed" value={resumed.length} total={history.length || 1} color="bg-gold" />
            <Progress label="Finished" value={recent.length} total={history.length || 1} color="bg-sage-soft" />
          </div>
          <button type="button" onClick={clearHistory} className="mt-8 w-full rounded-xl border border-white/15 py-2.5 text-sm font-semibold text-white/70 transition hover:bg-white/10">Clear history</button>
        </div>
      </div>
    </div>
  );
}

function DownloadsView() {
  return (
    <div>
      <SectionHeading eyebrow="Available offline" title="Take a little Hymnora with you." description="Downloads appear here when the content owner has allowed offline listening." />
      <div className="rounded-[26px] border border-line bg-surface p-6 text-center shadow-soft sm:p-14">
        <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-sage-soft text-sage"><Download size={24} /></span>
        <h2 className="mt-5 font-display text-[27px] font-semibold">Your offline shelf is empty.</h2>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-ink-muted">Look for the download icon on songs, sermons and hymns where the rights holder has made it available.</p>
        <Link href="/music" className="mt-5 inline-flex h-11 items-center gap-2 rounded-xl bg-ink-fill px-4 text-sm font-bold text-white">Explore music <ArrowRight size={15} /></Link>
      </div>
      <div className="mt-5 flex items-center gap-2 rounded-2xl border border-line bg-surface-soft p-4 text-sm text-ink-muted"><LockKeyhole size={17} className="text-gold" /> Downloads are permission-controlled and expire when a license requires it.</div>
    </div>
  );
}

function PlaylistCard({ title, count, image, color, tag }: { title: string; count: string; image: string; color: string; tag: string }) {
  return (
    <Link href="/library" className="group overflow-hidden rounded-[22px] border border-line bg-surface shadow-soft transition hover:-translate-y-0.5 hover:shadow-lift">
      <div className={`relative aspect-[1.4] ${color}`}>
        <Image src={imgSrc(image, "/images/golden-hour.jpg")} alt="" fill sizes="33vw" className="object-cover warm-image mix-blend-multiply opacity-75 transition duration-500 group-hover:scale-105" />
        <div className="absolute inset-0 bg-gradient-to-t from-ink/55 to-transparent" />
        <span className="absolute left-4 top-4 rounded-full bg-white/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-white backdrop-blur-sm">{tag}</span>
        <span className="absolute bottom-4 left-4 grid size-10 place-items-center rounded-xl bg-surface/90 text-ink shadow-lift"><ListMusic size={18} /></span>
      </div>
      <div className="p-4">
        <h3 className="font-display text-[21px] font-semibold">{title}</h3>
        <p className="mt-1 text-xs text-ink-muted">{count} · Private</p>
      </div>
    </Link>
  );
}

function Progress({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const width = `${Math.max(4, Math.round((value / total) * 100))}%`;
  return (
    <div>
      <div className="flex items-center justify-between text-xs"><span className="text-white/60">{label}</span><span className="text-white/45">{value}</span></div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10"><div className={`h-full rounded-full ${color}`} style={{ width }} /></div>
    </div>
  );
}

function parseDuration(duration: string): number {
  if (!duration) return 0;
  const [minutes, seconds] = duration.split(":").map(Number);
  if (Number.isNaN(minutes) || Number.isNaN(seconds)) return 0;
  return minutes * 60 + seconds;
}

function when(epochMs: number): string {
  const diff = Date.now() - epochMs;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(epochMs).toLocaleDateString();
}