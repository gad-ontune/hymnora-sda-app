"use client";

import {
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Copy,
  Highlighter,
  Heart,
  Moon,
  Share2,
  Sun,
  Type,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FloatingNotes } from "@/components/floating-notes";
import { getCompleteBibles, getLocalBooks, getLocalChapter, type CompleteBible } from "@/lib/api";

/** The opening pair, in the canon order every translation agrees on. */
const OPENING_BOOK_NUMBER = 43;

/**
 * The faces a reader can read a long chapter in. All four are serifs or a
 * highly legible sans, and each was picked for sustained reading rather than
 * for headlines — a chapter is not a poster.
 */
const READER_FONTS = [
  { id: "serif", label: "Source Serif", className: "font-reading" },
  { id: "literata", label: "Literata", className: "font-literata" },
  { id: "lora", label: "Lora", className: "font-lora" },
  { id: "display", label: "Fraunces", className: "font-display" },
  { id: "sans", label: "DM Sans", className: "font-sans" },
] as const;

type ReaderFontId = (typeof READER_FONTS)[number]["id"];

/** Text sizes for the reader. The old face ran at 44px, which is poster-sized. */
const READER_SIZES = [
  { id: "sm", label: "S", className: "text-[15px] leading-[1.75]" },
  { id: "md", label: "M", className: "text-[17px] leading-[1.8]" },
  { id: "lg", label: "L", className: "text-[19px] leading-[1.85]" },
] as const;

type ReaderSizeId = (typeof READER_SIZES)[number]["id"];

type SavedVerse = { id: string; reference: string; text: string; versionId: string };

const BOOKMARKS_KEY = "hymnora-bible-bookmarks";
const FAVOURITES_KEY = "hymnora-bible-favourites";
const HIGHLIGHTS_KEY = "hymnora-bible-highlights";
/** Where the reader was last time, so opening the Bible resumes it. */
const PLACE_KEY = "hymnora-bible-place";

/** The colours a verse can be marked in, in the order they are offered. */
const HIGHLIGHT_COLOURS = [
  { id: "none", label: "No highlight", swatch: "transparent" },
  { id: "gold", label: "Gold", swatch: "rgba(214, 168, 74, 0.34)" },
  { id: "sage", label: "Green", swatch: "rgba(126, 154, 118, 0.32)" },
  { id: "sky", label: "Blue", swatch: "rgba(112, 150, 190, 0.30)" },
  { id: "rose", label: "Pink", swatch: "rgba(198, 124, 108, 0.28)" },
] as const;

type HighlightId = (typeof HIGHLIGHT_COLOURS)[number]["id"];

type ReadingPlace = { versionId: string; book: string; chapter: number; savedAt: number };

/** A verse the reader has opened the action bar on. */
type VerseTarget = { verse: number; text: string; left: number; top: number };

/** Roughly the height of the action bar, used to decide which side of the verse to open on. */
const ACTION_BAR_HEIGHT = 100;

function readStore(key: string): SavedVerse[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as SavedVerse[]) : [];
  } catch {
    return [];
  }
}

function writeStore(key: string, value: SavedVerse[]): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value.slice(0, 40)));
  } catch {
    // A full or blocked store is not worth interrupting reading over.
  }
}

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Same reasoning as writeStore.
  }
}

export function BibleExperience() {
  const [bibles, setBibles] = useState<CompleteBible[]>([]);
  const [biblesLoading, setBiblesLoading] = useState(true);
  const [versionId, setVersionId] = useState<string>("");
  const [books, setBooks] = useState<{ id: string; name: string; chapterCount: number; bookNumber: number }[]>([]);
  const [verses, setVerses] = useState<{ verse: number; text: string }[]>([]);
  const [loadedKey, setLoadedKey] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [book, setBook] = useState("");
  const [chapter, setChapter] = useState(1);
  const [copied, setCopied] = useState(false);
  const [readerTheme, setReaderTheme] = useState<"cream" | "dark">("cream");
  const [readerFont, setReaderFont] = useState<ReaderFontId>("serif");
  const [readerSize, setReaderSize] = useState<ReaderSizeId>("md");
  const [fontMenuOpen, setFontMenuOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickBook, setPickBook] = useState("");
  const [pickChapter, setPickChapter] = useState(1);
  const [pickVerse, setPickVerse] = useState(1);
  const [focusVerse, setFocusVerse] = useState<number | null>(null);
  const [bookmarks, setBookmarks] = useState<SavedVerse[]>([]);
  const [favourites, setFavourites] = useState<SavedVerse[]>([]);
  const [highlights, setHighlights] = useState<Record<string, HighlightId>>({});
  const [place, setPlace] = useState<ReadingPlace | null>(null);
  const [target, setTarget] = useState<VerseTarget | null>(null);
  const [toast, setToast] = useState("");
  const [storeReady, setStoreReady] = useState(false);
  const toastTimer = useRef<number | undefined>(undefined);
  /**
   * The saved place, held in a ref as well as state. State drives the
   * "Continue reading" chip, but the books lookup must not depend on it:
   * saving the place changes state, which would re-fetch the book list and
   * re-open the chapter, which would save the place again.
   */
  const placeRef = useRef<ReadingPlace | null>(null);

  const activeBible = bibles.find((entry) => entry.versionKey === versionId) ?? null;
  const currentBook = books.find((entry) => entry.name === book) ?? null;
  const dark = readerTheme === "dark";

  const loading = Boolean(versionId && book) && loadedKey !== `${versionId}:${book}:${chapter}`;

  /**
   * The library grouped by language, each language in alphabetical order.
   *
   * Grouping puts the languages where they can be counted, and lets the group
   * label carry the language so each option only has to name the translation.
   */
  const biblesByLanguage = useMemo(() => {
    const groups = new Map<string, CompleteBible[]>();
    for (const entry of bibles) {
      const group = groups.get(entry.language);
      if (group) group.push(entry);
      else groups.set(entry.language, [entry]);
    }
    return [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([language, entries]) => [language, entries.sort((a, b) => a.name.localeCompare(b.name))] as const);
  }, [bibles]);

  const fontChoice = READER_FONTS.find((entry) => entry.id === readerFont) ?? READER_FONTS[0];
  const sizeChoice = READER_SIZES.find((entry) => entry.id === readerSize) ?? READER_SIZES[1];

  const verseId = useCallback((number: number) => `bible-verse-${number}`, []);

  const toggleSaved = useCallback(
    (list: SavedVerse[], setList: (value: SavedVerse[]) => void, key: string, entry: SavedVerse) => {
      const next = list.some((item) => item.id === entry.id) ? list.filter((item) => item.id !== entry.id) : [entry, ...list];
      setList(next);
      writeStore(key, next);
    },
    [],
  );

  const isFavourite = useCallback((id: string) => favourites.some((item) => item.id === id), [favourites]);

  const toggleFavourite = useCallback(
    (verseNumber: number, text: string) => {
      if (!versionId || !book) return;
      const id = `${versionId}:${book}:${chapter}:${verseNumber}`;
      toggleSaved(
        favourites,
        setFavourites,
        FAVOURITES_KEY,
        { id, reference: `${book} ${chapter}:${verseNumber}`, text, versionId },
      );
    },
    [book, chapter, favourites, toggleSaved, versionId],
  );

  const toggleBookmark = useCallback(
    (verseNumber: number | null, text: string) => {
      if (!versionId || !book) return;
      const number = verseNumber ?? 0;
      const id = `${versionId}:${book}:${chapter}:${number}`;
      toggleSaved(
        bookmarks,
        setBookmarks,
        BOOKMARKS_KEY,
        { id, reference: number ? `${book} ${chapter}:${number}` : `${book} ${chapter}`, text, versionId },
      );
    },
    [book, bookmarks, chapter, toggleSaved, versionId],
  );

  // Saved passages are read on the client after mount, so the server-rendered
  // page and the first client render agree and hydration stays quiet.
  // Read the saved stores once on mount. This has to be an effect rather than
  // lazy initializers: the server renders with no localStorage, so the first
  // client render must agree with it (storeReady stays false and the cards show
  // "Loading…") before the real values are read.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time mount read of localStorage, guarded by storeReady for hydration.
    setBookmarks(readStore(BOOKMARKS_KEY));
    setFavourites(readStore(FAVOURITES_KEY));
    setHighlights(readJson<Record<string, HighlightId>>(HIGHLIGHTS_KEY, {}));
    const stored = readJson<ReadingPlace | null>(PLACE_KEY, null);
    placeRef.current = stored;
    setPlace(stored);
    setStoreReady(true);
  }, []);

  const say = useCallback((message: string) => {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 2200);
  }, []);

  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  // The action bar is a dialog, so it closes the way dialogs do.
  useEffect(() => {
    if (!target) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setTarget(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [target]);

  const verseKey = useCallback(
    (chapterNumber: number, verse: number) => `${versionId}:${book}:${chapterNumber}:${verse}`,
    [book, versionId],
  );

  /**
   * Remember the spot without asking. Runs when the passage settles and again
   * when the tab is closed, which covers scrolling away mid-chapter as well as
   * reading on to the next one.
   */
  const savePlace = useCallback(() => {
    if (!versionId || !book) return;
    const next: ReadingPlace = { versionId, book, chapter, savedAt: Date.now() };
    setPlace(next);
    writeJson(PLACE_KEY, next);
  }, [book, chapter, versionId]);

  // Persist the reading position the moment a passage has actually loaded, so
  // closing the tab mid-chapter still remembers where the reader was.
  useEffect(() => {
    if (loadedKey !== `${versionId}:${book}:${chapter}`) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- persists the reading position to localStorage when the passage settles.
    savePlace();
  }, [loadedKey, versionId, book, chapter, savePlace]);

  useEffect(() => {
    const commit = () => savePlace();
    window.addEventListener("pagehide", commit);
    document.addEventListener("visibilitychange", commit);
    return () => {
      window.removeEventListener("pagehide", commit);
      document.removeEventListener("visibilitychange", commit);
    };
  }, [savePlace]);

  function openVerseActions(node: HTMLElement, verse: number, text: string) {
    const rect = node.getBoundingClientRect();
    const margin = 12;
    const width = Math.min(330, window.innerWidth - margin * 2);
    const left = Math.min(
      Math.max(margin, rect.left + rect.width / 2 - width / 2),
      Math.max(margin, window.innerWidth - width - margin),
    );
    // Open below the verse when the bar genuinely fits there, otherwise above
    // it. Both bounds have to be checked: a verse scrolled off the top of the
    // screen has a negative bottom, which satisfies a bare "fits below" test
    // and would open the bar at a negative offset, off the top of the page.
    const below = rect.bottom + 10;
    const fitsBelow = below >= margin && below + ACTION_BAR_HEIGHT <= window.innerHeight - margin;
    const top = fitsBelow ? below : Math.max(margin, rect.top - 10 - ACTION_BAR_HEIGHT);
    setTarget({ verse, text, left, top });
  }

  const setHighlight = useCallback(
    (id: HighlightId) => {
      const key = verseKey(chapter, target?.verse ?? 0);
      if (!key) return;
      setHighlights((current) => {
        const next = { ...current };
        if (id === "none") delete next[key];
        else next[key] = id;
        writeJson(HIGHLIGHTS_KEY, next);
        return next;
      });
      say(id === "none" ? "Highlight removed" : `Marked in ${HIGHLIGHT_COLOURS.find((c) => c.id === id)?.label}`);
    },
    [say, target, verseKey, chapter],
  );

  async function shareVerse() {
    if (!target) return;
    const text = `${book} ${chapter}:${target.verse}\n\n${target.text}\n\n${activeBible?.name ?? ""}`.trim();
    if (navigator.share) {
      try {
        await navigator.share({ text });
        return;
      } catch {
        // A cancelled share is not a failure worth reporting.
      }
    }
    if (navigator.clipboard) await navigator.clipboard.writeText(text);
    say("Verse copied");
  }

  useEffect(() => {
    let active = true;
    getCompleteBibles()
      .then((list) => {
        if (!active) return;
        setBibles(list);
        setVersionId((current) => current || list.find((entry) => entry.languageCode === "eng")?.versionKey || list[0]?.versionKey || "");
      })
      .catch(() => {
        if (active) setLoadError("The Bible library could not be reached.");
      })
      .finally(() => {
        if (active) setBiblesLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  // Switching version resets to the opening passage: a chapter number that is
  // valid in one translation may not exist in another.
  useEffect(() => {
    if (!versionId) return;
    let active = true;
    getLocalBooks(versionId)
      .then((list) => {
        if (!active) return;
        const rows = (list ?? []) as { id: string; name: string; chapterCount: number; bookNumber: number }[];
        setBooks(rows);
        // Go back to where this reader left off rather than the first chapter
        // every single time. A saved place only counts if it names a book this
        // version actually has.
        const saved = placeRef.current;
        const resume = saved && saved.versionId === versionId ? rows.find((row) => row.name === saved.book) : undefined;
        if (resume && saved) {
          setBook(resume.name);
          setChapter(Math.min(Math.max(1, saved.chapter), resume.chapterCount));
          return;
        }
        const opening = rows.find((row) => row.bookNumber === OPENING_BOOK_NUMBER) ?? rows[0];
        if (opening) {
          setBook(opening.name);
          setChapter(1);
        }
      })
      .catch(() => {
        if (active) setLoadError("The books for this Bible could not be read.");
      });
    return () => {
      active = false;
    };
  }, [versionId, storeReady]);

  useEffect(() => {
    if (!versionId || !book) return;
    let active = true;
    getLocalChapter(versionId, book, chapter)
      .then((rows) => {
        if (!active) return;
        setLoadedKey(`${versionId}:${book}:${chapter}`);
        setLoadError(null);
        // Verse numbers come straight from the stored chapter, so each number
        // is the translation's own rather than anything worked out here.
        setVerses((rows ?? []) as { verse: number; text: string }[]);
      })
      .catch(() => {
        if (active) {
          setLoadedKey(`${versionId}:${book}:${chapter}`);
          setVerses([]);
          setLoadError("That chapter could not be read.");
        }
      });
    return () => {
      active = false;
    };
  }, [versionId, book, chapter]);

  useEffect(() => {
    if (focusVerse === null) return;
    const node = document.getElementById(verseId(focusVerse));
    node?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusVerse, verseId]);


  // Choosing a book and chapter in the picker navigates straight there, which
  // also loads that chapter's real verse numbers for the verse step.
  const pickTarget = books.find((entry) => entry.name === pickBook);
  function onPickChapter(value: number) {
    setPickChapter(value);
    setPickVerse(1);
    if (pickTarget) {
      setBook(pickTarget.name);
      setChapter(value);
    }
  }

  function onPickBook(value: string) {
    setPickBook(value);
    const target = books.find((entry) => entry.name === value);
    setPickChapter(1);
    setPickVerse(1);
    if (target) {
      setBook(target.name);
      setChapter(1);
    }
  }

  function goToPassage() {
    if (!pickTarget) return;
    setBook(pickTarget.name);
    setChapter(pickChapter);
    setFocusVerse(pickVerse);
    setPickerOpen(false);
  }

  function goToVerse(number: number) {
    setFocusVerse(number);
  }

  const chapterText = useMemo(() => verses.map((row) => row.text).join(" "), [verses]);

  function copyPassage() {
    const text = `${book} ${chapter}\n\n${chapterText}\n\n${activeBible ? `${activeBible.name} · ${activeBible.language}` : ""}`.trim();
    if (navigator.clipboard) navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  const readerCard = dark ? "bg-ink-fill text-white" : "bg-[#fbf5e7] text-[#28251e]";
  const hairline = dark ? "border-white/10" : "border-line/80";
  const chip = dark ? "bg-white/10 text-white" : "bg-surface-soft text-ink-soft";
  const chipHover = dark ? "hover:bg-white/15" : "hover:bg-gold-soft hover:text-gold";

  return (
    <div className="fade-up mx-auto max-w-[1120px]">
      <section id="bible-reader" className="scroll-mt-8 overflow-hidden rounded-[26px] border border-line shadow-soft">
        <div className={`flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3.5 sm:px-7 ${hairline} ${readerCard}`}>
          <div className="flex items-center gap-2.5">
            <BookOpenIcon />
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.17em] text-gold">Bible reader</p>
              <p className="truncate text-[13px] font-semibold">
                {book} {chapter}
                {storeReady && place ? (
                  <span className={`ml-2 text-[10px] font-bold ${dark ? "text-white/50" : "text-ink-muted"}`}>
                    Continue reading
                  </span>
                ) : null}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                if (!pickerOpen) {
                  // Start the picker from wherever the reader already is, so the
                  // first thing they see is the current passage, not the top.
                  setPickBook(book);
                  setPickChapter(chapter);
                  setPickVerse(1);
                }
                setPickerOpen(!pickerOpen);
              }}
              className={`flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-bold ${chip} ${chipHover}`}
              aria-expanded={pickerOpen}
              aria-label="Go to a book, chapter and verse"
            >
              <span className="font-mono text-[13px] leading-none">&lt;&gt;</span>
              <span className="hidden sm:inline">Go to</span>
            </button>
            <div className="relative">
              <button
                type="button"
                onClick={() => setFontMenuOpen((open) => !open)}
                className={`grid size-8 place-items-center rounded-lg ${chip} ${chipHover}`}
                aria-expanded={fontMenuOpen}
                aria-label="Change reading font"
              >
                <Type size={15} />
              </button>
              {fontMenuOpen ? (
                <div className="absolute right-0 top-10 z-30 w-56 rounded-2xl border border-line bg-surface p-2.5 text-ink shadow-soft">
                  <p className="px-2 pb-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-ink-muted">Typeface</p>
                  {READER_FONTS.map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      onClick={() => {
                        setReaderFont(entry.id);
                        setFontMenuOpen(false);
                      }}
                      className={`flex w-full items-center justify-between rounded-xl px-2.5 py-2 text-left text-sm transition hover:bg-surface-soft ${
                        readerFont === entry.id ? "bg-gold-soft text-gold" : ""
                      } ${entry.className}`}
                    >
                      {entry.label}
                      {readerFont === entry.id ? <span className="font-sans text-[10px] font-bold">ON</span> : null}
                    </button>
                  ))}
                  <p className="mt-1.5 border-t border-line px-2 pb-1 pt-2.5 text-[10px] font-bold uppercase tracking-[0.16em] text-ink-muted">
                    Text size
                  </p>
                  <div className="flex gap-1.5 px-1">
                    {READER_SIZES.map((entry) => (
                      <button
                        key={entry.id}
                        type="button"
                        onClick={() => setReaderSize(entry.id)}
                        className={`size-8 rounded-lg text-xs font-bold transition ${readerSize === entry.id ? "bg-gold text-ink" : "bg-surface-soft text-ink-muted hover:bg-gold-soft"}`}
                        aria-label={`Text size ${entry.label}`}
                      >
                        {entry.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => setReaderTheme(dark ? "cream" : "dark")}
              className={`grid size-8 place-items-center rounded-lg ${chip} ${chipHover}`}
              aria-label="Toggle reading mode"
            >
              {dark ? <Sun size={15} /> : <Moon size={15} />}
            </button>
          </div>
        </div>

        {pickerOpen ? (
          <div className={`border-b px-5 py-4 sm:px-7 ${hairline}`}>
            <div className="flex items-start justify-between gap-3">
              <p className="text-[11px] font-semibold text-ink-muted">Choose a book, then a chapter, then a verse.</p>
              <button type="button" onClick={() => setPickerOpen(false)} className={`grid size-7 place-items-center rounded-lg ${chip}`} aria-label="Close the passage picker">
                <X size={14} />
              </button>
            </div>
            <div className="mt-3 grid gap-2.5 sm:grid-cols-3">
              <label className="block">
                <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.14em] text-ink-muted">Book</span>
                <select
                  value={pickBook}
                  onChange={(event) => onPickBook(event.target.value)}
                  className={`h-10 w-full rounded-xl border px-2.5 text-sm outline-none ${dark ? "border-white/15 bg-white/10 text-white" : "border-line bg-white/70 text-ink"}`}
                >
                  {books.map((entry) => (
                    <option key={entry.bookNumber} value={entry.name} className="text-ink">
                      {entry.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.14em] text-ink-muted">Chapter</span>
                <select
                  value={pickChapter}
                  onChange={(event) => onPickChapter(Number(event.target.value))}
                  className={`h-10 w-full rounded-xl border px-2.5 text-sm outline-none ${dark ? "border-white/15 bg-white/10 text-white" : "border-line bg-white/70 text-ink"}`}
                >
                  {Array.from({ length: pickTarget?.chapterCount ?? 1 }, (_, index) => index + 1).map((number) => (
                    <option key={number} value={number} className="text-ink">
                      {number}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.14em] text-ink-muted">Verse</span>
                <select
                  value={pickVerse}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    setPickVerse(next);
                    goToVerse(next);
                  }}
                  className={`h-10 w-full rounded-xl border px-2.5 text-sm outline-none ${dark ? "border-white/15 bg-white/10 text-white" : "border-line bg-white/70 text-ink"}`}
                >
                  {(verses.length ? verses.map((row) => row.verse) : [1]).map((number) => (
                    <option key={number} value={number} className="text-ink">
                      {number}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="text-[11px] text-ink-muted">
                {verses.length
                  ? `${verses.length} verses in ${book} ${chapter}`
                  : pickBook && pickChapter
                    ? `Loading ${pickBook} ${pickChapter}…`
                    : ""}
              </p>
              <button
                type="button"
                onClick={goToPassage}
                className={`rounded-xl px-3.5 py-2 text-xs font-bold ${dark ? "bg-white/12 text-white" : "bg-ink-fill text-white"}`}
              >
                Open {pickBook} {pickChapter}:{pickVerse}
              </button>
            </div>
          </div>
        ) : null}

        <div className={`px-5 py-5 sm:px-7 sm:py-6 ${readerCard}`}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <label className="block">
              <span className="sr-only">Bible translation</span>
              <select
                value={versionId}
                onChange={(event) => setVersionId(event.target.value)}
                className={`h-10 w-full max-w-[280px] rounded-xl border px-2.5 text-[13px] font-semibold outline-none ${
                  dark ? "border-white/15 bg-white/10 text-white" : "border-line bg-white/70 text-ink"
                }`}
              >
                {bibles.length
                  ? biblesByLanguage.map(([language, entries]) => (
                      <optgroup key={language} label={language}>
                        {entries.map((entry) => (
                          <option key={entry.versionKey} value={entry.versionKey} className="text-ink">
                            {entry.name}
                          </option>
                        ))}
                      </optgroup>
                    ))
                  : <option className="text-ink">{biblesLoading ? "Loading translations…" : "No Bible available"}</option>}
              </select>
            </label>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setChapter((current) => Math.max(1, current - 1))}
                className={`grid size-8 place-items-center rounded-lg ${chip}`}
                aria-label="Previous chapter"
              >
                <ChevronLeft size={15} />
              </button>
              <span className="min-w-[104px] text-center text-[13px] font-semibold">
                {book} {chapter}
              </span>
              <button
                type="button"
                onClick={() => setChapter((current) => Math.min(currentBook?.chapterCount ?? 200, current + 1))}
                className={`grid size-8 place-items-center rounded-lg ${chip}`}
                aria-label="Next chapter"
              >
                <ChevronRight size={15} />
              </button>
            </div>
          </div>

          <div className={`mt-4 flex items-center gap-1 overflow-x-auto border-b pb-2.5 no-scrollbar`}>
            {books.map((item) => (
              <button
                key={item.bookNumber}
                type="button"
                onClick={() => {
                  setBook(item.name);
                  setChapter(1);
                  setFocusVerse(null);
                }}
                className={`shrink-0 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold ${
                  book === item.name ? (dark ? "bg-gold text-ink" : "bg-ink-fill text-white") : `opacity-55 hover:opacity-100 ${dark ? "" : "text-ink"}`
                }`}
              >
                {item.name}
              </button>
            ))}
          </div>

          <div className="mt-6">
            <p className="text-center text-[11px] font-bold uppercase tracking-[0.2em] text-gold">
              {book} {chapter}
            </p>

            {loading ? (
              <p className={`mt-5 text-center text-sm ${dark ? "text-white/60" : "text-ink-muted"}`}>Opening the page…</p>
            ) : loadError ? (
              <p className={`mt-5 text-center text-sm ${dark ? "text-white/60" : "text-ink-muted"}`}>{loadError}</p>
            ) : verses.length === 0 ? (
              <p className={`mt-5 text-center text-sm ${dark ? "text-white/60" : "text-ink-muted"}`}>
                {bibles.length === 0
                  ? "No complete Bible is available in this application yet."
                  : "This chapter has no text in the selected translation."}
              </p>
            ) : (
              <div className={`bible-verses mt-4 ${fontChoice.className} ${sizeChoice.className}`}>
                {verses.map((row) => {
                  const key = verseKey(chapter, row.verse);
                  const colour = HIGHLIGHT_COLOURS.find((entry) => entry.id === (highlights[key] ?? "none"));
                  return (
                    <p
                      key={row.verse}
                      id={verseId(row.verse)}
                      onClick={(event) => openVerseActions(event.currentTarget, row.verse, row.text)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          openVerseActions(event.currentTarget, row.verse, row.text);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                      aria-label={`${book} ${chapter}:${row.verse}. ${row.text}. Open verse actions.`}
                      aria-expanded={target?.verse === row.verse}
                      className={`bible-verse scroll-mt-28 cursor-pointer rounded px-1 transition ${
                        colour && colour.id !== "none" ? "" : "hover:bg-gold-soft/40"
                      } ${focusVerse === row.verse ? (dark ? "bg-white/12" : "bg-gold-soft") : ""} ${
                        target?.verse === row.verse ? (dark ? "bg-white/15" : "bg-gold-soft/70") : ""
                      }`}
                      style={colour && colour.id !== "none" ? { backgroundColor: colour.swatch } : undefined}
                    >
                      <sup className="mr-1 select-none text-[0.62em] font-bold text-gold">{row.verse}</sup>
                      {row.text}
                      {favourites.some((item) => item.id === key) ? (
                        <Heart size={10} className="ml-1 inline-block align-middle text-terracotta" fill="currentColor" />
                      ) : null}
                    </p>
                  );
                })}
              </div>
            )}

            <p className={`mt-6 text-center text-[11px] ${dark ? "text-white/55" : "text-ink-muted"}`}>
              {activeBible ? `${activeBible.name} · ${activeBible.language}` : "No translation selected"}
            </p>
          </div>
        </div>

        <div className={`flex flex-col gap-3 border-t px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-7 ${hairline}`}>
          <p className={`text-[11px] ${dark ? "text-white/55" : "text-ink-muted"}`}>
            {currentBook ? `${verses.length} verses · ${currentBook.chapterCount} chapters in this book` : "—"}
          </p>
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={copyPassage} className={`rounded-lg px-2.5 py-1.5 text-[11px] font-semibold ${chip}`}>
              {copied ? "Copied" : "Copy passage"}
            </button>
            <button
              type="button"
              onClick={() => {
                toggleBookmark(null, chapterText);
                say(bookmarks.some((item) => item.id === `${versionId}:${book}:${chapter}:0`) ? "Chapter removed from bookmarks" : "Chapter bookmarked");
              }}
              aria-pressed={bookmarks.some((item) => item.id === `${versionId}:${book}:${chapter}:0`)}
              className={`rounded-lg px-2.5 py-1.5 text-[11px] font-semibold ${chip}`}
            >
              <Bookmark size={11} className="mr-1 inline align-[-1px]" />
              Save this chapter
            </button>
          </div>
        </div>

      </section>

      {/*
        The action bar and the toast are portalled to <body>. They are
        `position: fixed`, and any transformed ancestor — the page's fade-up
        wrapper, for one — becomes their containing block instead of the
        viewport, which puts them thousands of pixels off screen.
      */}
      {target && typeof document !== "undefined"
        ? createPortal(
            <>
          <button
            type="button"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setTarget(null)}
            aria-label="Close verse actions"
          />
          <div
            role="dialog"
            aria-label={`Actions for ${book} ${chapter}:${target.verse}`}
            className="fixed z-50 w-[330px] max-w-[calc(100vw-24px)] rounded-2xl border border-line bg-surface p-2.5 text-ink shadow-player"
            style={{ left: target.left, top: target.top }}
          >
            <div className="flex items-center gap-1.5">
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-gold-soft text-[11px] font-bold text-gold">
                {target.verse}
              </span>
              <p className="min-w-0 flex-1 truncate text-[11px] font-semibold text-ink-muted">
                {book} {chapter}:{target.verse}
              </p>
              <button
                type="button"
                onClick={() => setTarget(null)}
                className="grid size-7 shrink-0 place-items-center rounded-lg text-ink-muted transition hover:bg-surface-soft"
                aria-label="Close"
              >
                <X size={13} />
              </button>
            </div>
            <div className="mt-2 flex items-center gap-1">
              <ActionButton
                label="Favourite"
                onClick={() => {
                  toggleFavourite(target.verse, target.text);
                  say(isFavourite(verseKey(chapter, target.verse)) ? "Favourite removed" : "Saved to favourites");
                }}
                active={isFavourite(verseKey(chapter, target.verse))}
                icon={<Heart size={15} fill={isFavourite(verseKey(chapter, target.verse)) ? "currentColor" : "none"} />}
              />
              <ActionButton
                label="Copy"
                onClick={() => {
                  const text = `${book} ${chapter}:${target.verse}\n${target.text}`;
                  if (navigator.clipboard) navigator.clipboard.writeText(text);
                  say("Verse copied");
                }}
                icon={<Copy size={15} />}
              />
              <ActionButton
                label="Share"
                onClick={() => void shareVerse()}
                icon={<Share2 size={15} />}
              />
              <span className="ml-auto flex items-center gap-1" title="Highlight colour">
                <Highlighter size={13} className="text-ink-muted" />
                {HIGHLIGHT_COLOURS.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => setHighlight(entry.id)}
                    aria-label={entry.label}
                    aria-pressed={highlights[verseKey(chapter, target.verse)] === entry.id}
                    className={`size-5 rounded-full border transition ${
                      entry.id === "none" ? "border-line bg-surface-soft" : "border-black/10"
                    } ${highlights[verseKey(chapter, target.verse)] === entry.id ? "ring-2 ring-gold ring-offset-1" : ""}`}
                    style={entry.id === "none" ? undefined : { backgroundColor: entry.swatch }}
                  />
                ))}
              </span>
            </div>
          </div>
            </>,
            document.body,
          )
        : null}

      {toast && typeof document !== "undefined"
        ? createPortal(
            <div
              role="status"
              className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex justify-center lg:bottom-6"
            >
              <span className="rounded-full bg-ink-fill px-3.5 py-2 text-[12px] font-semibold text-white shadow-player">{toast}</span>
            </div>,
            document.body,
          )
        : null}

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <SavedCard
          title="Your bookmarks"
          empty="Chapters you bookmark appear here."
          icon={<Bookmark size={17} />}
          items={bookmarks}
          ready={storeReady}
          lead={
            storeReady && place ? (
              <button
                type="button"
                onClick={() => {
                  setVersionId(place.versionId);
                  setBook(place.book);
                  setChapter(place.chapter);
                  document.getElementById("bible-reader")?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
                className="mt-4 flex w-full items-center gap-2.5 rounded-2xl bg-gold-soft p-3 text-left transition hover:bg-gold-soft/70"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-gold/20 text-gold">
                  <Bookmark size={16} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-semibold text-ink">Continue reading</span>
                  <span className="mt-0.5 block text-xs text-ink-muted">
                    {place.book} {place.chapter}
                  </span>
                </span>
                <ChevronRight size={16} className="shrink-0 text-gold" />
              </button>
            ) : null
          }
          onRemove={(id) => {
            const next = bookmarks.filter((item) => item.id !== id);
            setBookmarks(next);
            writeStore(BOOKMARKS_KEY, next);
          }}
          onOpen={(item) => {
            // Bookmarks are either a whole chapter or a single verse, so the
            // verse is the optional fourth field of the id.
            const [version, itemBook, itemChapter, itemVerse] = item.id.split(":");
            setVersionId(version);
            setBook(itemBook);
            setChapter(Number(itemChapter));
            setFocusVerse(itemVerse ? Number(itemVerse) : null);
            document.getElementById("bible-reader")?.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
        />
        <SavedCard
          title="Favourite verses"
          empty="Tap the heart beside any verse to keep it here."
          icon={<Heart size={17} />}
          items={favourites}
          ready={storeReady}
          onRemove={(id) => {
            const next = favourites.filter((item) => item.id !== id);
            setFavourites(next);
            writeStore(FAVOURITES_KEY, next);
          }}
          onOpen={(item) => {
            const [version, itemBook, itemChapter, itemVerse] = item.id.split(":");
            setVersionId(version);
            setBook(itemBook);
            setChapter(Number(itemChapter));
            setFocusVerse(Number(itemVerse));
            document.getElementById("bible-reader")?.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
        />
      </div>

      {/*
        The pad. It floats over the column rather than sitting in it, because
        reading and writing at the same time is the whole point — a note box in
        the layout would push the verses it is about off the screen. It points at
        the book, and each note carries its chapter, so a reader who works through
        a Gospel collects one trail instead of a trail per chapter.
      */}
      {currentBook ? (
        <FloatingNotes
          surface="bible"
          itemType="bible_book"
          itemId={currentBook.id}
          subject={`${currentBook.name} ${chapter}`}
          reference={`${currentBook.name} ${chapter}`}
          label="Chapter notes"
        />
      ) : null}
    </div>
  );
}

function ActionButton({
  label,
  icon,
  onClick,
  active,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex items-center gap-1.5 rounded-xl px-2.5 py-2 text-[12px] font-semibold transition ${
        active ? "bg-terracotta-soft text-terracotta" : "bg-surface-soft text-ink-soft hover:bg-gold-soft hover:text-gold"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function SavedCard({
  title,
  empty,
  icon,
  items,
  ready,
  lead,
  onRemove,
  onOpen,
}: {
  title: string;
  empty: string;
  icon: React.ReactNode;
  items: SavedVerse[];
  ready: boolean;
  lead?: React.ReactNode;
  onRemove: (id: string) => void;
  onOpen: (item: SavedVerse) => void;
}) {
  return (
    <div className="rounded-[24px] border border-line bg-surface p-5 shadow-soft">
      <div className="flex items-center gap-2">
        <span className="text-gold">{icon}</span>
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-gold">{title}</p>
      </div>
      {lead}
      {!ready ? (
        <p className="mt-3 text-sm text-ink-muted">Loading…</p>
      ) : items.length === 0 ? (
        <p className="mt-3 text-sm leading-6 text-ink-muted">{empty}</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {items.slice(0, 6).map((item) => (
            <li key={item.id} className="flex items-start gap-2 rounded-2xl bg-surface-soft p-3">
              <button type="button" onClick={() => onOpen(item)} className="min-w-0 flex-1 text-left">
                <span className="block text-[13px] font-semibold text-ink">{item.reference}</span>
                <span className="mt-0.5 block line-clamp-2 text-xs leading-5 text-ink-muted">{item.text}</span>
              </button>
              <button
                type="button"
                onClick={() => onRemove(item.id)}
                className="grid size-6 shrink-0 place-items-center rounded-full text-ink-muted transition hover:bg-terracotta-soft hover:text-terracotta"
                aria-label={`Remove ${item.reference}`}
              >
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function BookOpenIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5z" />
      <path d="M4 5.5v16M8 7h8M8 11h8" />
    </svg>
  );
}
