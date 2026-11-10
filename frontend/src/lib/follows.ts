"use client";

/**
 * Followed things — churches, choirs, ministries, creators, topics and regions.
 *
 * Same shape of problem as favourites: the Follow button lives on a reel, a
 * church card, an article and the Following feed at the same time, and all of
 * them have to agree. So this is a `useSyncExternalStore` store with a cached
 * snapshot, not component state, and it keys on a namespaced id
 * (`creator:Nairobi Central SDA Church`) so a channel and a topic can share a
 * label without colliding.
 *
 * A label and a kind ride along with each id because the Following feed has to
 * render "Nairobi Central SDA Church" and "Worship" without a second lookup,
 * and because the label is what makes the store human-readable in devtools.
 */

import { useSyncExternalStore } from "react";

const STORAGE_KEY = "hymnora-follows";

export type FollowKind = "creator" | "choir" | "church" | "ministry" | "topic" | "region";

export type FollowEntry = { id: string; label: string; kind: FollowKind };

type Listener = () => void;

let cached: FollowEntry[] | null = null;
const listeners = new Set<Listener>();

const KINDS: FollowKind[] = ["creator", "choir", "church", "ministry", "topic", "region"];

/** Anything that came from storage is untrusted: keep only well-formed rows. */
function normalize(value: unknown): FollowEntry[] {
  if (!Array.isArray(value)) return [];
  const entries: FollowEntry[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (typeof record.id !== "string" || record.id.length === 0) continue;
    if (typeof record.label !== "string") continue;
    const kind = KINDS.includes(record.kind as FollowKind) ? (record.kind as FollowKind) : "creator";
    entries.push({ id: record.id, label: record.label, kind });
  }
  return entries;
}

function read(): FollowEntry[] {
  if (cached) return cached;
  let parsed: unknown = [];
  try {
    parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]");
  } catch {
    parsed = [];
  }
  cached = normalize(parsed);
  return cached;
}

function write(next: FollowEntry[]): void {
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

export function useFollows(): FollowEntry[] {
  return useSyncExternalStore(subscribe, read, serverSnapshot) ?? [];
}

export function isFollowingSync(id: string): boolean {
  return read().some((entry) => entry.id === id);
}

export function toggleFollowSync(entry: FollowEntry): void {
  const current = read();
  write(
    current.some((item) => item.id === entry.id)
      ? current.filter((item) => item.id !== entry.id)
      : [...current, entry],
  );
}

/** Follows of one kind, for the Following feed's "who you follow" summary. */
export function followsOfKind(entries: FollowEntry[], kind: FollowKind): FollowEntry[] {
  return entries.filter((entry) => entry.kind === kind);
}
