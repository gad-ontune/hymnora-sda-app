"use client";

/**
 * Saved items, as a real store rather than component state.
 *
 * Favourites are written from four places — the heart on a track card, the heart
 * on a video, the one in the player, and the Library page that lists them — and
 * every one of them needs to see the others' writes. That rules out holding them
 * in a single component's `useState`, and rules out `useSyncExternalStore` reading
 * `localStorage` directly, because its `getSnapshot` is called on every render and
 * parsing JSON each time is both slow and an infinite-loop hazard.
 *
 * So the snapshot is cached here and invalidated on write, which is the one
 * contract `useSyncExternalStore` actually requires. On the server it returns
 * `null`, so a page that renders a favourites count hydrates against "no
 * favourites" and then corrects itself, rather than warning about a mismatch.
 */

import { useSyncExternalStore } from "react";

const STORAGE_KEY = "hymnora-favorites";

type Listener = () => void;

let cached: string[] | null = null;
const listeners = new Set<Listener>();

function read(): string[] {
  if (cached) return cached;
  let parsed: unknown = [];
  try {
    parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]");
  } catch {
    // Corrupt or blocked storage. An empty library is a fine way to fail.
    parsed = [];
  }
  cached = Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  return cached;
}

function write(next: string[]): void {
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
  // Another tab saved something; this one has not been told yet.
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

/** `null` on the server, so hydration does not claim a count it cannot know. */
const serverSnapshot = () => null;

export function useFavorites(): string[] {
  return useSyncExternalStore(subscribe, read, serverSnapshot) ?? [];
}

export function isFavoriteSync(id: string): boolean {
  return read().includes(id);
}

export function toggleFavoriteSync(id: string): void {
  const current = read();
  write(current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
}
