import { all, get, hasFts5, run, type Row } from "../../db/client.ts";
import { normalize } from "../../lib/text.ts";
import { ftsQuery, likePattern } from "../../lib/validate.ts";
import { newId } from "../../lib/http.ts";
import {
  CONTENT_TYPE_LABELS,
  CONTENT_TYPE_ROUTES,
  type Availability,
  type ContentType,
  type SearchResult,
} from "../../types/domain.ts";

/**
 * Search reads a denormalised `search_index` table rather than fanning out
 * across every content table.
 *
 * That keeps ranking in one place and lets a row carry cross-type metadata
 * (`subtitle`, `availability`, `href`) that no single source table owns. The
 * index is maintained by `reindex()` below, which the admin module exposes.
 */

export type SearchOptions = {
  q: string;
  types?: ContentType[];
  language?: string;
  availability?: Availability;
  limit?: number;
  offset?: number;
};

const typeSelect = `
  si.entity_type, si.entity_id, si.type, si.title, si.subtitle, si.meta, si.image, si.href,
  si.language, si.availability, si.popularity
`;

/**
 * FTS5 when available, LIKE otherwise.
 *
 * The LIKE path is a genuine fallback rather than a nicety: the linked SQLite
 * build on some platforms ships without FTS5, and search must still work. The
 * FTS probe is cached in `db/client.ts`, so this costs one call per request.
 */
export function search(options: SearchOptions): { results: SearchResult[]; total: number; engine: "fts" | "like" } {
  const { q, types, language, availability } = options;
  const limit = Math.min(100, Math.max(1, options.limit ?? 20));
  const offset = Math.max(0, options.offset ?? 0);
  const filters: string[] = [];
  const params: (string | number)[] = [];

  if (types && types.length > 0) {
    filters.push(`si.entity_type IN (${types.map(() => "?").join(", ")})`);
    params.push(...types);
  }
  if (language) {
    filters.push("si.language = ?");
    params.push(language);
  }
  if (availability) {
    filters.push("si.availability = ?");
    params.push(availability);
  }
  const where = filters.length > 0 ? ` AND ${filters.join(" AND ")}` : "";

  if (hasFts5()) {
    const match = ftsQuery(q);
    // `search_index` is the content table; `search_index_fts` is the FTS5 index
    // over it. MATCH and `bm25()` run against the FTS table, then we join back
    // on `rowid` to pull the full denormalised row.
    const rows = all<Row & { score: number } & Record<string, never>>(
      `SELECT ${typeSelect}, bm25(search_index_fts) AS score
       FROM search_index_fts
       JOIN search_index si ON si.id = search_index_fts.rowid
       WHERE search_index_fts MATCH ?${where}
       ORDER BY score, si.popularity DESC
       LIMIT ? OFFSET ?`,
      [match, ...params, limit, offset],
    );
    const total = Number(
      get<{ total: number }>(
        `SELECT COUNT(*) AS total
         FROM search_index_fts
         JOIN search_index si ON si.id = search_index_fts.rowid
         WHERE search_index_fts MATCH ?${where}`,
        [match, ...params],
      )?.total ?? 0,
    );
    return { results: rows.map((row) => toResult(row)), total, engine: "fts" };
  }

  const pattern = likePattern(normalize(q));
  const like = `%${pattern}%`;
  const rows = all<Row & Record<string, never>>(
    `SELECT ${typeSelect}
     FROM search_index si
     WHERE (si.title LIKE ? ESCAPE '\\' OR si.subtitle LIKE ? ESCAPE '\\' OR si.body LIKE ? ESCAPE '\\')${where}
     ORDER BY si.popularity DESC, si.title
     LIMIT ? OFFSET ?`,
    [like, like, like, ...params, limit, offset],
  );
  const total = Number(
    get<{ total: number }>(
      `SELECT COUNT(*) AS total FROM search_index si
       WHERE (si.title LIKE ? ESCAPE '\\' OR si.subtitle LIKE ? ESCAPE '\\' OR si.body LIKE ? ESCAPE '\\')${where}`,
      [like, like, like, ...params],
    )?.total ?? 0,
  );
  return { results: rows.map((row) => toResult(row)), total, engine: "like" };
}

function toResult(row: Row): SearchResult {
  const entityType = String(row.entity_type) as SearchResult["entityType"];
  return {
    id: `${row.entity_type}:${row.entity_id}`,
    // The tab labels the frontend filters on (`"Hymns"`, `"Churches"`, …) come
    // from the canonical map rather than the row's stored type: older rows were
    // written as singular (`"Hymn"`), which matched none of the tabs, so five of
    // the eight tabs always read "No results".
    type: CONTENT_TYPE_LABELS[entityType as ContentType] ?? String(row.type),
    title: String(row.title),
    subtitle: String(row.subtitle ?? ""),
    meta: String(row.meta ?? ""),
    image: String(row.image ?? ""),
    // Prefer the indexed href, falling back to the type's canonical route so a
    // row indexed without one still produces a usable link.
    href: String(row.href || CONTENT_TYPE_ROUTES[entityType as ContentType] || "/"),
    entityType,
    entityId: String(row.entity_id),
    language: row.language === null ? null : String(row.language),
    availability: String(row.availability ?? "any") as Availability,
  };
}

/** Type tabs with counts, for the search page's filter row. */
export function searchFacets(q: string): Record<string, number> {
  const counts: Record<string, number> = {};
  const filter = q.trim();
  if (hasFts5() && filter) {
    const rows = all<{ entity_type: string; total: number }>(
      `SELECT si.entity_type, COUNT(*) AS total
       FROM search_index_fts
       JOIN search_index si ON si.id = search_index_fts.rowid
       WHERE search_index_fts MATCH ?
       GROUP BY si.entity_type`,
      [ftsQuery(filter)],
    );
    for (const row of rows) counts[row.entity_type] = Number(row.total);
    return counts;
  }
  if (filter) {
    const like = likePattern(normalize(filter));
    const rows = all<{ entity_type: string; total: number }>(
      `SELECT entity_type, COUNT(*) AS total FROM search_index
       WHERE title LIKE ? ESCAPE '\\' OR subtitle LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\'
       GROUP BY entity_type`,
      [like, like, like],
    );
    for (const row of rows) counts[row.entity_type] = Number(row.total);
    return counts;
  }
  const rows = all<{ entity_type: string; total: number }>("SELECT entity_type, COUNT(*) AS total FROM search_index GROUP BY entity_type");
  for (const row of rows) counts[row.entity_type] = Number(row.total);
  return counts;
}

/** Popular searches, from the logged query log. */
export function popularSearches(limit = 8): string[] {
  return all<{ query: string }>(
    `SELECT query FROM search_queries
     WHERE result_count > 0
     GROUP BY normalized
     ORDER BY COUNT(*) DESC, MAX(created_at) DESC
     LIMIT ?`,
    [Math.min(20, Math.max(1, limit))],
  ).map((row) => row.query);
}

/**
 * Logs a query for the popular-searches list.
 *
 * Failures are swallowed: analytics must never turn a search into a 500.
 */
export function recordQuery(q: string, resultCount: number, userId: string | null): void {
  const normalized = normalize(q);
  if (!normalized) return;
  try {
    run("INSERT INTO search_queries (id, query, normalized, user_id, result_count) VALUES (?, ?, ?, ?, ?)", [
      newId(),
      q.trim().slice(0, 200),
      normalized,
      userId,
      resultCount,
    ]);
  } catch {
    // Analytics is best-effort.
  }
}

// ─── Index maintenance ───────────────────────────────────────────────────────

type IndexSeed = {
  entityType: string;
  entityId: string;
  type: string;
  title: string;
  subtitle: string;
  meta: string;
  body: string;
  image: string;
  href: string;
  language: string | null;
  availability: Availability;
  popularity: number;
};

/**
 * Rebuilds `search_index` from the source tables.
 *
 * A full rebuild is the honest approach here: the index is derived data, and
 * incremental upkeep would need triggers on seven tables. `admin` exposes this
 * as a manual action, and the seeder calls it so a fresh database is searchable.
 */
export function reindex(): { indexed: number } {
  const rows: IndexSeed[] = [];

  for (const row of all<Row & { availability: string }>(
    `SELECT t.id, t.title, t.artist, t.album, t.kind, t.image, t.language, t.play_count, t.like_count,
            t.downloadable, t.is_live, t.stream_url
     FROM tracks t WHERE t.deleted_at IS NULL AND t.status = 'published'`,
  )) {
    const isVideo = row.kind === "video";
    rows.push({
      entityType: isVideo ? "video" : "track",
      entityId: String(row.id),
      type: isVideo ? "Video" : "Music",
      title: String(row.title),
      subtitle: String(row.artist ?? ""),
      meta: String(row.album ?? ""),
      body: "",
      image: String(row.image ?? ""),
      // Every href below has to land on a route the Next app actually serves.
      // `/music/[slug]` resolves *mixes*, and churches, sermons, events and
      // collections have list pages but no per-item page, so those point at
      // their list; only videos, hymns, news and the Bible reader have real
      // detail routes. A prettier href that 404s is worse than a plain one.
      href: isVideo ? `/videos/${row.id}` : `/music`,
      language: String(row.language ?? "English"),
      availability: row.is_live === 1 ? "live" : row.downloadable === 1 ? "download" : row.stream_url ? "replay" : "any",
      popularity: Number(row.play_count ?? 0) + Number(row.like_count ?? 0) * 5,
    });
  }

  for (const row of all<Row & { availability: string }>(
    `SELECT h.id, h.title, h.number, h.theme, h.language, h.image, h.downloadable, h.play_count, h.lyrics
     FROM hymns h WHERE h.deleted_at IS NULL AND h.status = 'published'`,
  )) {
    rows.push({
      entityType: "hymn",
      entityId: String(row.id),
      type: "Hymn",
      title: String(row.title),
      subtitle: `Hymn ${row.number}`,
      meta: String(row.theme ?? ""),
      body: String(row.lyrics ?? ""),
      image: String(row.image ?? ""),
      href: `/hymns/${row.id}`,
      language: String(row.language ?? "English"),
      availability: row.downloadable === 1 ? "download" : "any",
      popularity: Number(row.play_count ?? 0),
    });
  }

  for (const row of all<Row & { availability: string }>(
    `SELECT s.id, s.title, s.speaker, s.topic, s.series, s.language, s.image, s.play_count, s.description, s.transcript
     FROM sermons s WHERE s.deleted_at IS NULL AND s.status = 'published'`,
  )) {
    rows.push({
      entityType: "sermon",
      entityId: String(row.id),
      type: "Sermon",
      title: String(row.title),
      subtitle: String(row.speaker ?? ""),
      meta: String(row.series ?? ""),
      body: `${row.description ?? ""}\n${row.transcript ?? ""}`,
      image: String(row.image ?? ""),
      href: `/sermons`,
      language: String(row.language ?? "English"),
      availability: "replay",
      popularity: Number(row.play_count ?? 0),
    });
  }

  for (const row of all<Row & { availability: string }>(
    `SELECT n.id, n.slug, n.title, n.category, n.source, n.image, n.tags, n.featured, n.view_count, n.body, n.excerpt
     FROM news_articles n WHERE n.deleted_at IS NULL AND n.status = 'published'`,
  )) {
    rows.push({
      entityType: "news",
      entityId: String(row.id),
      type: "News",
      title: String(row.title),
      subtitle: String(row.source ?? ""),
      meta: String(row.category ?? ""),
      body: `${row.excerpt ?? ""}\n${row.body ?? ""}`,
      image: String(row.image ?? ""),
      href: `/news/${row.slug}`,
      language: null,
      availability: "any",
      popularity: Number(row.view_count ?? 0) + (row.featured === 1 ? 500 : 0),
    });
  }

  for (const row of all<Row & { availability: string }>(
    `SELECT c.id, c.slug, c.name, c.city, c.country, c.image, c.verified, c.is_live, c.description
     FROM churches c WHERE c.deleted_at IS NULL AND c.is_active = 1`,
  )) {
    rows.push({
      entityType: "church",
      entityId: String(row.id),
      type: "Church",
      title: String(row.name),
      subtitle: [row.city, row.country].filter(Boolean).join(", "),
      meta: "",
      body: String(row.description ?? ""),
      image: String(row.image ?? ""),
      href: `/churches`,
      language: null,
      availability: row.is_live === 1 ? "live" : "any",
      popularity: row.verified === 1 ? 100 : 0,
    });
  }

  for (const row of all<Row & { availability: string }>(
    `SELECT e.id, e.slug, e.title, e.place, e.city, e.category, e.image, e.is_live, e.starts_at, e.description
     FROM events e WHERE e.deleted_at IS NULL AND e.status = 'published'`,
  )) {
    rows.push({
      entityType: "event",
      entityId: String(row.id),
      type: "Event",
      title: String(row.title),
      subtitle: String(row.place ?? ""),
      meta: String(row.category ?? ""),
      body: String(row.description ?? ""),
      image: String(row.image ?? ""),
      href: `/events`,
      language: null,
      availability: row.is_live === 1 ? "live" : "any",
      popularity: 0,
    });
  }

  for (const row of all<Row & { availability: string }>(
    `SELECT l.id, l.title, l.church_name, l.status, l.image, l.language, l.category, l.viewer_count, l.stream_url, l.replay_url
     FROM live_streams l`,
  )) {
    rows.push({
      entityType: "live_stream",
      entityId: String(row.id),
      type: "Live",
      title: String(row.title),
      subtitle: String(row.church_name ?? ""),
      meta: String(row.category ?? ""),
      body: "",
      image: String(row.image ?? ""),
      href: `/live?stream=${row.id}`,
      language: String(row.language ?? "English"),
      availability: row.status === "Live now" ? "live" : row.replay_url ? "replay" : "any",
      popularity: Number(row.viewer_count ?? 0),
    });
  }

  for (const row of all<Row & { availability: string }>(
    `SELECT co.id, co.title, co.slug, co.description, co.tone, co.item_count
     FROM collections co`,
  )) {
    rows.push({
      entityType: "collection",
      entityId: String(row.id),
      type: "Collection",
      title: String(row.title),
      subtitle: String(row.tone ?? ""),
      meta: `${row.item_count ?? 0} items`,
      body: String(row.description ?? ""),
      image: "",
      href: `/music`,
      language: null,
      availability: "any",
      popularity: Number(row.item_count ?? 0) * 10,
    });
  }

  for (const row of all<Row & { availability: string }>(
    `SELECT b.id, b.name, b.abbreviation, b.testament, b.chapter_count
     FROM bible_books b GROUP BY b.name, b.testament ORDER BY MIN(b.book_number)`,
  )) {
    rows.push({
      entityType: "bible_book",
      entityId: String(row.id),
      type: "Bible",
      title: String(row.name),
      subtitle: String(row.testament ?? ""),
      meta: `${row.chapter_count ?? 0} chapters`,
      body: "",
      image: "",
      // The book *name*, not the abbreviation: the reader matches the segment
      // against the names it loads, and `Gen` would never resolve.
      href: `/bible/${row.name}`,
      language: "English",
      availability: "any",
      popularity: 0,
    });
  }

  // Replace wholesale: `search_index` is fully derived, so a partial update
  // would leave rows for deleted content behind.
  run("DELETE FROM search_index");
  for (const row of rows) {
    run(
      `INSERT INTO search_index (entity_type, entity_id, type, title, subtitle, meta, body, image, href, language, availability, popularity)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.entityType,
        row.entityId,
        row.type,
        row.title,
        row.subtitle,
        row.meta,
        row.body,
        row.image,
        row.href,
        row.language,
        row.availability,
        row.popularity,
      ],
    );
  }
  rebuildFts();
  return { indexed: rows.length };
}

/** Repopulates the FTS shadow table after a bulk `DELETE`/`INSERT` cycle. */
function rebuildFts(): void {
  if (!hasFts5()) return;
  try {
    run("INSERT INTO search_index(search_index_fts) VALUES ('rebuild')");
  } catch {
    // FTS5 present but the shadow table is not configured as external-content;
    // search falls back to the LIKE path.
  }
}
