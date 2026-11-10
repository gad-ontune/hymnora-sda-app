"use client";

/**
 * Notes, and the drafts that come before they are notes.
 *
 * The server already owns notes — `notes` in the library module, keyed by
 * `item_type` + `item_id`, with a `reference` for the chapter or verse and a
 * `timestamp_seconds` for a moment in a sermon. This is the client half of that,
 * plus one thing the server cannot do: hold the words a reader has typed but not
 * yet saved.
 *
 * The draft is the important part. A notepad that empties itself when the reader
 * signs out, or when they have not signed in at all, is not a notepad — it is a
 * form. So the text always lives on the device first and the server second, and
 * a reader who never signs in still finds their notes in the same place
 * tomorrow. The drafts are keyed by the same `itemType:itemId` the server uses,
 * so a draft saved after signing in and the server's own copy meet at the same
 * key rather than needing a merge.
 */

import { useSyncExternalStore } from "react";
import { authedFetch } from "@/lib/session";
import {
  clampNotesGeometry,
  defaultNotesGeometry,
  normaliseNotesGeometry,
  UNPLACED_GEOMETRY,
  type NotesGeometry,
  type NotesSize,
  type Viewport,
} from "@/lib/notes-geometry";

export type NoteItemType =
  | "track"
  | "hymn"
  | "sermon"
  | "news"
  | "church"
  | "event"
  | "video"
  | "collection"
  | "bible_verse"
  | "bible_book"
  | "live_stream"
  | "ministry";

export type Note = {
  id: string;
  itemType: NoteItemType;
  itemId: string;
  itemTitle: string;
  body: string;
  timestampSeconds: number | null;
  reference: string | null;
  createdAt: string;
  updatedAt: string;
};

const DRAFT_KEY = "hymnora-note-drafts";

/** One scratchpad per thing being read. Never grows unbounded: a chapter each. */
type Draft = { body: string; reference: string | null; timestampSeconds: number | null; savedAt: number };

let cached: Record<string, Draft> | null = null;
const listeners = new Set<() => void>();

function readAll(): Record<string, Draft> {
  if (cached) return cached;
  let parsed: unknown = {};
  try {
    parsed = JSON.parse(window.localStorage.getItem(DRAFT_KEY) ?? "{}");
  } catch {
    parsed = {};
  }
  cached = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, Draft>) : {};
  return cached;
}

function writeAll(next: Record<string, Draft>): void {
  cached = next;
  try {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify(next));
  } catch {
    /* Private mode, or storage full. The pad still works for this session. */
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== DRAFT_KEY) return;
    cached = null;
    for (const each of listeners) each();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** `null` on the server: the draft board is this device's, and the server's HTML
 *  must not claim otherwise. */
const serverSnapshot = () => null;

export const draftKey = (itemType: NoteItemType, itemId: string) => `${itemType}:${itemId}`;

export function useNoteDraft(itemType: NoteItemType, itemId: string): Draft {
  const all = useSyncExternalStore(subscribe, readAll, serverSnapshot) ?? {};
  return all[draftKey(itemType, itemId)] ?? { body: "", reference: null, timestampSeconds: null, savedAt: 0 };
}

export function readNoteDraft(itemType: NoteItemType, itemId: string): Draft {
  if (typeof window === "undefined") return { body: "", reference: null, timestampSeconds: null, savedAt: 0 };
  return readAll()[draftKey(itemType, itemId)] ?? { body: "", reference: null, timestampSeconds: null, savedAt: 0 };
}

export function writeNoteDraft(itemType: NoteItemType, itemId: string, draft: Draft): void {
  const key = draftKey(itemType, itemId);
  const all = { ...readAll() };
  if (!draft.body.trim() && !draft.reference && draft.timestampSeconds === null) delete all[key];
  else all[key] = draft;
  writeAll(all);
}

export function clearNoteDraft(itemType: NoteItemType, itemId: string): void {
  const all = { ...readAll() };
  delete all[draftKey(itemType, itemId)];
  writeAll(all);
}

// ─── The server's own notes ───────────────────────────────────────────────────

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await authedFetch(`/api/library${path}`, init);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message ?? `Could not reach your notes (${res.status})`);
  }
  return res;
}

export async function getNotes(itemType: NoteItemType, itemId?: string): Promise<Note[]> {
  const query = new URLSearchParams({ itemType });
  if (itemId) query.set("itemId", itemId);
  const res = await request(`/notes?${query.toString()}`);
  const notes = (await res.json()) as Note[];
  // The API filters by type only, so the narrow half of the filter is here.
  return itemId ? notes.filter((note) => note.itemId === itemId) : notes;
}

export async function createNote(input: {
  itemType: NoteItemType;
  itemId: string;
  body: string;
  reference?: string | null;
  timestampSeconds?: number | null;
}): Promise<Note> {
  const res = await request("/notes", {
    method: "POST",
    body: JSON.stringify({
      itemType: input.itemType,
      itemId: input.itemId,
      body: input.body,
      reference: input.reference ?? null,
      timestampSeconds: input.timestampSeconds ?? null,
    }),
  });
  return res.json();
}

export async function updateNote(
  id: string,
  patch: { body?: string; reference?: string | null; timestampSeconds?: number | null },
): Promise<Note> {
  const res = await request(`/notes/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) });
  return res.json();
}

export async function deleteNote(id: string): Promise<void> {
  await request(`/notes/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/** True when there is a session to save a note to. */
export { hasSession as hasNoteAccount } from "@/lib/session";

// ─── Where the pad sits ───────────────────────────────────────────────────────

/**
 * The pad is placed by the reader, and the placement is theirs to keep.
 *
 * Position, size and whether it is cropped live in `localStorage` per surface,
 * because a sermon and a chapter want the pad in different places and neither
 * wants it re-explained. The arithmetic — and what happens to a placement saved
 * on a desktop when the pad is opened on a phone — is in `notes-geometry.ts`,
 * where it can be tested without a browser.
 */
const GEOMETRY_KEY = "hymnora-notes-geometry";

type GeometryMap = Record<string, NotesGeometry>;

let cachedGeometry: GeometryMap | null = null;
const geometryListeners = new Set<() => void>();

const viewport = (): Viewport => ({ width: window.innerWidth, height: window.innerHeight });

function readGeometryMap(): GeometryMap {
  if (cachedGeometry) return cachedGeometry;
  let parsed: unknown = {};
  try {
    parsed = JSON.parse(window.localStorage.getItem(GEOMETRY_KEY) ?? "{}");
  } catch {
    parsed = {};
  }
  cachedGeometry = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as GeometryMap) : {};
  return cachedGeometry;
}

function notifyGeometry(): void {
  for (const listener of geometryListeners) listener();
}

function subscribeGeometry(listener: () => void): () => void {
  geometryListeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== GEOMETRY_KEY) return;
    cachedGeometry = null;
    notifyGeometry();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    geometryListeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/**
 * The current placement, answered with the *same object* every time until it
 * really changes.
 *
 * That matters: `useSyncExternalStore` compares snapshots with `Object.is`, and
 * a snapshot built fresh on every read is a change on every render — an
 * infinite loop that shows up as a page that will not sit still. So the clamped
 * default is cached on the way in and written back on the first drag, rather
 * than being recomputed per call.
 */
export function readNotesGeometry(surface: string): NotesGeometry {
  if (typeof window === "undefined") return UNPLACED_GEOMETRY;
  const map = readGeometryMap();
  const stored = map[surface];
  if (stored && stored.placed && typeof stored.x === "number") {
    // An older placement predates crop sizes. Normalised, then cached back —
    // never rebuilt per read, which would be a new snapshot every render.
    const migrated = normaliseNotesGeometry(stored);
    if (migrated === stored) return stored;
    cachedGeometry = { ...map, [surface]: migrated };
    return migrated;
  }
  const fresh = clampNotesGeometry(defaultNotesGeometry(viewport()), viewport());
  cachedGeometry = { ...map, [surface]: fresh };
  return fresh;
}

/**
 * `persist: false` moves the pad without touching storage, which is what a drag
 * needs: writing on every pointer move would put a hundred writes a second into
 * `localStorage` for a movement the eye cannot see. The release writes it once.
 *
 * `size` is what the placement is clamped against: the *visible* size. The open
 * pad clamps to the working size; the cropped icon clamps to its own forty
 * pixels, which is what lets it be dragged down to the bottom of the screen.
 */
export function setNotesGeometry(surface: string, patch: Partial<NotesGeometry>, persist = true, size?: NotesSize): void {
  if (typeof window === "undefined") return;
  const next = clampNotesGeometry({ ...readNotesGeometry(surface), ...patch }, viewport(), size);
  cachedGeometry = { ...readGeometryMap(), [surface]: next };
  if (persist) {
    try {
      window.localStorage.setItem(GEOMETRY_KEY, JSON.stringify(cachedGeometry));
    } catch {
      /* The placement still holds for this session. */
    }
  }
  notifyGeometry();
}

/** Back to the default corner, for the pad's "put it back" control. */
export function resetNotesGeometry(surface: string): void {
  if (typeof window === "undefined") return;
  setNotesGeometry(surface, defaultNotesGeometry(viewport()));
}

export function useNotesGeometry(surface: string): NotesGeometry {
  return useSyncExternalStore(
    subscribeGeometry,
    () => readNotesGeometry(surface),
    () => UNPLACED_GEOMETRY,
  );
}
