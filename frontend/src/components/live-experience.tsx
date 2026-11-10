"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Captions, Headphones, LayoutGrid, Pause, Play, Radio, Settings2, Users, Volume2, X } from "lucide-react";
import { useState, useEffect } from "react";
import { PageIntro } from "@/components/page-intro";
import { PlayButton } from "@/components/play-button";
import { SectionHeading } from "@/components/section-heading";
import { useHymnora } from "@/components/hymnora-provider";
import { getHeroTrackData, getTracksData, getLiveStreamsData } from "@/lib/data";
import type { LiveStream, Track } from "@/lib/types";
import { imgSrc } from "../lib/image";

const tabs = ["Live now", "Starting soon", "Upcoming", "Recently ended"];

export function LiveExperience() {
  const [tab, setTab] = useState("Live now");
  const [streams, setStreams] = useState<LiveStream[]>([]);
  const [selected, setSelected] = useState<LiveStream | null>(null);
  const [playing, setPlaying] = useState(false);
  const [heroTrack, setHeroTrack] = useState<Track>({ id: "worship-beyond-music", title: "", artist: "", album: "", image: "/images/worship-singer.jpg", duration: "", language: "", kind: "video" });
  const [tracks, setTracks] = useState<Track[]>([]);
  const { playTrack, currentTrack, isPlaying, togglePlay } = useHymnora();

  useEffect(() => {
    getHeroTrackData().then(setHeroTrack);
    getTracksData().then(setTracks);
    getLiveStreamsData()
      .then((data) => {
        setStreams(data);
        setSelected(data[0] ?? null);
      })
      .catch(() => setStreams([]));
  }, []);

  const featuredId = streams[0]?.id ?? "";
  const visibleStreams = streams.filter((stream) => stream.status === tab);
  const featuredPlaying = selected?.id === featuredId ? currentTrack?.id === heroTrack.id && isPlaying : playing;
  const liveNow = streams.filter((stream) => stream.status === "Live now").length;

  function toggleFeatured() {
    if (selected?.id === featuredId) {
      if (currentTrack?.id === heroTrack.id) togglePlay();
      else playTrack(heroTrack);
      return;
    }
    setPlaying((current) => !current);
  }

  function watch(stream: LiveStream) {
    setSelected(stream);
    setPlaying(stream.id !== featuredId);
    if (stream.id === featuredId) playTrack(heroTrack);
  }

  // Schedule order: what is airing now, then soon, then later.
  const schedule = [...streams].sort((a, b) => statusRank(a.status) - statusRank(b.status));

  return (
    <div className="fade-up mx-auto max-w-[1440px]">
      <PageIntro
        eyebrow="Live from the community"
        title="Be there, wherever you are."
        description="Authorized worship services, concerts and conversations happening across the SDA digital community — right now and next."
      />

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.7fr)]">
        {/* Featured player */}
        <div className="overflow-hidden rounded-[26px] bg-ink-fill shadow-lift">
          <div className="relative aspect-video min-h-[290px] overflow-hidden sm:min-h-[430px]">
            <Image src={imgSrc(selected?.image, "/images/church.jpg") || "/images/church.jpg"} alt="A worship service ready to begin" fill priority sizes="(max-width: 1280px) 100vw, 65vw" className="object-cover warm-image" />
            <div className="absolute inset-0 bg-gradient-to-t from-ink/95 via-ink/25 to-ink/20" />
            <div className="absolute inset-x-5 top-5 flex items-center justify-between sm:inset-x-8 sm:top-7">
              <span className="flex items-center gap-2 rounded-full bg-terracotta px-3.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-white shadow-lift">
                <span className="size-1.5 animate-pulse rounded-full bg-white" /> {selected?.status}
              </span>
              <span className="hidden items-center gap-2 rounded-full border border-white/15 bg-ink-fill/35 px-3 py-1.5 text-[11px] font-semibold text-white/80 backdrop-blur-md sm:flex">
                <Users size={13} /> {selected?.viewers}
              </span>
            </div>
            <div className="absolute inset-x-5 bottom-5 sm:inset-x-8 sm:bottom-7">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-gold-light">{selected?.church} · {selected?.category}</p>
              <h2 className="mt-1.5 font-display text-[29px] font-semibold leading-tight tracking-[-0.03em] text-white sm:text-[42px]">{selected?.title}</h2>
              <p className="mt-2 flex items-center gap-2 text-xs text-white/60"><Radio size={13} /> {selected?.time} · {selected?.language}</p>
            </div>
          </div>
          {/* Player chrome */}
          <div className="flex items-center gap-3 border-t border-white/10 px-5 py-3.5 sm:px-8">
            <button type="button" onClick={toggleFeatured} className="grid size-12 shrink-0 place-items-center rounded-full bg-gold text-ink shadow-lift transition hover:scale-105 hover:bg-gold-light" aria-label={featuredPlaying ? "Pause stream" : "Play stream"}>
              {featuredPlaying ? <Pause size={19} fill="currentColor" /> : <Play size={19} fill="currentColor" />}
            </button>
            <div className="min-w-0 flex-1">
              <div className="hidden h-1 overflow-hidden rounded-full bg-white/15 sm:block"><div className="h-full w-[12%] rounded-full bg-gold-light" /></div>
              <div className="mt-1.5 flex items-center justify-between text-[11px] text-white/45">
                <span>{featuredPlaying ? "On air now" : "Paused"}</span>
                <span>{selected?.time}</span>
              </div>
            </div>
            <span className="hidden items-center gap-1.5 rounded-xl border border-white/15 bg-ink-fill/35 px-3 py-2 text-xs text-white/70 backdrop-blur-sm sm:flex"><Captions size={14} /> Captions</span>
            <span className="hidden items-center gap-1.5 rounded-xl border border-white/15 bg-ink-fill/35 px-3 py-2 text-xs text-white/70 backdrop-blur-sm sm:flex"><Volume2 size={14} /> Audio</span>
            <button type="button" className="grid size-10 place-items-center rounded-xl border border-white/15 bg-ink-fill/35 text-white/70 backdrop-blur-sm transition hover:bg-white/10" aria-label="More options"><Settings2 size={16} /></button>
            <button type="button" onClick={() => setSelected(null)} className="grid size-10 place-items-center rounded-xl border border-white/15 bg-ink-fill/35 text-white/70 backdrop-blur-sm transition hover:bg-white/10" aria-label="Close player"><X size={16} /></button>
          </div>
        </div>

        {/* Now & next rail */}
        <div className="flex flex-col gap-5">
          <div className="rounded-[26px] border border-line bg-surface p-5 shadow-soft sm:p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-gold">On now &amp; next</p>
                <h2 className="mt-1 font-display text-[24px] font-semibold">Broadcast schedule</h2>
              </div>
              {liveNow > 0 ? (
                <span className="flex items-center gap-1.5 rounded-full bg-terracotta-soft px-3 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-terracotta">
                  <span className="size-1.5 animate-pulse rounded-full bg-terracotta" /> {liveNow} live
                </span>
              ) : null}
            </div>
            <div className="mt-4 space-y-1">
              {schedule.slice(0, 6).map((stream) => {
                const active = selected?.id === stream.id;
                return (
                  <button
                    key={stream.id}
                    type="button"
                    onClick={() => watch(stream)}
                    className={`flex w-full items-center gap-3 rounded-2xl border p-2.5 text-left transition ${active ? "border-gold/70 bg-gold-soft/50" : "border-transparent hover:bg-surface-soft"}`}
                  >
                    <div className="relative size-12 shrink-0 overflow-hidden rounded-xl">
                      <Image src={imgSrc(stream.image, "/images/church.jpg")} alt="" fill sizes="48px" className="object-cover warm-image" />
                      {stream.status === "Live now" ? <span className="absolute right-1 top-1 size-2 animate-pulse rounded-full bg-terracotta" /> : null}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-ink">{stream.title}</p>
                      <p className="mt-0.5 truncate text-xs text-ink-muted">{stream.church}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-terracotta">{statusLabel(stream.status)}</p>
                      <p className="mt-0.5 text-[11px] text-ink-muted">{stream.viewerCount} watching</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-line bg-surface p-4">
              <div className="flex items-center gap-3">
                <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-gold-soft text-gold"><LayoutGrid size={18} /></div>
                <div><p className="text-sm font-semibold">Multiview</p><p className="text-[11px] text-ink-muted">{selected?.multiviewCount ?? 2} angles</p></div>
              </div>
            </div>
            <div className="rounded-2xl border border-line bg-surface p-4">
              <div className="flex items-center gap-3">
                <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-gold-soft text-gold"><Radio size={18} /></div>
                <div><p className="text-sm font-semibold">Live audio</p><p className="text-[11px] text-ink-muted">{selected?.captionsAvailable ? "Captions on" : "Sermon & music"}</p></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="no-scrollbar mb-8 mt-10 flex gap-1.5 overflow-x-auto rounded-full border border-line bg-surface p-1.5 shadow-soft sm:w-fit">
        {tabs.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setTab(item)}
            className={`flex shrink-0 items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold transition ${tab === item ? "bg-ink-fill text-white shadow-lift" : "text-ink-muted hover:text-ink"}`}
          >
            {item !== "Live now" ? null : <span className="size-1.5 rounded-full bg-terracotta" />}
            {item}
          </button>
        ))}
      </div>

      <section>
        <SectionHeading title={tab} description="A schedule that keeps the important things close." />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {visibleStreams.map((stream) => (
            <button type="button" key={stream.id} onClick={() => watch(stream)} className={`group overflow-hidden rounded-[22px] border bg-surface text-left shadow-soft transition hover:-translate-y-0.5 hover:shadow-lift ${selected?.id === stream.id ? "border-gold/70" : "border-line"}`}>
              <div className="relative aspect-[1.4] overflow-hidden">
                <Image src={imgSrc(stream.image, "/images/church.jpg")} alt="" fill sizes="(max-width: 640px) 100vw, 25vw" className="object-cover warm-image transition duration-500 group-hover:scale-105" />
                <div className="absolute inset-0 bg-gradient-to-t from-ink/70 to-transparent" />
                <span className={`absolute left-3 top-3 rounded-full px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.12em] ${stream.status === "Live now" ? "bg-terracotta text-white" : "bg-surface/90 text-ink-soft"}`}>{stream.status}</span>
                <span className="absolute bottom-3 right-3 grid size-9 place-items-center rounded-full bg-gold text-ink shadow-lift"><Play size={14} fill="currentColor" /></span>
              </div>
              <div className="p-4">
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-terracotta">{stream.time}</p>
                <h3 className="mt-1 line-clamp-2 font-display text-[20px] font-semibold leading-tight">{stream.title}</h3>
                <p className="mt-2 text-xs text-ink-muted">{stream.church}</p>
                <p className="mt-3 flex items-center gap-1 text-[11px] text-ink-muted"><Users size={13} /> {stream.viewers}</p>
              </div>
            </button>
          ))}
          {visibleStreams.length === 0 ? <p className="col-span-full rounded-[22px] border border-dashed border-line bg-surface p-10 text-center text-sm text-ink-muted">Nothing here yet — check back closer to the time.</p> : null}
        </div>
      </section>

      <section className="mt-12 grid gap-5 lg:grid-cols-2">
        <div className="rounded-[26px] border border-line bg-surface p-6 sm:p-8">
          <div className="flex items-center gap-2"><Headphones size={18} className="text-gold" /><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-gold">Listen your way</p></div>
          <h2 className="mt-3 font-display text-[28px] font-semibold">Keep listening on the move.</h2>
          <p className="mt-2 text-sm leading-6 text-ink-muted">Live audio, captions and background listening are available wherever the rights holder allows it.</p>
          <div className="mt-5 flex items-center gap-3"><PlayButton track={tracks[0]} className="size-10" /><span className="text-sm font-semibold">Continue your audio session</span></div>
        </div>
        <div className="rounded-[26px] bg-sage p-6 text-white sm:p-8">
          <div className="flex items-center gap-2"><Settings2 size={18} className="text-gold-light" /><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-gold-light">For hosts</p></div>
          <h2 className="mt-3 font-display text-[28px] font-semibold">Bring your gathering to Hymnora.</h2>
          <p className="mt-2 text-sm leading-6 text-white/65">Connect an authorized stream, schedule your event and give your community one clear place to find it.</p>
          <Link href="/churches" className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-gold-light hover:text-white">Learn about church spaces <ArrowRight size={15} /></Link>
        </div>
      </section>
    </div>
  );
}

function statusRank(status: string): number {
  return status === "Live now" ? 0 : status === "Starting soon" ? 1 : status === "Upcoming" ? 2 : 3;
}

function statusLabel(status: string): string {
  if (status === "Live now") return "Live";
  if (status === "Starting soon") return "Soon";
  if (status === "Upcoming") return "Later";
  return "Replay";
}