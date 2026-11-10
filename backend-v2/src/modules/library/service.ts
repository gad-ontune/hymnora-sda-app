import { z } from "zod";
import { all, get, run, placeholders, type Row } from "../../db/client.ts";
import { notFound, unprocessable } from "../../lib/errors.ts";
import { newId } from "../../lib/http.ts";
import { formatDay, formatDuration, formatEventTime, formatLiveTime, formatMonth } from "../../lib/time.ts";
import { readingMinutes } from "../../lib/text.ts";
import { CONTENT_TYPES, type ContentType } from "../../types/domain.ts";
import { findBookById, findVerseById } from "../bible/service.ts";
import type { Note, Playlist, PlaylistItem } from "../../types/domain.ts";

/**
 * Library rows are polymorphic: `item_type` + `item_id` point at whatever kind
 * of content the user saved. The tables store no titles, so every read path has
 * to resolve the target — that hydration is what this module centralises.
 *
 * Each resolver returns a uniform `{ title, subtitle, image, durationSeconds }`
 * so the library can render a mixed list without branching per row.
 */

export type ResolvedItem = {
  title: string;
  subtitle: string;
  image: string;
  durationSeconds: number;
  href: string;
};

const contentTypeSchema = z.enum(CONTENT_TYPES as [ContentType, ...ContentType[]]);

function emptyResolved(): ResolvedItem {
  return { title: "Unavailable", subtitle: "", image: "", durationSeconds: 0, href: "" };
}

/** Batch-resolves ids of one type, returning a lookup keyed by id. */
function resolveMany(type: ContentType, ids: string[]): Map<string, ResolvedItem> {
  const map = new Map<string, ResolvedItem>();
  if (ids.length === 0) return map;
  const marks = placeholders(ids.length);

  if (type === "track" || type === "video") {
    const rows = all<Row & { id: string; title: string; artist: string; image: string; duration_seconds: number; kind: string }>(
      `SELECT id, title, artist, image, duration_seconds, kind FROM tracks
       WHERE deleted_at IS NULL AND id IN (${marks})`,
      ids,
    );
    for (const row of rows) {
      map.set(row.id, {
        title: row.title,
        subtitle: row.artist,
        image: row.image,
        durationSeconds: Number(row.duration_seconds ?? 0),
        href: row.kind === "video" ? `/videos/${row.id}` : `/music/${row.id}`,
      });
    }
  } else if (type === "hymn") {
    const rows = all<Row & { id: string; title: string; number: string; image: string; duration_seconds: number }>(
      `SELECT id, title, number, image, duration_seconds FROM hymns
       WHERE deleted_at IS NULL AND id IN (${marks})`,
      ids,
    );
    for (const row of rows) {
      map.set(row.id, {
        title: row.title,
        subtitle: `Hymn ${row.number}`,
        image: row.image,
        durationSeconds: Number(row.duration_seconds ?? 0),
        href: `/hymns/${row.id}`,
      });
    }
  } else if (type === "sermon") {
    const rows = all<Row & { id: string; title: string; speaker: string; image: string; duration_seconds: number }>(
      `SELECT id, title, speaker, image, duration_seconds FROM sermons
       WHERE deleted_at IS NULL AND id IN (${marks})`,
      ids,
    );
    for (const row of rows) {
      map.set(row.id, {
        title: row.title,
        subtitle: row.speaker,
        image: row.image,
        durationSeconds: Number(row.duration_seconds ?? 0),
        href: `/sermons/${row.id}`,
      });
    }
  } else if (type === "news") {
    const rows = all<Row & { id: string; title: string; category: string; image: string; excerpt: string; body: string | null; slug: string }>(
      `SELECT id, title, category, image, excerpt, body, slug FROM news_articles
       WHERE deleted_at IS NULL AND id IN (${marks})`,
      ids,
    );
    for (const row of rows) {
      map.set(row.id, {
        title: row.title,
        subtitle: row.category,
        image: row.image,
        // Articles have no intrinsic duration; report the estimated read time
        // in seconds so the shared formatter can render it.
        durationSeconds: readingMinutes(row.body) * 60,
        href: `/news/${row.slug}`,
      });
    }
  } else if (type === "church") {
    const rows = all<Row & { id: string; name: string; city: string; country: string; image: string; service: string }>(
      `SELECT id, name, city, country, image, service FROM churches
       WHERE deleted_at IS NULL AND id IN (${marks})`,
      ids,
    );
    for (const row of rows) {
      map.set(row.id, {
        title: row.name,
        subtitle: [row.city, row.country].filter(Boolean).join(", "),
        image: row.image,
        durationSeconds: 0,
        href: `/churches/${row.id}`,
      });
    }
  } else if (type === "event") {
    const rows = all<Row & { id: string; title: string; place: string; image: string; starts_at: string; duration_days: number; is_live: number }>(
      `SELECT id, title, place, image, starts_at, duration_days, is_live FROM events
       WHERE deleted_at IS NULL AND id IN (${marks})`,
      ids,
    );
    for (const row of rows) {
      map.set(row.id, {
        title: row.title,
        subtitle: `${formatDay(row.starts_at)} ${formatMonth(row.starts_at)} · ${formatEventTime(row.starts_at, Number(row.duration_days))}`,
        image: row.image,
        durationSeconds: 0,
        href: `/events/${row.id}`,
      });
    }
  } else if (type === "bible_verse") {
    // Resolved one at a time, and through the chapter store rather than a join:
    // the compressed chapter blob is where the reader's text actually lives, and
    // a note on a verse has to carry the verse it belongs to.
    for (const id of ids) {
      const verse = findVerseById(id);
      if (!verse) continue;
      map.set(id, {
        title: `${verse.book} ${verse.chapter}:${verse.verse}`,
        subtitle: verse.text,
        image: "",
        durationSeconds: 0,
        href: `/bible?book=${encodeURIComponent(verse.book)}&chapter=${verse.chapter}&verse=${verse.verse}`,
      });
    }
  } else if (type === "bible_book") {
    for (const id of ids) {
      const book = findBookById(id);
      if (!book) continue;
      map.set(id, {
        title: book.name,
        subtitle: `${book.testament} Testament · ${book.chapterCount} chapters`,
        image: "",
        durationSeconds: 0,
        href: `/bible?book=${encodeURIComponent(book.name)}`,
      });
    }
  } else if (type === "live_stream") {
    const rows = all<Row & { id: string; title: string; church_name: string; image: string; status: string; starts_at: string | null; viewer_count: number }>(
      `SELECT id, title, church_name, image, status, starts_at, viewer_count FROM live_streams WHERE id IN (${marks})`,
      ids,
    );
    for (const row of rows) {
      map.set(row.id, {
        title: row.title,
        subtitle: `${row.church_name} · ${formatLiveTime(row.starts_at, row.status)}`,
        image: row.image,
        durationSeconds: 0,
        href: `/live/${row.id}`,
      });
    }
  }
  return map;
}

/**
 * Resolves ids grouped by type, so a mixed list costs one query per type.
 *
 * Takes the raw `item_type`/`item_id` column pair every library table shares,
 * which means callers can pass their query rows straight through.
 */
function resolveGrouped(entries: { item_type: string; item_id: string }[]): Map<string, ResolvedItem> {
  const byType = new Map<string, string[]>();
  for (const entry of entries) {
    const bucket = byType.get(entry.item_type);
    if (bucket) bucket.push(entry.item_id);
    else byType.set(entry.item_type, [entry.item_id]);
  }
  const resolved = new Map<string, ResolvedItem>();
  for (const [type, ids] of byType) {
    for (const [id, item] of resolveMany(type as ContentType, ids)) resolved.set(`${type}:${id}`, item);
  }
  return resolved;
}

function resolveOne(type: string, id: string): ResolvedItem {
  return resolveMany(type as ContentType, [id]).get(id) ?? emptyResolved();
}

/** Confirms the target row actually exists before it is saved or annotated. */
export function assertItemExists(type: string, id: string): void {
  if (resolveOne(type, id).title === "Unavailable") {
    throw unprocessable(`No ${type} with the id "${id}" exists`, { field: "itemId" });
  }
}

// ─── Favorites ───────────────────────────────────────────────────────────────

type FavoriteRow = Row & { item_type: string; item_id: string; created_at: string };

export function listFavorites(
  userId: string,
  itemType?: string,
  limit = 50,
  offset = 0,
): { items: { itemType: ContentType; itemId: string; title: string; subtitle: string; image: string; duration: string; createdAt: string }[]; total: number } {
  const params: (string | number)[] = [userId];
  let where = "user_id = ?";
  if (itemType) {
    where += " AND item_type = ?";
    params.push(itemType);
  }
  const rows = all<FavoriteRow>(
    `SELECT item_type, item_id, created_at FROM favorites WHERE ${where}
     ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  const total = Number(
    get<{ total: number }>(`SELECT COUNT(*) AS total FROM favorites WHERE ${where}`, params)?.total ?? 0,
  );
  const resolved = resolveGrouped(rows);
  return {
    items: rows.map((row) => {
      const item = resolved.get(`${row.item_type}:${row.item_id}`) ?? emptyResolved();
      return {
        itemType: row.item_type as ContentType,
        itemId: row.item_id,
        title: item.title,
        subtitle: item.subtitle,
        image: item.image,
        duration: formatDuration(item.durationSeconds),
        createdAt: row.created_at,
      };
    }),
    total,
  };
}

export function addFavorite(userId: string, itemType: string, itemId: string): { favorited: boolean } {
  assertItemExists(itemType, itemId);
  run(
    "INSERT INTO favorites (user_id, item_type, item_id) VALUES (?, ?, ?) ON CONFLICT(user_id, item_type, item_id) DO NOTHING",
    [userId, itemType, itemId],
  );
  return { favorited: true };
}

export function removeFavorite(userId: string, itemType: string, itemId: string): { favorited: boolean } {
  run("DELETE FROM favorites WHERE user_id = ? AND item_type = ? AND item_id = ?", [userId, itemType, itemId]);
  return { favorited: false };
}

export function isFavorite(userId: string, itemType: string, itemId: string): boolean {
  return Boolean(get("SELECT 1 FROM favorites WHERE user_id = ? AND item_type = ? AND item_id = ?", [userId, itemType, itemId]));
}

/** Ids the user has favourited of one type — lets a list render hearts inline. */
export function favoriteIds(userId: string, itemType: string, ids: string[]): Set<string> {
  if (ids.length === 0) return new Set();
  const rows = all<{ item_id: string }>(
    `SELECT item_id FROM favorites WHERE user_id = ? AND item_type = ? AND item_id IN (${placeholders(ids.length)})`,
    [userId, itemType, ...ids],
  );
  return new Set(rows.map((row) => row.item_id));
}

// ─── Playlists ───────────────────────────────────────────────────────────────

type PlaylistRow = Row & {
  id: string;
  title: string;
  description: string | null;
  cover_url: string | null;
  is_public: number;
  item_count: number;
  total_duration_seconds: number;
  created_at: string;
  updated_at: string;
};

function toPlaylist(row: PlaylistRow, items: PlaylistItem[]): Playlist {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    coverUrl: row.cover_url,
    isPublic: row.is_public === 1,
    itemCount: Number(row.item_count ?? items.length),
    totalDurationSeconds: Number(row.total_duration_seconds ?? 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    items,
  };
}

type PlaylistItemRow = Row & {
  id: string;
  item_type: string;
  item_id: string;
  position: number;
  note: string | null;
  created_at: string;
};

function itemsForPlaylist(playlistId: string): PlaylistItem[] {
  const rows = all<PlaylistItemRow>(
    "SELECT id, item_type, item_id, position, note, created_at FROM playlist_items WHERE playlist_id = ? ORDER BY position",
    [playlistId],
  );
  const resolved = resolveGrouped(rows);
  return rows.map((row) => {
    const item = resolved.get(`${row.item_type}:${row.item_id}`) ?? emptyResolved();
    return {
      id: row.id,
      itemType: row.item_type as ContentType,
      itemId: row.item_id,
      position: Number(row.position),
      note: row.note,
      addedAt: row.created_at,
      title: item.title,
      subtitle: item.subtitle,
      image: item.image,
      duration: formatDuration(item.durationSeconds),
    };
  });
}

export function listPlaylists(userId: string): Playlist[] {
  const rows = all<PlaylistRow>(
    `SELECT id, title, description, cover_url, is_public, item_count, total_duration_seconds, created_at, updated_at
     FROM playlists WHERE user_id = ? ORDER BY updated_at DESC`,
    [userId],
  );
  return rows.map((row) => toPlaylist(row, itemsForPlaylist(String(row.id))));
}

export function findPlaylist(userId: string, id: string): Playlist {
  const row = get<PlaylistRow>(
    `SELECT id, title, description, cover_url, is_public, item_count, total_duration_seconds, created_at, updated_at
     FROM playlists WHERE id = ? AND (user_id = ? OR is_public = 1)`,
    [id, userId],
  );
  if (!row) throw notFound("Playlist");
  return toPlaylist(row, itemsForPlaylist(String(row.id)));
}

/** Recomputes the denormalised counters after any item mutation. */
function refreshPlaylistTotals(playlistId: string): void {
  const rows = all<{ item_type: string; item_id: string }>(
    "SELECT item_type, item_id FROM playlist_items WHERE playlist_id = ?",
    [playlistId],
  );
  const resolved = resolveGrouped(rows);
  let seconds = 0;
  for (const row of rows) {
    seconds += resolved.get(`${row.item_type}:${row.item_id}`)?.durationSeconds ?? 0;
  }
  run(
    `UPDATE playlists SET item_count = ?, total_duration_seconds = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE id = ?`,
    [rows.length, seconds, playlistId],
  );
}

export const playlistInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
  coverUrl: z.string().trim().max(400).nullable().optional(),
  isPublic: z.boolean().default(false),
});

export type PlaylistInput = z.output<typeof playlistInputSchema>;

export function createPlaylist(userId: string, input: PlaylistInput): Playlist {
  const id = newId();
  run(
    "INSERT INTO playlists (id, user_id, title, description, cover_url, is_public) VALUES (?, ?, ?, ?, ?, ?)",
    [id, userId, input.title, input.description ?? null, input.coverUrl ?? null, input.isPublic ? 1 : 0],
  );
  return findPlaylist(userId, id);
}

export function updatePlaylist(userId: string, id: string, input: Partial<PlaylistInput>): Playlist {
  const map: Record<string, string> = { title: "title", description: "description", coverUrl: "cover_url" };
  const assignments: string[] = [];
  const params: (string | number | null)[] = [];
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    if (key === "isPublic") {
      assignments.push("is_public = ?");
      params.push(value ? 1 : 0);
      continue;
    }
    const column = map[key];
    if (!column) continue;
    assignments.push(`${column} = ?`);
    params.push(value as string | null);
  }
  if (assignments.length > 0) {
    params.push(id, userId);
    const result = run(
      `UPDATE playlists SET ${assignments.join(", ")}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = ? AND user_id = ?`,
      params,
    );
    if (result.changes === 0) throw notFound("Playlist");
  }
  return findPlaylist(userId, id);
}

export function deletePlaylist(userId: string, id: string): void {
  const result = run("DELETE FROM playlists WHERE id = ? AND user_id = ?", [id, userId]);
  if (result.changes === 0) throw notFound("Playlist");
}

export function addPlaylistItem(userId: string, playlistId: string, itemType: string, itemId: string, note?: string): Playlist {
  const owned = get("SELECT 1 FROM playlists WHERE id = ? AND user_id = ?", [playlistId, userId]);
  if (!owned) throw notFound("Playlist");
  assertItemExists(itemType, itemId);
  const next = Number(
    get<{ next: number | null }>("SELECT MAX(position) + 1 AS next FROM playlist_items WHERE playlist_id = ?", [playlistId])?.next ?? 0,
  );
  run(
    `INSERT INTO playlist_items (id, playlist_id, item_type, item_id, position, note) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(playlist_id, item_type, item_id) DO UPDATE SET note = excluded.note`,
    [newId(), playlistId, itemType, itemId, next, note ?? null],
  );
  refreshPlaylistTotals(playlistId);
  return findPlaylist(userId, playlistId);
}

/** Replaces the whole item list — used by the drag-to-reorder editor. */
export function reorderPlaylist(userId: string, playlistId: string, items: { itemType: string; itemId: string; note?: string }[]): Playlist {
  const owned = get("SELECT 1 FROM playlists WHERE id = ? AND user_id = ?", [playlistId, userId]);
  if (!owned) throw notFound("Playlist");
  run("DELETE FROM playlist_items WHERE playlist_id = ?", [playlistId]);
  const seen = new Set<string>();
  items.forEach((item, position) => {
    const key = `${item.itemType}:${item.itemId}`;
    if (seen.has(key)) return; // a playlist cannot hold the same item twice
    seen.add(key);
    assertItemExists(item.itemType, item.itemId);
    run(
      "INSERT INTO playlist_items (id, playlist_id, item_type, item_id, position, note) VALUES (?, ?, ?, ?, ?, ?)",
      [newId(), playlistId, item.itemType, item.itemId, position, item.note ?? null],
    );
  });
  refreshPlaylistTotals(playlistId);
  return findPlaylist(userId, playlistId);
}

export function removePlaylistItem(userId: string, playlistId: string, itemType: string, itemId: string): Playlist {
  const owned = get("SELECT 1 FROM playlists WHERE id = ? AND user_id = ?", [playlistId, userId]);
  if (!owned) throw notFound("Playlist");
  run("DELETE FROM playlist_items WHERE playlist_id = ? AND item_type = ? AND item_id = ?", [playlistId, itemType, itemId]);
  // Close the gap so positions stay contiguous.
  const rows = all<{ id: string }>("SELECT id FROM playlist_items WHERE playlist_id = ? ORDER BY position", [playlistId]);
  rows.forEach((row, index) => {
    run("UPDATE playlist_items SET position = ? WHERE id = ?", [index, row.id]);
  });
  refreshPlaylistTotals(playlistId);
  return findPlaylist(userId, playlistId);
}

// ─── Play history ────────────────────────────────────────────────────────────

type HistoryRow = Row & {
  id: string;
  item_type: string;
  item_id: string;
  progress_percent: number;
  completed: number;
  played_at: string;
};

export function listHistory(userId: string, limit = 30): { id: string; itemType: ContentType; itemId: string; title: string; subtitle: string; image: string; duration: string; playedAt: string; progressPercent: number; completed: boolean }[] {
  const rows = all<HistoryRow>(
    "SELECT id, item_type, item_id, progress_percent, completed, played_at FROM play_history WHERE user_id = ? ORDER BY played_at DESC LIMIT ?",
    [userId, Math.min(200, Math.max(1, limit))],
  );
  const resolved = resolveGrouped(rows);
  return rows.map((row) => {
    const item = resolved.get(`${row.item_type}:${row.item_id}`) ?? emptyResolved();
    return {
      id: row.id,
      itemType: row.item_type as ContentType,
      itemId: row.item_id,
      title: item.title,
      subtitle: item.subtitle,
      image: item.image,
      duration: formatDuration(item.durationSeconds),
      playedAt: row.played_at,
      progressPercent: Math.round(Number(row.progress_percent ?? 0)),
      completed: row.completed === 1,
    };
  });
}

/** Continues listening: partial progress, most recent first. */
export function continueListening(userId: string, limit = 10) {
  const rows = all<HistoryRow>(
    `SELECT id, item_type, item_id, progress_percent, completed, played_at FROM play_history
     WHERE user_id = ? AND completed = 0 AND progress_percent > 0
     ORDER BY played_at DESC LIMIT ?`,
    [userId, Math.min(50, Math.max(1, limit))],
  );
  const resolved = resolveGrouped(rows);
  return rows
    .map((row) => {
      const item = resolved.get(`${row.item_type}:${row.item_id}`) ?? emptyResolved();
      return {
        id: row.id,
        itemType: row.item_type as ContentType,
        itemId: row.item_id,
        title: item.title,
        subtitle: item.subtitle,
        image: item.image,
        duration: formatDuration(item.durationSeconds),
        playedAt: row.played_at,
        progressPercent: Math.round(Number(row.progress_percent ?? 0)),
        completed: false,
      };
    })
    .filter((entry) => entry.title !== "Unavailable");
}

/**
 * Records a play. One row per (user, item) so the history list shows the latest
 * position rather than one entry per listen.
 */
export function recordPlay(
  userId: string,
  itemType: string,
  itemId: string,
  options: { progressPercent?: number; secondsPlayed?: number; completed?: boolean } = {},
): { recorded: boolean } {
  assertItemExists(itemType, itemId);
  const progress = Math.min(100, Math.max(0, options.progressPercent ?? 0));
  run(
    `INSERT INTO play_history (id, user_id, item_type, item_id, progress_percent, seconds_played, completed, played_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT DO NOTHING`,
    [newId(), userId, itemType, itemId, progress, options.secondsPlayed ?? 0, options.completed === true ? 1 : 0],
  );
  // `play_history` has no unique key to upsert against, so the newest row is
  // promoted and the older duplicate for the same item removed.
  const rows = all<{ id: string }>(
    "SELECT id FROM play_history WHERE user_id = ? AND item_type = ? AND item_id = ? ORDER BY played_at DESC",
    [userId, itemType, itemId],
  );
  if (rows.length > 1) {
    const stale = rows.slice(1).map((row) => row.id);
    run(
      `DELETE FROM play_history WHERE id IN (${placeholders(stale.length)})`,
      stale,
    );
  }
  return { recorded: true };
}

export function clearHistory(userId: string): { cleared: boolean } {
  run("DELETE FROM play_history WHERE user_id = ?", [userId]);
  return { cleared: true };
}

// ─── Notes ───────────────────────────────────────────────────────────────────

type NoteRow = Row & {
  id: string;
  item_type: string;
  item_id: string;
  body: string;
  timestamp_seconds: number | null;
  reference: string | null;
  created_at: string;
  updated_at: string;
};

function toNote(row: NoteRow, item: ResolvedItem): Note {
  return {
    id: row.id,
    itemType: row.item_type as ContentType,
    itemId: row.item_id,
    itemTitle: item.title,
    body: row.body,
    timestampSeconds: row.timestamp_seconds === null ? null : Number(row.timestamp_seconds),
    reference: row.reference,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listNotes(userId: string, itemType?: string): Note[] {
  const params: string[] = [userId];
  let where = "user_id = ?";
  if (itemType) {
    where += " AND item_type = ?";
    params.push(itemType);
  }
  const rows = all<NoteRow>(
    `SELECT id, item_type, item_id, body, timestamp_seconds, reference, created_at, updated_at
     FROM notes WHERE ${where} ORDER BY created_at DESC`,
    params,
  );
  const resolved = resolveGrouped(rows);
  return rows.map((row) => toNote(row, resolved.get(`${row.item_type}:${row.item_id}`) ?? emptyResolved()));
}

export const noteInputSchema = z.object({
  itemType: contentTypeSchema,
  itemId: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(20_000),
  timestampSeconds: z.number().int().min(0).max(86_400).nullable().optional(),
  reference: z.string().trim().max(120).nullable().optional(),
});

export type NoteInput = z.output<typeof noteInputSchema>;

export function createNote(userId: string, input: NoteInput): Note {
  assertItemExists(input.itemType, input.itemId);
  const id = newId();
  run(
    `INSERT INTO notes (id, user_id, item_type, item_id, body, timestamp_seconds, reference)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, userId, input.itemType, input.itemId, input.body, input.timestampSeconds ?? null, input.reference ?? null],
  );
  const row = get<NoteRow>(
    "SELECT id, item_type, item_id, body, timestamp_seconds, reference, created_at, updated_at FROM notes WHERE id = ? AND user_id = ?",
    [id, userId],
  );
  if (!row) throw notFound("Note");
  return toNote(row, resolveOne(row.item_type, row.item_id));
}

export function updateNote(userId: string, id: string, input: Partial<NoteInput>): Note {
  const existing = get<NoteRow>(
    "SELECT id, item_type, item_id, body, timestamp_seconds, reference, created_at, updated_at FROM notes WHERE id = ? AND user_id = ?",
    [id, userId],
  );
  if (!existing) throw notFound("Note");
  const map: Record<string, string> = { body: "body", timestampSeconds: "timestamp_seconds", reference: "reference" };
  const assignments: string[] = [];
  const params: (string | number | null)[] = [];
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    const column = map[key];
    if (!column) continue;
    assignments.push(`${column} = ?`);
    params.push(value as string | number | null);
  }
  if (assignments.length > 0) {
    params.push(id, userId);
    run(
      `UPDATE notes SET ${assignments.join(", ")}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = ? AND user_id = ?`,
      params,
    );
  }
  const row = get<NoteRow>(
    "SELECT id, item_type, item_id, body, timestamp_seconds, reference, created_at, updated_at FROM notes WHERE id = ? AND user_id = ?",
    [id, userId],
  );
  return toNote(row!, resolveOne(row!.item_type, row!.item_id));
}

export function deleteNote(userId: string, id: string): void {
  const result = run("DELETE FROM notes WHERE id = ? AND user_id = ?", [id, userId]);
  if (result.changes === 0) throw notFound("Note");
}

// ─── Downloads ───────────────────────────────────────────────────────────────

export function recordDownload(userId: string, itemType: string, itemId: string, quality: string): { id: string } {
  assertItemExists(itemType, itemId);
  const id = newId();
  run(
    `INSERT INTO downloads (id, user_id, item_type, item_id, quality, expires_at)
     VALUES (?, ?, ?, ?, ?, datetime('now', '+30 days'))`,
    [id, userId, itemType, itemId, quality],
  );
  return { id };
}

export function listDownloads(userId: string): { id: string; itemType: ContentType; itemId: string; title: string; subtitle: string; image: string; duration: string; quality: string; downloadedAt: string; expiresAt: string | null }[] {
  const rows = all<Row & { id: string; item_type: string; item_id: string; quality: string; size_bytes: number | null; downloaded_at: string; expires_at: string | null }>(
    `SELECT id, item_type, item_id, quality, size_bytes, downloaded_at, expires_at
     FROM downloads WHERE user_id = ? ORDER BY downloaded_at DESC`,
    [userId],
  );
  const resolved = resolveGrouped(rows);
  return rows.map((row) => {
    const item = resolved.get(`${row.item_type}:${row.item_id}`) ?? emptyResolved();
    return {
      id: row.id,
      itemType: row.item_type as ContentType,
      itemId: row.item_id,
      title: item.title,
      subtitle: item.subtitle,
      image: item.image,
      duration: formatDuration(item.durationSeconds),
      quality: row.quality,
      downloadedAt: row.downloaded_at,
      expiresAt: row.expires_at,
    };
  });
}
