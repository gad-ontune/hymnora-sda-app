"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type SyntheticEvent,
} from "react";
import {
  ArrowLeft, CalendarClock, Check, Clock3, Film, Image as ImageIcon, Info,
  Link2, Pause, Play, Plus, Scissors, Sparkles, Trash2, Upload,
} from "lucide-react";
import type { ReelCategory } from "@/lib/types";

/**
 * Reel Studio — a local editing room, not a pretend upload.
 *
 * There is no user-upload endpoint yet, so drafts are metadata in localStorage:
 * settings, a small canvas-sampled cover frame, and — for YouTube links — the
 * share id. The video file itself deliberately stays on the device that picked
 * it; writing a 400 MB blob into localStorage would be worse than useless.
 */

const STORAGE_KEY = "hymnora.reelStudio.drafts.v1";
const MAX_SECONDS = 240;
const MAX_FILE_BYTES = 500 * 1024 * 1024;
const MAX_DRAFTS = 12;

type Audience = "public" | "followers" | "private";
type Mode = "clip" | "youtube";
type Look = { id: string; name: string; css: string; hint: string };
type CoverFrame = { time: number; url: string };

type Draft = {
  id: string;
  kind: Mode;
  title: string;
  caption: string;
  category: string;
  audience: Audience;
  scheduledFor: string;
  createdAt: string;
  filterId: string;
  start: number;
  end: number;
  coverTime: number;
  coverUrl: string | null;
  fileName: string | null;
  videoId: string | null;
  duration: number;
};

const LOOKS: Look[] = [
  { id: "none", name: "None", css: "none", hint: "Your footage, unchanged." },
  { id: "golden-hour", name: "Golden Hour", css: "sepia(.28) saturate(1.25) brightness(1.06) contrast(1.04)", hint: "Warm amber light for testimony and praise." },
  { id: "emmanuel", name: "Emmanuel", css: "sepia(.18) saturate(1.1) contrast(1.12) brightness(1.02)", hint: "A gentle, devotional warmth." },
  { id: "sunday-light", name: "Sunday Light", css: "brightness(1.12) saturate(1.08) contrast(.96)", hint: "Soft, open highlights for sanctuary footage." },
  { id: "choir-warm", name: "Choir Warm", css: "sepia(.38) saturate(1.15) hue-rotate(-6deg) contrast(1.06)", hint: "Wood and voices, turned up a little." },
  { id: "cool-dusk", name: "Cool Dusk", css: "saturate(.85) hue-rotate(12deg) brightness(.9) contrast(1.15)", hint: "Blue hour for evening worship." },
  { id: "grain-grace", name: "Grain & Grace", css: "contrast(1.16) saturate(.82) sepia(.15) brightness(.97)", hint: "Film-like contrast with quiet colour." },
  { id: "mono", name: "Mono", css: "grayscale(1) contrast(1.14) brightness(1.03)", hint: "Nothing between the face and the words." },
  { id: "sepia-archive", name: "Sepia Archive", css: "sepia(.8) contrast(1.1) brightness(1.02) saturate(.8)", hint: "A kept photograph, brought forward." },
  { id: "vivid", name: "Vivid", css: "saturate(1.45) contrast(1.1) brightness(1.04)", hint: "For colour that should sing." },
  { id: "candlelit", name: "Candlelit", css: "sepia(.3) brightness(.92) contrast(1.18) saturate(1.1)", hint: "Low, close and reverent." },
];

const AUDIENCES: { id: Audience; label: string; hint: string }[] = [
  { id: "public", label: "Everyone", hint: "For anyone who finds the reel" },
  { id: "followers", label: "Followers", hint: "For people who follow you" },
  { id: "private", label: "Only me", hint: "A private draft" },
];

/** Used only when the facets endpoint is unavailable. */
const FALLBACK_CATEGORIES: ReelCategory[] = [
  { id: "worship", label: "Worship", description: "Praise and divine service", position: 1 },
  { id: "choirs", label: "Choirs", description: "Choral song", position: 2 },
  { id: "mission", label: "Mission", description: "Outreach and evangelism", position: 3 },
  { id: "youth", label: "Youth", description: "Young people and Pathfinders", position: 4 },
  { id: "bible", label: "Bible", description: "Scripture and study", position: 5 },
  { id: "testimonies", label: "Testimonies", description: "What God has done", position: 6 },
  { id: "sermons", label: "Sermons", description: "Preaching and teaching", position: 7 },
  { id: "church-life", label: "Church life", description: "The week around the church", position: 8 },
  { id: "hymns", label: "Hymns", description: "The hymnal and nyimbo", position: 9 },
  { id: "community", label: "Community", description: "People and work together", position: 10 },
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function roundTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

function formatTime(value: number): string {
  const total = Math.max(0, Math.round(Number.isFinite(value) ? value : 0));
  return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, "0")}`;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function formatSaved(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Saved locally";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function normalizeWindow(nextStart: number, nextEnd: number, max: number): { start: number; end: number } {
  const upper = Math.max(0, Number.isFinite(max) ? max : 0);
  if (upper === 0) return { start: 0, end: 0 };
  let start = clamp(Number.isFinite(nextStart) ? nextStart : 0, 0, upper);
  let end = clamp(Number.isFinite(nextEnd) ? nextEnd : upper, 0, upper);
  if (end - start > MAX_SECONDS) end = Math.min(upper, start + MAX_SECONDS);
  if (end - start < 0.5) {
    if (start + 0.5 <= upper) end = start + 0.5;
    else {
      start = Math.max(0, end - 0.5);
      end = Math.min(upper, start + 0.5);
    }
  }
  return { start: roundTenth(start), end: roundTenth(end) };
}

function parseYouTubeId(input: string): string | null {
  const trimmed = input.trim();
  if (/^[\w-]{11}$/.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    let id: string | null = null;
    if (host === "youtu.be" || host === "y2u.be") {
      id = url.pathname.split("/").filter(Boolean)[0] ?? null;
    } else if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
      if (url.pathname.startsWith("/watch")) id = url.searchParams.get("v");
      else {
        const parts = url.pathname.split("/").filter(Boolean);
        if (parts[0] === "embed" || parts[0] === "shorts" || parts[0] === "live") id = parts[1] ?? null;
      }
    }
    return id && /^[\w-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

function scheduleIssue(value: string): string | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return "That schedule time is not valid.";
  if (time <= Date.now() - 60_000) return "Choose a schedule time in the future.";
  return null;
}

function makeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function readNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readAudience(value: unknown): Audience {
  return value === "followers" || value === "private" ? value : "public";
}

function parseDraft(value: unknown): Draft | null {
  if (!isRecord(value)) return null;
  if (value.kind !== "clip" && value.kind !== "youtube") return null;
  const start = Math.max(0, readNumber(value.start));
  const rawEnd = Math.max(start, readNumber(value.end, start));
  const end = Math.min(rawEnd, start + MAX_SECONDS);
  const videoId = readString(value.videoId);
  return {
    id: readString(value.id) || makeId(),
    kind: value.kind,
    title: readString(value.title),
    caption: readString(value.caption),
    category: readString(value.category, "worship"),
    audience: readAudience(value.audience),
    scheduledFor: readString(value.scheduledFor),
    createdAt: readString(value.createdAt, new Date().toISOString()),
    filterId: readString(value.filterId, "none"),
    start: roundTenth(start),
    end: roundTenth(end),
    coverTime: clamp(readNumber(value.coverTime, start), start, end),
    coverUrl: typeof value.coverUrl === "string" && value.coverUrl.startsWith("data:image/") ? value.coverUrl : null,
    fileName: typeof value.fileName === "string" ? value.fileName : null,
    videoId: /^[\w-]{11}$/.test(videoId) ? videoId : null,
    duration: Math.max(0, readNumber(value.duration)),
  };
}

function parseDrafts(raw: string): Draft[] {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map(parseDraft)
    .filter((draft): draft is Draft => draft !== null)
    .slice(0, MAX_DRAFTS);
}

export function ReelCreateExperience({ categories }: { categories: ReelCategory[] }) {
  const [mode, setMode] = useState<Mode>("clip");
  const [file, setFile] = useState<File | null>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [filterId, setFilterId] = useState("none");
  const [coverTime, setCoverTime] = useState(0);
  const [coverFrames, setCoverFrames] = useState<CoverFrame[]>([]);
  const [draftCoverUrl, setDraftCoverUrl] = useState<string | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const [previewPlaying, setPreviewPlaying] = useState(false);

  const [youtubeInput, setYoutubeInput] = useState("");
  const [youtubeId, setYoutubeId] = useState<string | null>(null);
  const [showEmbed, setShowEmbed] = useState(false);
  const [failedThumbs, setFailedThumbs] = useState<Set<string>>(new Set());

  const [title, setTitle] = useState("");
  const [caption, setCaption] = useState("");
  const [category, setCategory] = useState("worship");
  const [audience, setAudience] = useState<Audience>("public");
  const [scheduledFor, setScheduledFor] = useState("");

  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLVideoElement>(null);
  const objectUrlRef = useRef<string | null>(null);

  const chips = useMemo(
    () => (categories.length ? categories.filter((entry) => entry.id !== "for-you") : FALLBACK_CATEGORIES),
    [categories],
  );
  const activeFilter = useMemo(() => LOOKS.find((look) => look.id === filterId) ?? LOOKS[0], [filterId]);
  const filterCss = activeFilter.css;
  const coverUrl = useMemo(
    () => coverFrames.find((frame) => Math.abs(frame.time - coverTime) < 0.75)?.url ?? draftCoverUrl,
    [coverFrames, coverTime, draftCoverUrl],
  );
  const windowLength = Math.max(0, end - start);
  const startPercent = duration > 0 ? (start / duration) * 100 : 0;
  const windowPercent = duration > 0 ? (windowLength / duration) * 100 : 0;
  const playPercent = duration > 0 ? (clamp(playhead, start, end) / duration) * 100 : 0;
  const categoryLabel = chips.find((entry) => entry.id === category)?.label ?? "Reel";

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw) setDrafts(parseDrafts(raw));
      } catch {
        /* Storage can be blocked; the studio still works for this tab. */
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      const url = objectUrlRef.current;
      if (url) URL.revokeObjectURL(url);
    };
  }, []);

  /**
   * Cover frames are sampled from a detached video, one seek at a time. Reusing
   * the on-screen player would fight the export preview for the same media
   * element, and sampling all six frames at once decodes six copies of the file.
   */
  useEffect(() => {
    let cancelled = false;
    let teardown: (() => void) | undefined;
    const timer = setTimeout(() => {
      if (cancelled) return;
      if (!objectUrl || end <= start) {
        setCoverFrames([]);
        return;
      }
      const probe = document.createElement("video");
      probe.muted = true;
      probe.preload = "auto";
      probe.playsInline = true;
      const times = Array.from({ length: 6 }, (_, index) => start + ((end - start) * (index + 0.5)) / 6);
      const frames: CoverFrame[] = [];

      const seekNext = () => {
        if (cancelled) return;
        const nextTime = times[frames.length];
        if (nextTime !== undefined) probe.currentTime = nextTime;
      };
      const capture = () => {
        if (cancelled) return;
        const canvas = document.createElement("canvas");
        canvas.width = 96;
        canvas.height = 170;
        const context = canvas.getContext("2d");
        if (!context) return;
        context.filter = filterCss;
        try {
          context.drawImage(probe, 0, 0, canvas.width, canvas.height);
          frames.push({ time: times[frames.length - 1] ?? start, url: canvas.toDataURL("image/jpeg", 0.62) });
          setCoverFrames([...frames]);
        } catch {
          /* A frame that cannot be drawn is simply skipped. */
        }
        seekNext();
      };
      const onError = () => {
        if (!cancelled) setCoverFrames([]);
      };

      probe.addEventListener("loadeddata", seekNext);
      probe.addEventListener("seeked", capture);
      probe.addEventListener("error", onError);
      probe.src = objectUrl;
      teardown = () => {
        probe.removeEventListener("loadeddata", seekNext);
        probe.removeEventListener("seeked", capture);
        probe.removeEventListener("error", onError);
        probe.pause();
        probe.removeAttribute("src");
        probe.load();
      };
    }, 0);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      teardown?.();
    };
  }, [objectUrl, start, end, filterCss]);

  const markThumbFailed = useCallback((id: string) => {
    setFailedThumbs((current) => (current.has(id) ? current : new Set(current).add(id)));
  }, []);

  const applyWindow = useCallback(
    (nextStart: number, nextEnd: number) => {
      const next = normalizeWindow(nextStart, nextEnd, duration);
      setStart(next.start);
      setEnd(next.end);
      setCoverTime((current) => clamp(current, next.start, next.end));
    },
    [duration],
  );

  const handleMetadata = (event: SyntheticEvent<HTMLVideoElement>) => {
    const video = event.currentTarget;
    const raw = Number.isFinite(video.duration) ? video.duration : 0;
    const next = normalizeWindow(0, Math.min(raw, MAX_SECONDS), raw);
    setDuration(raw);
    setStart(next.start);
    setEnd(next.end);
    setCoverTime(next.start + (next.end - next.start) / 2);
    setPlayhead(0);
    setPreviewPlaying(false);
  };

  const handleTimeUpdate = (event: SyntheticEvent<HTMLVideoElement>) => {
    const video = event.currentTarget;
    const current = video.currentTime;
    setPlayhead(current);
    if (end > start && current >= end) {
      video.pause();
      video.currentTime = end;
      setPreviewPlaying(false);
    }
  };

  const chooseFile = (event: ChangeEvent<HTMLInputElement>) => {
    const next = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!next) return;
    if (!next.type.startsWith("video/")) {
      setError("Please choose a video file — MP4, MOV or WebM all work here.");
      return;
    }
    if (next.size > MAX_FILE_BYTES) {
      setError("That file is over 500 MB. Try a shorter clip so the local preview stays smooth.");
      return;
    }
    const previous = objectUrlRef.current;
    if (previous) URL.revokeObjectURL(previous);
    const url = URL.createObjectURL(next);
    objectUrlRef.current = url;
    setFile(next);
    setObjectUrl(url);
    setDuration(0);
    setStart(0);
    setEnd(0);
    setCoverTime(0);
    setCoverFrames([]);
    setDraftCoverUrl(null);
    setPlayhead(0);
    setPreviewPlaying(false);
    setError(null);
    setNotice("Clip loaded. Everything below happens in this browser — nothing is uploaded.");
  };

  const togglePlayback = () => {
    if (mode === "youtube") {
      setShowEmbed((current) => !current);
      return;
    }
    const video = previewRef.current;
    if (!video || !objectUrl) {
      setError("Choose a video first, then press play.");
      return;
    }
    if (!video.paused) {
      video.pause();
      setPreviewPlaying(false);
      return;
    }
    if (video.currentTime < start || video.currentTime >= end) video.currentTime = start;
    void video.play().then(
      () => setPreviewPlaying(true),
      () => setError("The preview could not start. Press play once more to try again."),
    );
  };

  const jumpToStart = () => {
    const video = previewRef.current;
    if (!video || !objectUrl) return;
    video.pause();
    video.currentTime = start;
    setPlayhead(start);
    setPreviewPlaying(false);
  };

  const updateYoutubeInput = (value: string) => {
    setYoutubeInput(value);
    setYoutubeId(parseYouTubeId(value));
    setShowEmbed(false);
    setError(null);
  };

  const persist = (next: Draft[]): boolean => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setDrafts(next);
      return true;
    } catch {
      setError("This browser could not store the draft. Try deleting an older draft first.");
      return false;
    }
  };

  const saveDraft = () => {
    setError(null);
    setNotice(null);
    if (!title.trim()) {
      setError("Give the reel a title so you can find the draft again.");
      return;
    }
    const scheduleProblem = scheduleIssue(scheduledFor);
    if (scheduleProblem) {
      setError(scheduleProblem);
      return;
    }
    let draft: Draft;
    if (mode === "clip") {
      if (!objectUrl || !file) {
        setError("Pick a video file before saving a clip draft.");
        return;
      }
      if (end <= start || windowLength > MAX_SECONDS + 0.05) {
        setError("Choose a trim window of at least half a second and no more than four minutes.");
        return;
      }
      draft = {
        id: makeId(), kind: "clip", title: title.trim(), caption: caption.trim(), category,
        audience, scheduledFor, createdAt: new Date().toISOString(), filterId,
        start, end, coverTime, coverUrl,
        fileName: file.name, videoId: null, duration,
      };
    } else {
      if (!youtubeId) {
        setError("Paste a YouTube watch, youtu.be, shorts or embed link first.");
        return;
      }
      draft = {
        id: makeId(), kind: "youtube", title: title.trim(), caption: caption.trim(), category,
        audience, scheduledFor, createdAt: new Date().toISOString(), filterId,
        start: 0, end: 0, coverTime: 0, coverUrl: null, fileName: null, videoId: youtubeId, duration: 0,
      };
    }
    if (persist([draft, ...drafts].slice(0, MAX_DRAFTS))) {
      setNotice(
        mode === "youtube"
          ? "Link saved. Open it in Reels or play the preview here."
          : "Draft saved in this browser. Reattach the source file later to keep editing the clip.",
      );
    }
  };

  const loadDraft = (draft: Draft) => {
    const previous = objectUrlRef.current;
    if (previous) URL.revokeObjectURL(previous);
    objectUrlRef.current = null;
    setFile(null);
    setObjectUrl(null);
    setDuration(0);
    setStart(draft.start);
    setEnd(draft.end);
    setCoverTime(draft.coverTime);
    setCoverFrames([]);
    setDraftCoverUrl(draft.coverUrl);
    setPlayhead(draft.start);
    setPreviewPlaying(false);
    setTitle(draft.title);
    setCaption(draft.caption);
    setCategory(draft.category);
    setAudience(draft.audience);
    setScheduledFor(draft.scheduledFor);
    setFilterId(draft.filterId);
    setError(null);
    setMode(draft.kind);
    if (draft.kind === "youtube") {
      setDraftCoverUrl(null);
      setYoutubeInput(draft.videoId ?? "");
      setYoutubeId(draft.videoId);
      setShowEmbed(false);
      setNotice("YouTube draft loaded. The link and its details live in this browser.");
    } else {
      setYoutubeInput("");
      setYoutubeId(null);
      setNotice("Draft settings loaded. Video files are not stored locally — reselect the original clip to preview it.");
    }
  };

  const deleteDraft = (id: string) => {
    if (persist(drafts.filter((draft) => draft.id !== id))) setNotice("Draft removed from this browser.");
  };

  const renderChips = (value: string, onSelect: (id: string) => void) => (
    <div className="flex flex-wrap gap-2">
      {chips.map((entry) => (
        <button
          key={entry.id}
          type="button"
          aria-pressed={value === entry.id}
          title={entry.description}
          onClick={() => onSelect(entry.id)}
          className="rounded-full border border-line px-3 py-1.5 text-[12px] font-semibold text-ink-soft transition data-[active=true]:border-gold data-[active=true]:bg-gold-soft data-[active=true]:text-ink hover:border-gold/70"
          data-active={value === entry.id}
        >
          {entry.label}
        </button>
      ))}
    </div>
  );

  const renderAudiences = (value: Audience, onSelect: (next: Audience) => void) => (
    <div className="grid gap-2 sm:grid-cols-3">
      {AUDIENCES.map((entry) => (
        <button
          key={entry.id}
          type="button"
          aria-pressed={value === entry.id}
          onClick={() => onSelect(entry.id)}
          className="rounded-xl border border-line bg-canvas/50 p-3 text-left transition data-[active=true]:border-sage data-[active=true]:bg-sage-soft/60"
          data-active={value === entry.id}
        >
          <span className="flex items-center gap-1.5 text-[13px] font-bold text-ink">
            {value === entry.id ? <Check size={13} aria-hidden /> : null}
            {entry.label}
          </span>
          <span className="mt-0.5 block text-[11px] leading-4 text-ink-muted">{entry.hint}</span>
        </button>
      ))}
    </div>
  );

  return (
    <main className="min-h-screen bg-canvas text-ink">
      <header className="sticky top-0 z-20 border-b border-line bg-surface/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:px-6">
          <Link
            href="/reels"
            className="flex shrink-0 items-center gap-1.5 rounded-full bg-surface-soft px-3 py-1.5 text-[12px] font-semibold text-ink-soft transition hover:bg-gold-soft"
          >
            <ArrowLeft size={16} aria-hidden />
            <span className="hidden sm:inline">Reels</span>
          </Link>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="font-display text-xl font-semibold tracking-tight sm:text-2xl">Reel Studio</h1>
              <span className="rounded-full bg-gold-soft px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.16em] text-ink">
                Local draft
              </span>
            </div>
            <p className="truncate text-xs text-ink-muted">Shape a four-minute witness, frame by frame.</p>
          </div>
          <Link
            href="/reels/friends"
            className="hidden shrink-0 rounded-full border border-line px-3 py-1.5 text-[12px] font-semibold text-ink-soft transition hover:border-gold hover:text-ink sm:inline-flex"
          >
            Friends
          </Link>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        <div className="space-y-5">
          <section className="rounded-[1.75rem] border border-line bg-surface p-4 shadow-soft sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-gold">Source</p>
                <h2 className="font-display text-2xl font-semibold tracking-tight">What are you shaping?</h2>
              </div>
              <div className="inline-flex rounded-full bg-surface-soft p-1" aria-label="Reel source">
                <button
                  type="button"
                  aria-pressed={mode === "clip"}
                  onClick={() => setMode("clip")}
                  className="rounded-full px-3 py-1.5 text-[12px] font-bold text-ink-soft transition data-[active=true]:bg-surface data-[active=true]:text-ink data-[active=true]:shadow-soft"
                  data-active={mode === "clip"}
                >
                  Upload clip
                </button>
                <button
                  type="button"
                  aria-pressed={mode === "youtube"}
                  onClick={() => setMode("youtube")}
                  className="rounded-full px-3 py-1.5 text-[12px] font-bold text-ink-soft transition data-[active=true]:bg-surface data-[active=true]:text-ink data-[active=true]:shadow-soft"
                  data-active={mode === "youtube"}
                >
                  Use a YouTube link
                </button>
              </div>
            </div>

            {mode === "clip" ? (
              <div className="mt-5 grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <div className="rounded-2xl border border-dashed border-line bg-canvas/60 p-5">
                  <input
                    ref={fileInputRef}
                    id="reel-video-file"
                    type="file"
                    accept="video/*"
                    onChange={chooseFile}
                    className="sr-only"
                  />
                  <label
                    htmlFor="reel-video-file"
                    className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-ink-fill px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90"
                  >
                    <Upload size={16} aria-hidden />
                    Choose a video
                  </label>
                  <p className="mt-3 text-sm leading-6 text-ink-muted">
                    {file ? (
                      <>
                        <span className="font-semibold text-ink">{file.name}</span> · {formatBytes(file.size)}
                      </>
                    ) : (
                      "MP4, MOV or WebM. Vertical 9:16 works best. Nothing is uploaded."
                    )}
                  </p>
                </div>
                <div className="rounded-2xl bg-gold-soft px-4 py-3 text-xs font-semibold text-ink">
                  <span className="flex items-center gap-2">
                    <Clock3 size={15} aria-hidden /> 4:00 maximum
                  </span>
                </div>
              </div>
            ) : (
              <div className="mt-5 space-y-3">
                <label htmlFor="reel-youtube-link" className="text-xs font-bold uppercase tracking-[0.14em] text-ink-soft">
                  Paste a YouTube link
                </label>
                <div className="flex items-center gap-2 rounded-xl border border-line bg-canvas/60 px-3">
                  <Link2 size={16} className="shrink-0 text-ink-muted" aria-hidden />
                  <input
                    id="reel-youtube-link"
                    value={youtubeInput}
                    onChange={(event) => updateYoutubeInput(event.target.value)}
                    placeholder="https://youtu.be/… or a bare video id"
                    className="w-full bg-transparent py-3 text-sm outline-none placeholder:text-ink-muted"
                  />
                </div>
                {youtubeInput && !youtubeId ? (
                  <p className="text-[12px] text-terracotta">That does not look like a YouTube video yet.</p>
                ) : null}
                {youtubeId ? (
                  <div className="flex flex-wrap items-center gap-2 rounded-xl bg-sage-soft/70 px-3 py-2 text-[12px] text-ink">
                    <Check size={14} aria-hidden /> Video id found: <span className="font-mono font-bold">{youtubeId}</span>
                  </div>
                ) : null}
              </div>
            )}
          </section>

          <section className="rounded-[1.75rem] border border-line bg-surface p-4 shadow-soft sm:p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-gold">Export preview</p>
                <h2 className="font-display text-2xl font-semibold tracking-tight">See the cut before you save it</h2>
              </div>
              <span className="rounded-full bg-surface-soft px-3 py-1 text-[11px] font-semibold text-ink-soft">
                {activeFilter.name}
              </span>
            </div>

            <div className="grid gap-6 lg:grid-cols-[minmax(220px,0.72fr)_minmax(0,1.28fr)]">
              <div>
                <div className="relative mx-auto aspect-[9/16] w-full max-w-[280px] overflow-hidden rounded-[1.75rem] bg-ink-fill shadow-soft">
                  {mode === "clip" && objectUrl ? (
                    <video
                      ref={previewRef}
                      src={objectUrl}
                      onLoadedMetadata={handleMetadata}
                      onTimeUpdate={handleTimeUpdate}
                      onPause={() => setPreviewPlaying(false)}
                      onPlay={() => setPreviewPlaying(true)}
                      onEnded={() => setPreviewPlaying(false)}
                      className="absolute inset-0 size-full object-contain"
                      style={{ filter: filterCss }}
                      playsInline
                      preload="metadata"
                    />
                  ) : mode === "youtube" && youtubeId ? (
                    showEmbed ? (
                      <iframe
                        src={`https://www.youtube-nocookie.com/embed/${youtubeId}?rel=0`}
                        title="YouTube reel preview"
                        allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                        className="absolute inset-0 size-full"
                        style={{ filter: filterCss }}
                      />
                    ) : (
                      <div className="absolute inset-0 bg-ink-fill">
                        {failedThumbs.has(youtubeId) ? null : (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={`https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`}
                            alt=""
                            onError={() => markThumbFailed(youtubeId)}
                            className="size-full object-cover"
                            style={{ filter: filterCss }}
                          />
                        )}
                        <div className="absolute inset-0 grid place-content-center gap-2 bg-ink-fill/35 text-center text-white">
                          <span className="mx-auto grid size-12 place-content-center rounded-full bg-white/20 backdrop-blur">
                            <Play size={22} aria-hidden />
                          </span>
                          <span className="text-[11px] font-semibold">Press play to load the player</span>
                        </div>
                      </div>
                    )
                  ) : (
                    <div className="absolute inset-0 grid place-content-center gap-3 bg-gradient-to-br from-[#20251f] via-[#3b3120] to-[#181c1a] p-6 text-center text-white">
                      {coverUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={coverUrl} alt="" className="absolute inset-0 size-full object-cover opacity-35" style={{ filter: filterCss }} />
                      ) : null}
                      <Film size={28} className="relative mx-auto text-gold-light" aria-hidden />
                      <p className="relative text-sm font-semibold">Your frame lives here</p>
                      <p className="relative text-[11px] leading-5 text-white/60">
                        Pick a vertical clip or paste a YouTube link to see the look.
                      </p>
                    </div>
                  )}

                  <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/35 to-transparent p-4 pt-12">
                    <span className="rounded-full bg-white/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.16em] text-white/80">
                      {categoryLabel}
                    </span>
                    <p className="mt-2 font-display text-lg leading-tight text-white">{title.trim() || "Untitled reel"}</p>
                    {caption.trim() ? <p className="mt-1 line-clamp-2 text-[11px] text-white/70">{caption.trim()}</p> : null}
                  </div>

                  {mode === "clip" && duration > 0 ? (
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1 bg-white/20">
                      <div
                        className="absolute h-full rounded-full bg-gold"
                        style={{ left: `${startPercent}%`, width: `${windowPercent}%` }}
                      />
                      <div
                        className="absolute -top-1 size-3 -translate-x-1/2 rounded-full bg-white shadow"
                        style={{ left: `${playPercent}%` }}
                      />
                    </div>
                  ) : null}
                </div>

                <div className="mt-3 flex items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={jumpToStart}
                    disabled={mode !== "clip" || !objectUrl}
                    className="rounded-full border border-line p-2 text-ink-soft transition hover:bg-surface-soft disabled:opacity-40"
                    aria-label="Jump to trim start"
                  >
                    <Clock3 size={15} aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={togglePlayback}
                    disabled={mode === "clip" ? !objectUrl : !youtubeId}
                    className="inline-flex items-center gap-2 rounded-full bg-ink-fill px-4 py-2 text-[12px] font-semibold text-white transition hover:opacity-90 disabled:opacity-40"
                  >
                    {previewPlaying || showEmbed ? <Pause size={14} aria-hidden /> : <Play size={14} aria-hidden />}
                    {mode === "clip"
                      ? previewPlaying ? "Pause preview" : "Play preview"
                      : showEmbed ? "Hide player" : "Play YouTube preview"}
                  </button>
                  <span className="min-w-[62px] text-center text-[11px] font-semibold text-ink-muted">
                    {mode === "clip" ? `${formatTime(playhead)} / ${formatTime(end)}` : "YouTube"}
                  </span>
                </div>
              </div>

              <div className="space-y-5">
                <div>
                  <div className="mb-3 flex items-center justify-between">
                    <p className="text-xs font-bold uppercase tracking-[0.16em] text-ink-soft">Looks</p>
                    <span className="text-[11px] text-ink-muted">{LOOKS.length} live swatches</span>
                  </div>
                  <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                    {LOOKS.map((look) => (
                      <button
                        key={look.id}
                        type="button"
                        title={look.hint}
                        aria-pressed={filterId === look.id}
                        onClick={() => setFilterId(look.id)}
                        className="group text-left"
                      >
                        <span className="relative block aspect-[9/16] overflow-hidden rounded-md bg-surface-soft ring-1 ring-line transition group-hover:ring-gold/70">
                          {coverUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={coverUrl} alt="" className="size-full object-cover" style={{ filter: look.css }} />
                          ) : (
                            <span
                              className="block size-full bg-gradient-to-br from-surface-soft via-gold-soft to-sage-soft"
                              style={{ filter: look.css }}
                            />
                          )}
                          {filterId === look.id ? (
                            <span className="absolute inset-0 rounded-md ring-2 ring-inset ring-gold" />
                          ) : null}
                        </span>
                        <span className="mt-1 block truncate text-[10px] font-semibold text-ink-soft">{look.name}</span>
                      </button>
                    ))}
                  </div>
                  <p className="mt-2 text-[11px] leading-4 text-ink-muted">{activeFilter.hint}</p>
                </div>

                {mode === "clip" ? (
                  <div className="rounded-2xl bg-canvas/70 p-4">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.16em] text-ink-soft">
                        <Scissors size={14} aria-hidden /> Trim window
                      </p>
                      <span className="text-[11px] font-bold text-gold">{formatTime(windowLength)} selected</span>
                    </div>
                    {duration > 0 ? (
                      <>
                        <div className="relative h-2 rounded-full bg-surface-soft">
                          <div
                            className="absolute h-full rounded-full bg-gold"
                            style={{ left: `${startPercent}%`, width: `${windowPercent}%` }}
                          />
                        </div>
                        <div className="mt-4 grid gap-4 sm:grid-cols-2">
                          <label className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">
                            Start
                            <input
                              type="range"
                              min={0}
                              max={Math.max(duration, 0.1)}
                              step={0.1}
                              value={start}
                              onChange={(event) => applyWindow(Number(event.target.value), end)}
                              className="mt-2 w-full accent-gold"
                            />
                            <span className="mt-1 block text-xs font-semibold normal-case tracking-normal text-ink">
                              {formatTime(start)}
                            </span>
                          </label>
                          <label className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">
                            End
                            <input
                              type="range"
                              min={0}
                              max={Math.max(duration, 0.1)}
                              step={0.1}
                              value={end}
                              onChange={(event) => applyWindow(start, Number(event.target.value))}
                              className="mt-2 w-full accent-gold"
                            />
                            <span className="mt-1 block text-xs font-semibold normal-case tracking-normal text-ink">
                              {formatTime(end)}
                            </span>
                          </label>
                        </div>
                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                          <label className="text-[11px] font-semibold text-ink-muted">
                            Start time · seconds
                            <input
                              type="number"
                              min={0}
                              max={duration}
                              step={0.1}
                              value={roundTenth(start)}
                              onChange={(event) => applyWindow(Number(event.target.value), end)}
                              className="mt-1 w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-ink outline-none focus:border-gold"
                            />
                          </label>
                          <label className="text-[11px] font-semibold text-ink-muted">
                            End time · seconds
                            <input
                              type="number"
                              min={0}
                              max={duration}
                              step={0.1}
                              value={roundTenth(end)}
                              onChange={(event) => applyWindow(start, Number(event.target.value))}
                              className="mt-1 w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-ink outline-none focus:border-gold"
                            />
                          </label>
                        </div>
                        {duration > MAX_SECONDS ? (
                          <p className="mt-3 text-[11px] leading-4 text-ink-muted">
                            This file runs {formatTime(duration)}. The window above never exceeds four minutes.
                          </p>
                        ) : null}
                      </>
                    ) : (
                      <p className="text-sm text-ink-muted">Choose a video to set its in and out points.</p>
                    )}
                  </div>
                ) : (
                  <div className="rounded-2xl bg-canvas/70 p-4 text-sm leading-6 text-ink-muted">
                    A YouTube link has no local trim window. Its look is applied to the preview here; the shared Reels
                    player uses the source video as YouTube serves it.
                  </div>
                )}

                {mode === "clip" ? (
                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.16em] text-ink-soft">
                        <ImageIcon size={14} aria-hidden /> Cover frame
                      </p>
                      <span className="text-[11px] font-semibold text-ink-muted">{formatTime(coverTime)}</span>
                    </div>
                    {coverFrames.length > 0 ? (
                      <div className="grid grid-cols-6 gap-2">
                        {coverFrames.map((frame) => (
                          <button
                            key={frame.time}
                            type="button"
                            aria-label={`Use frame at ${formatTime(frame.time)} as cover`}
                            aria-pressed={Math.abs(frame.time - coverTime) < 0.75}
                            onClick={() => setCoverTime(frame.time)}
                            className={`overflow-hidden rounded-md ring-1 transition ${
                              Math.abs(frame.time - coverTime) < 0.75 ? "ring-2 ring-gold" : "ring-line hover:ring-gold/60"
                            }`}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={frame.url} alt="" className="aspect-[9/16] w-full object-cover" />
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="rounded-xl border border-dashed border-line p-3 text-xs leading-5 text-ink-muted">
                        Cover frames appear once a clip is loaded. Pick one, and the studio saves that still with the draft.
                      </p>
                    )}
                  </div>
                ) : null}
              </div>
            </div>
          </section>
        </div>

        <div className="space-y-5">
          <section className="rounded-[1.75rem] border border-line bg-surface p-4 shadow-soft sm:p-5">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-gold">Details</p>
            <h2 className="mb-4 font-display text-2xl font-semibold tracking-tight">Give it a name</h2>

            <div className="space-y-4">
              <label className="block text-xs font-bold uppercase tracking-wider text-ink-soft">
                Title
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  maxLength={80}
                  placeholder="A moment worth sharing"
                  className="mt-1.5 w-full rounded-xl border border-line bg-canvas/60 px-3 py-2.5 text-sm font-normal normal-case tracking-normal text-ink outline-none placeholder:text-ink-muted focus:border-gold"
                />
              </label>
              <label className="block text-xs font-bold uppercase tracking-wider text-ink-soft">
                Caption
                <textarea
                  value={caption}
                  onChange={(event) => setCaption(event.target.value)}
                  rows={3}
                  maxLength={280}
                  placeholder="One line of context, a scripture, or a prayer."
                  className="mt-1.5 w-full resize-none rounded-xl border border-line bg-canvas/60 px-3 py-2.5 text-sm font-normal normal-case tracking-normal leading-6 text-ink outline-none placeholder:text-ink-muted focus:border-gold"
                />
                <span className="mt-1 block text-right text-[10px] font-normal normal-case tracking-normal text-ink-muted">
                  {caption.length}/280
                </span>
              </label>

              <div>
                <p className="mb-2 text-xs font-bold uppercase tracking-wider text-ink-soft">Category</p>
                {renderChips(category, setCategory)}
              </div>

              <div>
                <p className="mb-2 text-xs font-bold uppercase tracking-wider text-ink-soft">Audience</p>
                {renderAudiences(audience, setAudience)}
              </div>

              <label className="block text-xs font-bold uppercase tracking-wider text-ink-soft">
                Schedule <span className="font-normal normal-case tracking-normal text-ink-muted">(optional)</span>
                <span className="mt-1.5 flex items-center gap-2 rounded-xl border border-line bg-canvas/60 px-3">
                  <CalendarClock size={15} className="shrink-0 text-ink-muted" aria-hidden />
                  <input
                    type="datetime-local"
                    value={scheduledFor}
                    onChange={(event) => setScheduledFor(event.target.value)}
                    className="w-full bg-transparent py-2.5 text-sm font-normal normal-case tracking-normal text-ink outline-none"
                  />
                </span>
                <span className="mt-1 block text-[11px] font-normal normal-case tracking-normal leading-4 text-ink-muted">
                  Saved with the draft. Automatic publishing needs an upload service.
                </span>
              </label>

              <button
                type="button"
                onClick={saveDraft}
                className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-ink-fill px-5 py-3 text-sm font-semibold text-white transition hover:opacity-90"
              >
                <Plus size={16} aria-hidden /> Save local draft
              </button>

              {error ? (
                <p role="alert" className="rounded-xl bg-terracotta-soft px-3 py-2 text-[12px] font-medium text-ink">
                  {error}
                </p>
              ) : null}
              {notice ? (
                <p role="status" className="rounded-xl bg-sage-soft px-3 py-2 text-[12px] font-medium text-ink">
                  {notice}
                </p>
              ) : null}
            </div>
          </section>

          <section className="rounded-[1.75rem] border border-gold/30 bg-gold-soft/55 p-4">
            <div className="flex gap-3">
              <Info size={18} className="mt-0.5 shrink-0 text-ink-soft" aria-hidden />
              <div>
                <h2 className="font-display text-lg font-semibold">What “publishing” means here</h2>
                <p className="mt-1 text-[12px] leading-5 text-ink-soft">
                  Drafts live in this browser’s localStorage. There is no upload endpoint yet, so nothing enters the
                  shared feed; that needs an account and a video service. YouTube links open in Reels and can be
                  played in the preview above.
                </p>
              </div>
            </div>
          </section>

          <section className="rounded-[1.75rem] border border-line bg-surface p-4 shadow-soft sm:p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-gold">On this device</p>
                <h2 className="font-display text-2xl font-semibold tracking-tight">Your drafts</h2>
              </div>
              <span className="rounded-full bg-surface-soft px-2.5 py-1 text-[11px] font-bold text-ink-soft">
                {drafts.length}
              </span>
            </div>

            {drafts.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-line p-6 text-center">
                <Sparkles size={22} className="mx-auto text-gold" aria-hidden />
                <p className="mt-2 text-sm font-semibold">No drafts yet</p>
                <p className="mt-1 text-[12px] leading-5 text-ink-muted">
                  Save a clip or a YouTube link and it will be waiting here on this device.
                </p>
              </div>
            ) : (
              <ul className="space-y-3">
                {drafts.map((draft) => (
                  <li key={draft.id} className="flex gap-3 rounded-2xl border border-line bg-canvas/60 p-3">
                    <div className="relative h-20 w-14 shrink-0 overflow-hidden rounded-lg bg-ink-fill">
                      {draft.coverUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={draft.coverUrl} alt="" className="size-full object-cover" />
                      ) : draft.videoId && !failedThumbs.has(draft.videoId) ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={`https://i.ytimg.com/vi/${draft.videoId}/mqdefault.jpg`}
                          alt=""
                          onError={() => markThumbFailed(draft.videoId ?? "")}
                          className="size-full object-cover"
                        />
                      ) : null}
                      <span className="absolute inset-0 grid place-content-center text-white/70">
                        <Film size={16} aria-hidden />
                      </span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="truncate text-sm font-semibold">{draft.title || "Untitled reel"}</p>
                        <span className="shrink-0 rounded-full bg-surface-soft px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-ink-muted">
                          {draft.kind === "youtube" ? "Link" : "Clip"}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-[11px] text-ink-muted">
                        {chips.find((entry) => entry.id === draft.category)?.label ?? "Reel"} · {formatSaved(draft.createdAt)}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => loadDraft(draft)}
                          className="inline-flex items-center gap-1 rounded-full bg-surface px-2.5 py-1 text-[11px] font-semibold text-ink-soft transition hover:bg-gold-soft"
                        >
                          <Sparkles size={12} aria-hidden /> Load
                        </button>
                        {draft.videoId ? (
                          <Link
                            href={`/reels?reel=${encodeURIComponent(draft.videoId)}`}
                            className="inline-flex items-center gap-1 rounded-full bg-surface px-2.5 py-1 text-[11px] font-semibold text-ink-soft transition hover:bg-gold-soft"
                          >
                            <ArrowLeft size={12} className="rotate-180" aria-hidden /> Open in Reels
                          </Link>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => deleteDraft(draft.id)}
                          aria-label={`Delete draft ${draft.title || "Untitled reel"}`}
                          className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold text-terracotta transition hover:bg-terracotta-soft"
                        >
                          <Trash2 size={12} aria-hidden /> Delete
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
