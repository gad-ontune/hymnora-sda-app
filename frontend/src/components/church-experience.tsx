"use client";

import Image from "next/image";
import Link from "next/link";
import {
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Globe2,
  Locate,
  Loader2,
  MapPin,
  Navigation,
  Phone,
  Radio,
  RotateCcw,
  Search,
  TriangleAlert,
  UsersRound,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { SectionHeading } from "@/components/section-heading";
import {
  getChurchesData,
  getNearbyChurchesData,
  getChurchDetailData,
  getLiveChurchesData,
  getEventsData,
} from "@/lib/data";
import { ChurchMap, ChurchMapFullscreen, FALLBACK_CENTRE } from "@/components/map/ChurchMap";
import { DEFAULT_RADIUS_KM, RADIUS_CHOICES, type LatLng, type RadiusKm } from "@/lib/geo";
import type { Church, ChurchDetail, EventItem, ServiceTime } from "@/lib/types";
import { imgSrc } from "../lib/image";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** True for events starting inside the next seven days — the "this week" count. */
function isThisWeek(startsAt: string | undefined, now: number): boolean {
  if (!startsAt) return false;
  const at = Date.parse(startsAt);
  if (!Number.isFinite(at)) return false;
  // Anything already started counts too: a service in progress is exactly what
  // "live this week" is asking about.
  return at >= now - WEEK_MS && at <= now + WEEK_MS;
}

/**
 * The API sends service times either as a bare label ("Sabbath 09:00") or as a
 * structured slot `{day, name, time}`; both reach the UI, so the label is
 * flattened here instead of letting an object leak into a React child.
 */
function serviceTimeLabel(slot: string | ServiceTime | undefined): string | null {
  if (!slot) return null;
  if (typeof slot === "string") return slot;
  return [slot.day, slot.time].filter(Boolean).join(" · ") || slot.name;
}

/**
 * The directory payload has no region column; its `location` field is
 * "Town, Country". The first part is the area a reader recognises, so the
 * region chips are derived from the data already fetched rather than adding a
 * second request.
 */
function regionOf(church: Church): string {
  return church.location.split(",")[0]?.trim() || "Unlisted";
}

/** Stable empty reference so memoized filters do not churn before data arrives. */
const NO_CHURCHES: Church[] = [];

export function ChurchExperience() {
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"list" | "map">("map");
  const [radiusKm, setRadiusKm] = useState<RadiusKm>(DEFAULT_RADIUS_KM);
  const [region, setRegion] = useState("all");
  const [reloadKey, setReloadKey] = useState(0);
  /**
   * Results carry the key of the attempt that produced them. Loading and error
   * are then derived while rendering, so no effect has to reset a flag before
   * a request starts (which would cause a cascading render).
   */
  const [directoryResult, setDirectoryResult] = useState<{ key: number; items: Church[]; error: boolean } | null>(null);

  /** The centre the search runs from: the reader's position once shared. */
  const [myLocation, setMyLocation] = useState<LatLng | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  const [nearbyResult, setNearbyResult] = useState<{ key: string; found: Church[]; error: boolean } | null>(null);
  const [nearbyRetry, setNearbyRetry] = useState(0);
  const [liveChurches, setLiveChurches] = useState<Church[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [selected, setSelected] = useState<Church | null>(null);
  const [detailResult, setDetailResult] = useState<{ id: string; record: ChurchDetail | null } | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  // A seven-day window measured from mount does not need sub-minute accuracy,
  // and capturing it once keeps render pure.
  const [now] = useState(() => Date.now());

  const centre = myLocation ?? FALLBACK_CENTRE;
  const allChurches = directoryResult?.items ?? NO_CHURCHES;
  const directoryLoading = directoryResult?.key !== reloadKey;
  const directoryError = directoryResult?.key === reloadKey && directoryResult.error;

  useEffect(() => {
    let cancelled = false;
    getChurchesData()
      .then((items) => {
        if (cancelled) return;
        setDirectoryResult({ key: reloadKey, items, error: false });
      })
      .catch(() => {
        if (cancelled) return;
        setDirectoryResult({ key: reloadKey, items: [], error: true });
      });
    getLiveChurchesData()
      .then((items) => {
        if (!cancelled) setLiveChurches(items);
      })
      .catch(() => {
        if (!cancelled) setLiveChurches([]);
      });
    getEventsData()
      .then((items) => {
        if (!cancelled) setEvents(items);
      })
      .catch(() => {
        if (!cancelled) setEvents([]);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  /**
   * The radius search, re-run whenever the range or the position changes.
   *
   * The results carry the key they were fetched for, so "loading" is simply
   * "the list on screen is for a different search". Storing the whole list and
   * the query key together keeps render pure: there is no setState before the
   * fetch resolves, and a failed fetch resolves to an empty list for that key.
   */
  const nearbyKey = myLocation ? `${myLocation.lat}:${myLocation.lng}:${radiusKm}` : null;
  // Including the retry in the key makes a retry visibly "in flight" again.
  const searchKey = nearbyKey ? `${nearbyKey}:${nearbyRetry}` : null;

  useEffect(() => {
    if (!myLocation || !nearbyKey || !searchKey) return;
    let cancelled = false;
    getNearbyChurchesData(myLocation.lat, myLocation.lng, radiusKm)
      .then((found) => {
        if (cancelled) return;
        setNearbyResult({ key: searchKey, found, error: false });
        // Keep a selection across range changes: widening should not silently
        // throw away the church somebody had open.
        setSelected((current) => (current && found.some((c) => c.id === current.id) ? current : found[0] ?? null));
      })
      .catch(() => {
        if (cancelled) return;
        setNearbyResult({ key: searchKey, found: [], error: true });
      });
    return () => {
      cancelled = true;
    };
  }, [myLocation, radiusKm, nearbyKey, searchKey]);

  // While a new search is in flight the previous list stays on screen, dimmed,
  // rather than collapsing to nothing. Memoized so the reference is stable for
  // the `shown` filter below.
  const nearby = useMemo(() => (nearbyKey ? (nearbyResult?.found ?? []) : []), [nearbyKey, nearbyResult]);
  const loading = Boolean(searchKey) && nearbyResult?.key !== searchKey;
  const nearbyFailed = Boolean(searchKey) && nearbyResult?.key === searchKey && nearbyResult.error;

  const regions = useMemo(() => {
    const labels = new Set(allChurches.map(regionOf).filter((label) => label !== "Unlisted"));
    return ["all", ...Array.from(labels).sort((a, b) => a.localeCompare(b))];
  }, [allChurches]);

  /** The churches the map is plotting and the card is listing. */
  const shown = useMemo(() => {
    const base = myLocation ? nearby : allChurches;
    const inRegion = region === "all" ? base : base.filter((church) => regionOf(church) === region);
    const normalized = query.trim().toLowerCase();
    if (!normalized) return inRegion;
    return inRegion.filter((church) =>
      `${church.name} ${church.location} ${church.service}`.toLowerCase().includes(normalized),
    );
  }, [allChurches, myLocation, nearby, query, region]);

  const activeChurch = useMemo(
    () => shown.find((church) => church.id === selected?.id) ?? shown[0] ?? null,
    [selected, shown],
  );

  // The record behind the selected church, for the members tag and the next
  // service. Fetched per selection rather than for every church in the list.
  // The record is stored alongside the id it belongs to, so the panel blanks
  // itself the moment the selection moves — no effect has to clear it.
  const activeChurchId = activeChurch?.id;

  useEffect(() => {
    if (!activeChurchId) return;
    let cancelled = false;
    getChurchDetailData(activeChurchId)
      .then((record) => {
        if (!cancelled) setDetailResult({ id: activeChurchId, record });
      })
      .catch(() => {
        if (!cancelled) setDetailResult({ id: activeChurchId, record: null });
      });
    return () => {
      cancelled = true;
    };
  }, [activeChurchId]);

  const detail = activeChurchId && detailResult?.id === activeChurchId ? detailResult.record : null;

  const requestMyLocation = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setLocationError("This browser cannot share a location.");
      return;
    }
    setLocating(true);
    setLocationError(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setMyLocation({ lat: position.coords.latitude, lng: position.coords.longitude });
        setLocating(false);
        setView("map");
      },
      (error) => {
        setLocating(false);
        setLocationError(
          error.code === error.PERMISSION_DENIED
            ? "Location permission was declined. You can still browse by city."
            : "Your location could not be read. Try again in a moment.",
        );
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  }, []);

  const liveThisWeek = useMemo(
    () => events.filter((event) => event.live || isThisWeek(event.startsAt, now)).length,
    [events, now],
  );

  const newActivities = useMemo(() => events.filter((event) => isThisWeek(event.startsAt, now)).length, [events, now]);
  const upcomingEvents = useMemo(() => events.filter((event) => isThisWeek(event.startsAt, now)).slice(0, 3), [events, now]);

  return (
    <div className="fade-up mx-auto max-w-[1440px]">
      {/*
        The green card is the whole header now. The page intro above it said the
        same thing in more words — "a church is a place to belong" and "there is
        a place for you to worship" — so one of them was always going to win, and
        the map is the part worth the space.
      */}
      <section className="relative mb-8 overflow-hidden rounded-[26px] bg-sage p-6 text-white shadow-soft sm:p-8">
        <div className="absolute -bottom-28 -right-14 size-80 rounded-full border border-white/10" />
        <div className="absolute -bottom-14 -right-2 size-52 rounded-full border border-white/10" />
        <div className="relative">
          <div className="grid gap-7 lg:grid-cols-[1fr_auto] lg:items-center">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-gold-light">Your SDA community map</p>
              <h1 className="mt-2 max-w-xl font-display text-[32px] font-semibold leading-tight tracking-[-0.04em] sm:text-[42px]">
                There is a place for you to worship.
              </h1>
              <p className="mt-3 max-w-lg text-sm leading-6 text-white/65">
                {myLocation
                  ? `Showing verified churches within ${radiusKm} km of you. Widen the range to see more.`
                  : "Share your location and we will find the churches, ministries and gatherings closest to you."}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={requestMyLocation}
                disabled={locating}
                className="inline-flex h-11 items-center gap-2 rounded-xl bg-ink-fill px-4 text-sm font-bold text-white transition hover:bg-gold disabled:opacity-70"
              >
                {locating ? <Loader2 size={16} className="animate-spin text-gold-light" /> : <Navigation size={16} className="text-gold-light" />}
                {locating ? "Locating…" : myLocation ? "Update my location" : "Use my location"}
              </button>
              {myLocation ? (
                <button
                  type="button"
                  onClick={() => {
                    setMyLocation(null);
                    setSelected(null);
                  }}
                  className="inline-flex h-11 items-center gap-2 rounded-xl border border-white/25 px-4 text-sm font-semibold text-white/85 transition hover:bg-white/10"
                >
                  Clear
                </button>
              ) : null}
            </div>
          </div>

          {/* Three real numbers: the radius result, the live flag, the calendar. */}
          <div className="mt-7 grid grid-cols-3 gap-2 sm:gap-3">
            <Metric
              value={myLocation ? String(shown.length) : directoryLoading || directoryError ? "—" : String(allChurches.length)}
              label={myLocation ? `Within ${radiusKm} km` : "Churches listed"}
            />
            <Metric value={String(liveChurches.length || liveThisWeek)} label="Live this week" />
            <Metric value={String(newActivities)} label="New activities" />
          </div>

          {locationError ? (
            <p className="mt-4 rounded-xl border border-white/20 bg-ink-fill/25 px-4 py-2.5 text-xs font-medium text-white/90">
              {locationError}
            </p>
          ) : null}
        </div>
      </section>

      {/* The slider steps through exactly the radii the nearby API accepts. */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-ink-muted">Within</span>
            <input
              type="range"
              min={RADIUS_CHOICES[0]}
              max={RADIUS_CHOICES[RADIUS_CHOICES.length - 1]}
              step={1}
              value={radiusKm}
              onChange={(event) => {
                const next = RADIUS_CHOICES.find((km) => km === Number(event.target.value));
                if (next !== undefined) setRadiusKm(next);
              }}
              aria-label="Search radius in kilometres"
              className="h-1.5 w-36 cursor-pointer appearance-none rounded-full bg-surface-soft accent-sage sm:w-44"
            />
            <span className="w-12 text-sm font-bold tabular-nums text-ink">{radiusKm} km</span>
            {!myLocation ? (
              <span className="text-xs text-ink-muted">Share a location to search by distance.</span>
            ) : null}
          </div>
          <div className="mt-1.5 flex gap-5 pl-[3.7rem] text-[10px] font-semibold text-ink-muted">
            {RADIUS_CHOICES.map((km) => (
              <span key={km}>{km} km</span>
            ))}
          </div>
        </div>

        <label className="relative block sm:w-72">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-muted" size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search a church or city"
            className="h-10 w-full rounded-xl border border-line bg-surface pl-10 pr-3 text-sm outline-none focus:border-gold/60 focus:ring-4 focus:ring-gold/10"
          />
        </label>
      </div>

      {/* Area chips are derived from the directory itself, so they stay honest. */}
      <div className="mb-5 flex flex-wrap items-center gap-2" role="group" aria-label="Filter by region">
        <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-ink-muted">Region</span>
        {regions.map((label) => {
          const active = region === label;
          return (
            <button
              key={label}
              type="button"
              aria-pressed={active}
              onClick={() => setRegion(label)}
              className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                active
                  ? "bg-sage text-white shadow-soft"
                  : "border border-line bg-surface text-ink-muted hover:border-sage/50 hover:text-ink"
              }`}
            >
              {label === "all" ? "All regions" : label}
            </button>
          );
        })}
      </div>

      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-gold">
            {myLocation ? `Within ${radiusKm} km of you` : "Browse the directory"}
          </p>
          <h2 className="mt-1 font-display text-[27px] font-semibold tracking-[-0.03em]">Churches to explore</h2>
        </div>
        <div className="flex rounded-xl border border-line bg-surface p-1">
          <button
            type="button"
            onClick={() => setView("list")}
            className={`rounded-lg px-3 py-2 text-xs font-semibold ${view === "list" ? "bg-ink-fill text-white" : "text-ink-muted"}`}
          >
            List
          </button>
          <button
            type="button"
            onClick={() => setView("map")}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold ${view === "map" ? "bg-ink-fill text-white" : "text-ink-muted"}`}
          >
            <MapPin size={14} /> Map
          </button>
        </div>
      </div>

      <section
        className={`grid gap-5 ${view === "map" ? "xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.72fr)]" : "xl:grid-cols-1"}`}
      >
        <div className="min-w-0">
          {view === "map" && !fullscreen ? (
            <ChurchMap
              churches={shown}
              centre={centre}
              radiusKm={radiusKm}
              myLocation={myLocation}
              selectedChurch={activeChurch}
              onSelectChurch={setSelected}
              onOpenFullscreen={() => setFullscreen(true)}
            />
          ) : null}

          <div className={view === "map" ? "mt-4 space-y-3" : "space-y-3"}>
            {nearbyFailed && myLocation ? (
              <NoticeCard
                icon="error"
                title="Nearby search unavailable"
                message="We could not check churches around you just now. Your location is still saved — try the search again."
                actionLabel="Try again"
                onAction={() => setNearbyRetry((value) => value + 1)}
              />
            ) : loading && myLocation ? (
              <NoticeCard
                loading
                title="Looking nearby…"
                message={`Checking churches within ${radiusKm} km of you.`}
              />
            ) : directoryLoading && !myLocation ? (
              <div className="space-y-3" aria-label="Loading churches" aria-busy="true">
                {[0, 1, 2].map((index) => (
                  <div key={index} className="flex animate-pulse gap-4 rounded-[22px] border border-line bg-surface p-5">
                    <div className="size-24 shrink-0 rounded-2xl bg-surface-soft" />
                    <div className="flex-1 space-y-3 py-1">
                      <div className="h-4 w-2/3 rounded bg-surface-soft" />
                      <div className="h-3 w-1/2 rounded bg-surface-soft" />
                      <div className="h-3 w-1/3 rounded bg-surface-soft" />
                    </div>
                  </div>
                ))}
              </div>
            ) : directoryError && !myLocation ? (
              <NoticeCard
                icon="error"
                title="The directory did not load"
                message="The church list could not be read. Nothing else on the page has changed — please try once more."
                actionLabel="Try again"
                onAction={() => setReloadKey((value) => value + 1)}
              />
            ) : shown.length ? (
              shown.map((church) => (
                <ChurchCard
                  key={church.id}
                  church={church}
                  selected={activeChurch?.id === church.id}
                  onSelect={() => setSelected(church)}
                />
              ))
            ) : (
              <NoticeCard
                icon="empty"
                title={myLocation ? "No churches in range" : region !== "all" ? `No churches in ${region}` : "No churches match that search"}
                message={
                  myLocation
                    ? `No verified church within ${radiusKm} km of you. Try a wider range or clear your filters.`
                    : "Try another region or a shorter search term."
                }
              />
            )}
          </div>
        </div>

        <aside className="h-fit overflow-hidden rounded-[24px] border border-line bg-surface shadow-soft">
          {activeChurch ? (
            <>
              <div className="relative h-44 overflow-hidden bg-surface-soft sm:h-52">
                <Image
                  src={imgSrc(activeChurch.image, "/images/church.jpg")}
                  alt=""
                  fill
                  priority
                  sizes="(max-width: 1280px) 100vw, 40vw"
                  className="object-cover warm-image"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-ink/70 to-transparent" />
                {activeChurch.status === "Live now" ? (
                  <span className="absolute left-4 top-4 flex items-center gap-1.5 rounded-full bg-terracotta px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.08em] text-white">
                    <span className="size-1.5 rounded-full bg-white" /> Live now
                  </span>
                ) : null}
                <h3 className="absolute bottom-4 left-4 right-4 font-display text-[24px] font-semibold leading-tight text-white">
                  {activeChurch.name}
                </h3>
              </div>

              <div className="p-5 sm:p-6">
                <p className="flex items-center gap-1.5 text-sm text-ink-muted">
                  <MapPin size={14} className="text-sage" /> {activeChurch.location}
                </p>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {/* The membership tag, only when the church has recorded one. */}
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-sage-soft px-3 py-1.5 text-[11px] font-semibold text-sage">
                    <UsersRound size={13} />
                    {detail?.members ? `${detail.members.toLocaleString("en-US")} members` : "Members not listed"}
                  </span>
                  {detail?.verified ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-gold-soft px-3 py-1.5 text-[11px] font-semibold text-gold">
                      <CheckCircle2 size={13} /> Verified
                    </span>
                  ) : null}
                  {myLocation ? (
                    <span className="rounded-full bg-surface-soft px-3 py-1.5 text-[11px] font-semibold text-ink-soft">
                      {activeChurch.distance}
                    </span>
                  ) : null}
                </div>

                {/* Where and when the next service is. */}
                <div className="mt-5 rounded-2xl bg-surface-soft p-4">
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-gold">Next service</p>
                  <p className="mt-1.5 text-sm font-semibold text-ink">
                    {detail?.upcomingEvents?.[0]
                      ? `${detail.upcomingEvents[0].time} · ${detail.upcomingEvents[0].title}`
                      : (serviceTimeLabel(detail?.serviceTimes?.[0]) ?? activeChurch.service)}
                  </p>
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-ink-muted">
                    <MapPin size={12} />
                    {detail?.address || detail?.city || activeChurch.location}
                  </p>
                </div>

                <div className="mt-5 grid grid-cols-2 gap-2.5">
                  {detail?.phone ? (
                    <a
                      href={`tel:${detail.phone}`}
                      className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-line bg-canvas text-sm font-semibold text-ink transition hover:border-sage/50"
                    >
                      <Phone size={15} /> Call
                    </a>
                  ) : null}
                  {detail?.website ? (
                    <a
                      href={detail.website}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-line bg-canvas text-sm font-semibold text-ink transition hover:border-sage/50"
                    >
                      <Globe2 size={15} /> Website
                    </a>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setFullscreen(true)}
                    className="col-span-2 inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-ink-fill text-sm font-bold text-white transition hover:bg-sage"
                  >
                    <MapPin size={15} /> Open full map
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="p-8 text-center text-sm text-ink-muted">
              <Locate size={22} className="mx-auto mb-3 text-sage" />
              Share your location to find the churches nearest you.
            </div>
          )}
        </aside>
      </section>

      <section className="mt-12">
        <SectionHeading
          eyebrow="Around the network"
          title="Gatherings worth knowing about."
          description="Live worship and the next seven days of activities, drawn from the same directory."
        />
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-[24px] border border-line bg-surface p-5 shadow-soft sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-terracotta">Live this week</p>
                <h3 className="mt-1 font-display text-xl font-semibold tracking-[-0.02em] text-ink">
                  Where worship is gathering
                </h3>
              </div>
              <span className="rounded-full bg-terracotta-soft px-3 py-1.5 text-xs font-bold text-terracotta">
                {liveChurches.length || liveThisWeek}
              </span>
            </div>
            {liveChurches.length ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {liveChurches.slice(0, 6).map((church) => (
                  <button
                    key={church.id}
                    type="button"
                    onClick={() => {
                      setRegion("all");
                      setQuery("");
                      setSelected(church);
                      setView("map");
                    }}
                    className="inline-flex items-center gap-1.5 rounded-full border border-line bg-canvas px-3 py-2 text-xs font-semibold text-ink transition hover:border-terracotta/50"
                  >
                    <span className="size-1.5 rounded-full bg-terracotta" /> {church.name}
                  </button>
                ))}
              </div>
            ) : (
              <p className="mt-4 rounded-2xl bg-surface-soft p-4 text-sm leading-6 text-ink-muted">
                No church is streaming right now. Each church card still shows its next service.
              </p>
            )}
          </div>

          <div className="rounded-[24px] border border-line bg-surface p-5 shadow-soft sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-gold">Next seven days</p>
                <h3 className="mt-1 font-display text-xl font-semibold tracking-[-0.02em] text-ink">
                  Upcoming activities
                </h3>
              </div>
              <span className="rounded-full bg-gold-soft px-3 py-1.5 text-xs font-bold text-gold">
                {upcomingEvents.length}
              </span>
            </div>
            {upcomingEvents.length ? (
              <ul className="mt-4 divide-y divide-line">
                {upcomingEvents.map((event) => (
                  <li key={event.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                    <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-gold-soft text-center leading-none text-gold">
                      <span className="text-sm font-bold">{event.day}</span>
                      <span className="text-[9px] font-bold uppercase">{event.month}</span>
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-ink">{event.title}</p>
                      <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-ink-muted">
                        <MapPin size={11} /> {event.place}
                      </p>
                    </div>
                    <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-ink-muted">
                      <Clock3 size={12} /> {event.time}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-4 rounded-2xl bg-surface-soft p-4 text-sm leading-6 text-ink-muted">
                No activities are scheduled in the next seven days. Check back as churches add gatherings.
              </p>
            )}
          </div>
        </div>
      </section>

      <section className="mt-12">
        <SectionHeading
          eyebrow="The bigger picture"
          title="A global family, locally present."
          description="Explore the organizations, ministries and conferences that make this community connected."
        />
        <div className="grid gap-4 sm:grid-cols-3">
          <Link href="/churches" className="rounded-[22px] border border-line bg-surface p-5 transition hover:-translate-y-0.5 hover:shadow-soft">
            <span className="grid size-10 place-items-center rounded-xl bg-sage-soft text-sage"><Globe2 size={18} /></span>
            <h3 className="mt-5 font-display text-[22px] font-semibold">World directory</h3>
            <p className="mt-2 text-sm leading-6 text-ink-muted">Browse churches by country, region and city as the map grows.</p>
          </Link>
          <Link href="/events" className="rounded-[22px] border border-line bg-surface p-5 transition hover:-translate-y-0.5 hover:shadow-soft">
            <span className="grid size-10 place-items-center rounded-xl bg-gold-soft text-gold"><CalendarDays size={18} /></span>
            <h3 className="mt-5 font-display text-[22px] font-semibold">Activities near you</h3>
            <p className="mt-2 text-sm leading-6 text-ink-muted">Find worship, service, study and the next good gathering.</p>
          </Link>
          <Link href="/live" className="rounded-[22px] border border-line bg-surface p-5 transition hover:-translate-y-0.5 hover:shadow-soft">
            <span className="grid size-10 place-items-center rounded-xl bg-terracotta-soft text-terracotta"><Radio size={18} /></span>
            <h3 className="mt-5 font-display text-[22px] font-semibold">Live right now</h3>
            <p className="mt-2 text-sm leading-6 text-ink-muted">See where communities are gathering across the network.</p>
          </Link>
        </div>
      </section>

      {fullscreen ? (
        <ChurchMapFullscreen
          churches={shown}
          centre={centre}
          radiusKm={radiusKm}
          myLocation={myLocation}
          selectedChurch={activeChurch}
          onSelectChurch={setSelected}
          onBack={() => setFullscreen(false)}
        />
      ) : null}
    </div>
  );
}

function ChurchCard({ church, selected, onSelect }: { church: Church; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full items-center gap-4 rounded-[22px] border bg-surface p-4 text-left shadow-soft transition hover:-translate-y-0.5 sm:p-5 ${
        selected ? "border-sage ring-2 ring-sage/15" : "border-line"
      }`}
    >
      <div className="relative size-24 shrink-0 overflow-hidden rounded-2xl sm:size-28">
        <Image src={imgSrc(church.image, "/images/church.jpg")} alt="" fill sizes="112px" className="object-cover warm-image" />
        {church.status === "Live now" ? (
          <span className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-terracotta px-2 py-1 text-[9px] font-bold uppercase tracking-[0.08em] text-white">
            <span className="size-1.5 rounded-full bg-white" /> Live
          </span>
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {church.distance !== "—" ? (
            <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-sage">{church.distance}</span>
          ) : null}
          {church.status === "Verified" ? (
            <span className="flex items-center gap-1 text-[10px] font-semibold text-sage"><CheckCircle2 size={12} /> Verified</span>
          ) : null}
        </div>
        <h3 className="mt-1 truncate font-display text-[21px] font-semibold tracking-[-0.02em] sm:text-[23px]">{church.name}</h3>
        <p className="mt-1 flex items-center gap-1 text-sm text-ink-muted"><MapPin size={13} /> {church.location}</p>
        <p className="mt-2 flex items-center gap-1 text-xs text-ink-muted"><CalendarDays size={13} /> {church.service}</p>
      </div>
      <ChevronRight size={19} className="shrink-0 text-ink-muted" />
    </button>
  );
}

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.07] p-3.5 sm:p-4">
      <p className="font-display text-[27px] font-semibold text-gold-light">{value}</p>
      <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.12em] text-white/52">{label}</p>
    </div>
  );
}

/** One calm card for the list's loading, empty and failed states. */
function NoticeCard({
  icon = "empty",
  loading = false,
  title,
  message,
  actionLabel,
  onAction,
}: {
  icon?: "empty" | "error";
  loading?: boolean;
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="rounded-[22px] border border-dashed border-line bg-surface p-8 text-center">
      <span
        className={`mx-auto grid size-11 place-items-center rounded-xl ${
          icon === "error" ? "bg-terracotta-soft text-terracotta" : "bg-sage-soft text-sage"
        }`}
      >
        {loading ? <Loader2 size={18} className="animate-spin" /> : icon === "error" ? <TriangleAlert size={18} /> : <Locate size={18} />}
      </span>
      <p className="mt-3 font-display text-lg font-semibold text-ink">{title}</p>
      <p className="mx-auto mt-1 max-w-sm text-sm leading-6 text-ink-muted">{message}</p>
      {actionLabel && onAction ? (
        <button
          type="button"
          onClick={onAction}
          className="mt-4 inline-flex h-10 items-center gap-2 rounded-xl border border-line bg-canvas px-4 text-xs font-bold text-ink transition hover:border-sage/50"
        >
          <RotateCcw size={14} /> {actionLabel}
        </button>
      ) : null}
    </div>
  );
}
