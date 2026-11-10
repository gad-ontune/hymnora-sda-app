"use client";

/**
 * What you have played, and how far in.
 *
 * This exists so the music page can show a "Continue listening" shelf and a
 * "Recently played" one without inventing either. It is the same store shape as
 * `favorites.ts` and for the same reasons: several components read it, it is
 * written from the one place playback starts, and `useSyncExternalStore` calls
 * `getSnapshot` on every render, so the parsed value is cached and only
 * invalidated on write.
 *
 * Position is stored because "Continue listening" is a claim about a moment
 * *inside* a song. Shelling out a shelf of songs you have already finished is not
 * a continuation, and a shelf with no position cannot restart a half-heard verse.
 *
 * The list is a bounded ring: 40 entries is more than anyone scrolls, and it
 * keeps the storage payload small on the low-end devices this app targets.
 */

import { useSyncExternalStore } from "react";

const STORAGE_KEY = "hymnora-history";
const MAX_ENTRIES = 40;

export type HistoryEntry = {
  id: string;
  title: string;
  artist: string;
  image: string;
  duration: string;
  /** Seconds into the track when it was last paused or left. */
  position: number;
  /** Epoch ms, most recent first. */
  at: number;
};

type Listener = () => void;

let cached: HistoryEntry[] | null = null;
const listeners = new Set<Listener>();

function isEntry(value: unknown): value is HistoryEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.id === "string" &&
    typeof entry.title === "string" &&
    typeof entry.position === "number" &&
    typeof entry.at === "number"
  );
}

function read(): HistoryEntry[] {
  if (cached) return cached;
  let parsed: unknown = [];
  try {
    parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]");
  } catch {
    parsed = [];
  }
  cached = Array.isArray(parsed)
    ? parsed.filter(isEntry).map((entry) => ({
        id: entry.id,
        title: entry.title,
        artist: typeof entry.artist === "string" ? entry.artist : "",
        image: typeof entry.image === "string" ? entry.image : "",
        duration: typeof entry.duration === "string" ? entry.duration : "",
        position: entry.position,
        at: entry.at,
      }))
    : [];
  return cached;
}

function write(next: HistoryEntry[]): void {
  cached = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* The list still works for this session. */
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return;
    cached = null;
    for (const each of listeners) each();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

const serverSnapshot = () => null;

/** Most recent first. `[]` on the server, so hydration cannot claim a count. */
export function useHistory(): HistoryEntry[] {
  return useSyncExternalStore(subscribe, read, serverSnapshot) ?? [];
}

/**
 * Records that a track started, or that its position moved.
 *
 * Replaying a track moves it to the front rather than adding a second entry, so
 * the shelf reads as a history of songs rather than a log of button presses.
 */
export function recordPlayed(track: {
  id: string;
  title: string;
  artist: string;
  image: string;
  duration: string;
}, position = 0): void {
  if (typeof window === "undefined") return;
  const current = read();
  const next: HistoryEntry[] = [
    { ...track, position: Math.max(0, Math.round(position)), at: Date.now() },
    ...current.filter((entry) => entry.id !== track.id),
  ];
  write(next.slice(0, MAX_ENTRIES));
}

/** Saves progress on an existing entry without reordering it. */
export function recordPosition(id: string, position: number): void {
  if (typeof window === "undefined") return;
  const current = read();
  const index = current.findIndex((entry) => entry.id === id);
  if (index === -1) return;
  const next = [...current];
  next[index] = { ...next[index]!, position: Math.max(0, Math.round(position)), at: Date.now() };
  write(next);
}

export function clearHistory(): void {
  write([]);
}
