"use client";

import Image from "next/image";
import Link from "next/link";
import { Bell, CalendarDays, Check, ChevronLeft, ChevronRight, Clock3, MapPin, Plus, Sparkles, UsersRound } from "lucide-react";
import { useMemo, useState, useEffect } from "react";
import { PageIntro } from "@/components/page-intro";
import { SectionHeading } from "@/components/section-heading";
import { getEventsData } from "@/lib/data";
import type { EventItem } from "@/lib/types";
import { imgSrc } from "../lib/image";

const filters = ["All gatherings", "This week", "Youth", "Prayer", "Concert", "Online"];

export function EventExperience() {
  const [filter, setFilter] = useState("All gatherings");
  const [saved, setSaved] = useState<string[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [events, setEvents] = useState<EventItem[]>([]);

  useEffect(() => {
    getEventsData().then((data) => setEvents(data));
  }, []);

  // The API sends a day/month label per event, so "this week" and the month
  // grid are both resolved against the real calendar rather than a fixed month.
  // Read the clock once per mount: the calendar and the "this week" filter
  // both need a stable "today" that does not shift on re-render.
  const [today] = useState(() => new Date());

  const weekDays = useMemo(() => {
    const days = new Set<string>();
    for (let offset = 0; offset < 7; offset += 1) {
      days.add(String(new Date(today.getTime() + offset * 86_400_000).getDate()));
    }
    return days;
  }, [today]);

  const eventDays = useMemo(() => new Set(events.map((event) => event.day)), [events]);

  const monthCells = useMemo(() => {
    const now = today;
    const year = now.getFullYear();
    const month = now.getMonth();
    const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7;
    const total = new Date(year, month + 1, 0).getDate();
    const currentDay = now.getDate();
    return {
      label: now.toLocaleDateString("en-GB", { month: "long", year: "numeric" }),
      days: [
        ...Array.from({ length: firstWeekday }, () => null),
        ...Array.from({ length: total }, (_, index) => index + 1),
      ],
      today: currentDay,
    };
  }, [today]);

  const filteredEvents = useMemo(() => {
    if (filter === "All gatherings") return events;
    if (filter === "This week") return events.filter((event) => weekDays.has(event.day));
    if (filter === "Online") return events.filter((event) => event.place.toLowerCase().includes("online"));
    return events.filter((event) => event.category.toLowerCase() === filter.toLowerCase());
  }, [filter, events, weekDays]);
  const visibleEvents = showAll ? filteredEvents : filteredEvents.slice(0, 3);

  function toggleSaved(id: string) {
    setSaved((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  return (
    <div className="fade-up mx-auto max-w-[1440px]">
      <PageIntro eyebrow="Gather together" title="Make a little room for something good." description="Find worship services, conferences, ministry moments and the next gathering your community is looking forward to." action={<button type="button" className="inline-flex h-11 items-center gap-2 rounded-xl bg-ink-fill px-4 text-sm font-bold text-white transition hover:bg-sage"><Plus size={16} className="text-gold-light" /> Add an event</button>} />

      <section className="mb-9 grid gap-5 lg:grid-cols-[minmax(0,1fr)_330px]"><div className="relative min-h-[295px] overflow-hidden rounded-[26px] bg-ink-fill p-6 text-white shadow-soft sm:p-8"><div className="absolute -right-20 -top-20 size-72 rounded-full border border-gold/20" /><div className="absolute right-10 top-10 size-44 rounded-full border border-gold/20" /><div className="relative flex h-full flex-col justify-end"><p className="text-[10px] font-bold uppercase tracking-[0.2em] text-gold-light">A calendar with a heartbeat</p><h2 className="mt-2 max-w-xl font-display text-[37px] font-semibold leading-tight tracking-[-0.04em] sm:text-[49px]">You don&apos;t have to find your people alone.</h2><p className="mt-3 max-w-lg text-sm leading-6 text-white/62">Follow a church, save a gathering and let the right moment find you.</p></div></div><div className="rounded-[26px] border border-line bg-surface p-6 shadow-soft sm:p-8"><div className="flex items-center justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-gold">{monthCells.label}</p><h2 className="mt-1.5 font-display text-[27px] font-semibold">This month</h2></div><div className="flex gap-1"><button type="button" className="grid size-8 place-items-center rounded-lg bg-surface-soft"><ChevronLeft size={15} /></button><button type="button" className="grid size-8 place-items-center rounded-lg bg-surface-soft"><ChevronRight size={15} /></button></div></div><div className="mt-5 grid grid-cols-7 gap-y-2 text-center text-xs"><span className="text-ink-muted">M</span><span className="text-ink-muted">T</span><span className="text-ink-muted">W</span><span className="text-ink-muted">T</span><span className="text-ink-muted">F</span><span className="text-ink-muted">S</span><span className="text-ink-muted">S</span>{monthCells.days.map((day, index) => day === null ? <span key={`pad-${index}`} /> : <button key={day} type="button" className={`relative rounded-lg py-1 text-xs font-semibold ${day === monthCells.today ? "bg-ink-fill text-white" : eventDays.has(String(day)) ? "bg-gold-soft text-gold" : "text-ink-muted hover:bg-surface-soft"}`}>{day}</button>)}</div></div></section>

      <div className="no-scrollbar mb-8 flex gap-2 overflow-x-auto pb-1">{filters.map((item) => <button key={item} type="button" onClick={() => setFilter(item)} className={`shrink-0 rounded-full px-4 py-2.5 text-sm font-semibold ${filter === item ? "bg-ink-fill text-white" : "border border-line bg-surface text-ink-muted"}`}>{item}</button>)}</div>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_310px]"><div><SectionHeading title="Coming up" description="A few good reasons to step away from the ordinary." />{visibleEvents.length ? <div className="space-y-4">{visibleEvents.map((event) => <EventCard key={event.id} event={event} saved={saved.includes(event.id)} onSave={() => toggleSaved(event.id)} />)}</div> : <div className="rounded-[22px] border border-dashed border-line bg-surface p-8 text-center text-sm text-ink-muted">No gatherings match that filter yet.</div>}<button type="button" onClick={() => setShowAll((current) => !current)} className="mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-line bg-surface text-sm font-semibold text-ink-soft transition hover:border-gold/60 hover:text-ink">{showAll ? "Show fewer events" : "See the full calendar"}<ChevronRight size={16} /></button></div><aside className="h-fit rounded-[24px] bg-gold-soft p-5 sm:p-6"><span className="grid size-10 place-items-center rounded-xl bg-gold text-ink"><Bell size={18} /></span><h2 className="mt-5 font-display text-[26px] font-semibold">Never miss the moment.</h2><p className="mt-2 text-sm leading-6 text-ink-soft">Get a gentle reminder when a saved event begins or a followed church goes live.</p><div className="mt-5 space-y-2"><label className="flex items-center justify-between rounded-2xl bg-surface/70 p-3 text-sm font-semibold"><span>1 hour before</span><input type="checkbox" defaultChecked className="accent-[#49624c]" /></label><label className="flex items-center justify-between rounded-2xl bg-surface/70 p-3 text-sm font-semibold"><span>When it goes live</span><input type="checkbox" defaultChecked className="accent-[#49624c]" /></label></div><button type="button" className="mt-5 h-11 w-full rounded-xl bg-ink-fill text-sm font-bold text-white transition hover:bg-sage">Notification settings</button></aside></section>

      <section className="mt-12"><SectionHeading eyebrow="Create your own rhythm" title="There is more than one way to belong." /><div className="grid gap-4 sm:grid-cols-3"><div className="rounded-[22px] border border-line bg-surface p-5"><span className="grid size-10 place-items-center rounded-xl bg-sage-soft text-sage"><UsersRound size={18} /></span><h3 className="mt-5 font-display text-[22px] font-semibold">For families</h3><p className="mt-2 text-sm leading-6 text-ink-muted">Find welcoming activities where every age can take part.</p></div><div className="rounded-[22px] border border-line bg-surface p-5"><span className="grid size-10 place-items-center rounded-xl bg-terracotta-soft text-terracotta"><Sparkles size={18} /></span><h3 className="mt-5 font-display text-[22px] font-semibold">For yourCalling</h3><p className="mt-2 text-sm leading-6 text-ink-muted">Discover gatherings that help you practice faith in the ordinary.</p></div><div className="rounded-[22px] border border-line bg-surface p-5"><span className="grid size-10 place-items-center rounded-xl bg-gold-soft text-gold"><CalendarDays size={18} /></span><h3 className="mt-5 font-display text-[22px] font-semibold">For your calendar</h3><p className="mt-2 text-sm leading-6 text-ink-muted">Save the moments you want to carry with you.</p></div></div></section>
    </div>
  );
}

function EventCard({ event, saved, onSave }: { event: EventItem; saved: boolean; onSave: () => void }) {
  return <article className="group flex flex-col gap-4 rounded-[22px] border border-line bg-surface p-4 shadow-soft transition hover:-translate-y-0.5 sm:flex-row sm:items-center sm:p-5"><div className="relative h-36 overflow-hidden rounded-2xl sm:h-28 sm:w-40 sm:shrink-0"><Image src={imgSrc(event.image, "/images/community.jpg")} alt="" fill sizes="(max-width: 640px) 100vw, 160px" className="object-cover warm-image transition duration-500 group-hover:scale-105" /><div className="absolute left-2 top-2 rounded-lg bg-surface/90 px-2 py-1 text-center"><span className="block font-display text-lg font-semibold leading-none text-ink">{event.day}</span><span className="block text-[9px] font-bold tracking-[0.12em] text-terracotta">{event.month}</span></div></div><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="text-[10px] font-bold uppercase tracking-[0.14em] text-sage">{event.category}</span>{event.live ? <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.1em] text-terracotta"><span className="size-1.5 rounded-full bg-terracotta" /> Live</span> : null}</div><h3 className="mt-1 font-display text-[22px] font-semibold tracking-[-0.02em]">{event.title}</h3><div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted"><span className="flex items-center gap-1"><Clock3 size={13} /> {event.time}</span><span className="flex items-center gap-1"><MapPin size={13} /> {event.place}</span></div></div><div className="flex shrink-0 gap-2 sm:flex-col"><button type="button" onClick={onSave} className={`grid size-10 place-items-center rounded-xl border transition ${saved ? "border-sage bg-sage-soft text-sage" : "border-line text-ink-muted hover:border-sage hover:text-sage"}`} aria-label={saved ? "Remove reminder" : "Save event"}>{saved ? <Check size={17} /> : <CalendarDays size={17} />}</button><Link href="/live" className="grid size-10 place-items-center rounded-xl bg-ink-fill text-white transition hover:bg-sage" aria-label="View event"><ChevronRight size={16} /></Link></div></article>;
}
