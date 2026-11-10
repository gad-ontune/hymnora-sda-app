"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Captions, Clock3, FileText, Headphones, NotebookPen, Play, Search, Sparkles, Volume2 } from "lucide-react";
import { useMemo, useState, useEffect } from "react";
import { FavoriteButton } from "@/components/favorite-button";
import { PageIntro } from "@/components/page-intro";
import { PlayButton } from "@/components/play-button";
import { SectionHeading } from "@/components/section-heading";
import { FloatingNotes } from "@/components/floating-notes";
import { useHymnora } from "@/components/hymnora-provider";
import { getSermonsData } from "@/lib/data";
import type { Sermon, Track } from "@/lib/types";
import { imgSrc } from "../lib/image";

const topics = ["For you", "Sabbath", "Mission", "Prayer", "Family", "Youth"];

export function SermonExperience() {
  const [topic, setTopic] = useState("For you");
  const [query, setQuery] = useState("");
  const [showTranscript, setShowTranscript] = useState(false);
  const [sermons, setSermons] = useState<Sermon[]>([]);
  const { playTrack, currentTrack, isPlaying, position } = useHymnora();


  useEffect(() => {
    getSermonsData().then(setSermons).catch(() => setSermons([]));
  }, []);

  const visible = useMemo(() => sermons.filter((sermon) => {
    const matchesTopic = topic === "For you"
      || topic === "Family"
      || topic === "Youth"
      || topic === "Sabbath" && sermon.topic.toLowerCase().includes("sabbath")
      || topic === "Mission" && sermon.topic.toLowerCase().includes("calling")
      || topic === "Prayer" && sermon.topic.toLowerCase().includes("faithfulness");
    const matchesQuery = !query.trim() || `${sermon.title} ${sermon.speaker} ${sermon.topic}`.toLowerCase().includes(query.toLowerCase().trim());
    return matchesTopic && matchesQuery;
  }), [query, topic, sermons]);
  const featured = sermons[0];
  const featuredTrack = featured ? toTrack(featured, "video") : null;
  const featuredPlaying = featuredTrack ? currentTrack?.id === featuredTrack.id && isPlaying : false;

  // The pad follows what is being listened to, not the card at the top: a note
  // taken while the fourth sermon plays belongs to the fourth sermon. The
  // featured one is the fallback, so there is always something to write on.
  const listening = sermons.find((sermon) => sermon.id === currentTrack?.id) ?? featured;
  const noteTarget = listening ? { id: String(listening.id), title: String(listening.title) } : null;

  return (
    <div className="fade-up mx-auto max-w-[1440px]">
      <PageIntro eyebrow="Listen deeper" title="Words to carry into the week." description="Sermons, Bible studies and conversations with people who are thinking faithfully about the world around them." action={<Link href="/bible" className="inline-flex h-11 items-center gap-2 rounded-xl border border-line bg-surface px-4 text-sm font-semibold text-ink transition hover:border-gold/60 hover:text-gold"><FileText size={16} /> Browse by Scripture</Link>} />

      <section className="relative mb-9 overflow-hidden rounded-[26px] bg-ink-fill shadow-soft"><div className="grid lg:grid-cols-[1.1fr_0.9fr]"><div className="relative min-h-[330px] overflow-hidden lg:min-h-[400px]"><Image src={featured?.image || "/images/speaker-daniel.jpg"} alt="Pastor Daniel Mwangi" fill priority sizes="(max-width: 1024px) 100vw, 55vw" className="object-cover warm-image" /><div className="absolute inset-0 bg-gradient-to-t from-ink/80 via-transparent to-ink/5" /><div className="absolute bottom-5 left-5 rounded-full border border-white/15 bg-ink-fill/40 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-white/80 backdrop-blur-sm">Featured sermon</div></div><div className="flex flex-col justify-center bg-ink-fill p-6 text-white sm:p-9"><p className="text-[10px] font-bold uppercase tracking-[0.2em] text-gold-light">Anchored in Hope · Episode 04</p><h2 className="mt-3 font-display text-[36px] font-semibold leading-tight tracking-[-0.04em] sm:text-[48px]">{featured?.title}</h2><p className="mt-3 text-sm text-white/60">{featured?.topic} · {featured?.speaker}</p><p className="mt-5 max-w-md text-sm leading-6 text-white/68">A conversation about the Sabbath invitation, the courage to rest and the practices that help a home become a place of peace.</p><div className="mt-7 flex flex-wrap items-center gap-3"><button type="button" onClick={() => featuredTrack && playTrack(featuredTrack)} className="inline-flex h-11 items-center gap-2 rounded-xl bg-gold px-4 text-sm font-bold text-ink transition hover:bg-gold-light">{featuredPlaying ? "Playing now" : "Listen to sermon"}<Play size={15} fill="currentColor" /></button><span className="flex items-center gap-1.5 text-xs text-white/52"><Clock3 size={14} /> 38 min</span><span className="flex items-center gap-1.5 text-xs text-white/52"><Captions size={14} /> Transcript</span></div></div></div></section>

      <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">{topics.map((item) => <button key={item} type="button" onClick={() => setTopic(item)} className={`shrink-0 rounded-full px-4 py-2.5 text-sm font-semibold ${topic === item ? "bg-ink-fill text-white" : "border border-line bg-surface text-ink-muted"}`}>{item}</button>)}</div><label className="relative block sm:w-64"><Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-muted" size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search sermons or speakers" className="h-10 w-full rounded-xl border border-line bg-surface pl-10 pr-3 text-sm outline-none focus:border-gold/60 focus:ring-4 focus:ring-gold/10" /></label></div>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]"><div><SectionHeading title="Sermons worth your time" description={`${visible.length} conversations in this collection`} /><div className="grid gap-4 sm:grid-cols-2">{visible.length ? visible.map((sermon) => <SermonCard key={sermon.id} sermon={sermon} />) : <div className="col-span-full rounded-[22px] border border-dashed border-line bg-surface p-8 text-center text-sm text-ink-muted">No sermons match that search yet.</div>}</div></div><aside className="h-fit rounded-[24px] border border-line bg-surface p-5 shadow-soft sm:p-6"><div className="flex items-center justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-gold">Your notes</p><h2 className="mt-1.5 font-display text-[25px] font-semibold">Keep a thought</h2></div><span className="grid size-10 place-items-center rounded-xl bg-gold-soft text-gold"><NotebookPen size={18} /></span></div><p className="mt-3 text-sm leading-6 text-ink-muted">Save a line, a timestamp or a question while you listen. The pad floats above the page, so you can put it where you are looking.</p><p className="mt-5 rounded-2xl bg-surface-soft p-4 text-sm leading-6 text-ink-soft">{noteTarget ? <>Notes open on <span className="font-semibold text-ink">{noteTarget.title}</span>, and follow whatever you start playing next.</> : "Open a sermon to start a note."}</p><p className="mt-4 text-[12px] leading-5 text-ink-muted">The pad is cropped to a book icon by default on a phone. Drag its title bar to move it, crop it with the ✂ or a double-click on that bar, and tap the icon to bring it back. The ↺ puts it back in the corner.</p></aside></section>

      {noteTarget ? (
        <FloatingNotes
          surface="sermons"
          itemType="sermon"
          itemId={noteTarget.id}
          subject={noteTarget.title}
          reference={currentTrack?.id === noteTarget.id ? `${Math.floor(position / 60)}:${String(Math.floor(position % 60)).padStart(2, "0")}` : null}
          label="Sermon notes"
          timestampSeconds={currentTrack?.id === noteTarget.id ? position : null}
        />
      ) : null}

      <section className="mt-12"><SectionHeading eyebrow="Study with the whole community" title="A passage can open a conversation." description="Search a verse and see the sermons, hymns and songs that have grown around it." /><div className="grid gap-4 md:grid-cols-3"><Link href="/bible" className="rounded-[22px] bg-sage p-5 text-white transition hover:-translate-y-0.5"><span className="grid size-10 place-items-center rounded-xl bg-white/10 text-gold-light"><Sparkles size={19} /></span><h3 className="mt-6 font-display text-[23px] font-semibold">Start with John 3:16</h3><p className="mt-2 text-sm leading-6 text-white/62">Find the conversations, songs and stories connected to a verse.</p><span className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-gold-light">Open the reader <ArrowRight size={15} /></span></Link><Link href="/hymns" className="rounded-[22px] border border-line bg-surface p-5 transition hover:-translate-y-0.5 hover:shadow-soft"><span className="grid size-10 place-items-center rounded-xl bg-gold-soft text-gold"><Headphones size={19} /></span><h3 className="mt-6 font-display text-[23px] font-semibold">Sermon to hymn</h3><p className="mt-2 text-sm leading-6 text-ink-muted">Keep a worship thread going after the last amen.</p><span className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-sage">Find related hymns <ArrowRight size={15} /></span></Link><div className="rounded-[22px] border border-line bg-surface p-5"><span className="grid size-10 place-items-center rounded-xl bg-terracotta-soft text-terracotta"><Volume2 size={19} /></span><h3 className="mt-6 font-display text-[23px] font-semibold">Listen your way</h3><p className="mt-2 text-sm leading-6 text-ink-muted">Audio, video, transcript and captions are always within reach.</p><button type="button" onClick={() => setShowTranscript((current) => !current)} className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-sage">{showTranscript ? "Hide transcript" : "Show transcript"} <ArrowRight size={15} /></button></div></div></section>
    </div>
  );
}

function SermonCard({ sermon }: { sermon: Sermon }) {
  const track = toTrack(sermon, "video");
  return <article className="group overflow-hidden rounded-[22px] border border-line bg-surface shadow-soft"><div className="relative aspect-[1.5] overflow-hidden"><Image src={imgSrc(sermon.image, "/images/speaker-daniel.jpg")} alt="" fill sizes="(max-width: 640px) 100vw, 50vw" className="object-cover warm-image transition duration-500 group-hover:scale-105" /><div className="absolute inset-0 bg-gradient-to-t from-ink/70 to-transparent" /><div className="absolute bottom-3 left-3 right-3 flex items-end justify-between"><span className="rounded-full bg-surface/90 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-ink-soft">{sermon.duration}</span><PlayButton track={track} className="size-10" /></div></div><div className="p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.13em] text-terracotta">{sermon.series}</p><h3 className="mt-1 font-display text-[22px] font-semibold leading-tight">{sermon.title}</h3></div><FavoriteButton id={sermon.id} className="size-9 shrink-0" /></div><p className="mt-2 text-sm text-ink-muted">{sermon.speaker}</p><p className="mt-3 line-clamp-2 text-sm leading-6 text-ink-muted">{sermon.topic} · Explore the transcript, chapters and related Scripture.</p></div></article>;
}

function toTrack(sermon: Sermon, kind: "video" | "audio"): Track {
  return { id: sermon.id, title: sermon.title, artist: sermon.speaker, album: sermon.series, image: sermon.image, duration: sermon.duration, language: sermon.language, kind };
}
