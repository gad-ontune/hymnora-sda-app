/**
 * The music page's read model.
 *
 * The page is a set of *shapes* — a ring of mix bubbles, then horizontal rows —
 * rather than one list. The temptation is to have the frontend slice one big
 * array and filter it five times over. That fails the moment two rows want
 * different orderings of the same track (Nyimbo za Kristo wants newest,
 * Trending wants most-played), so the shapes are resolved here, in SQL, where
 * `sub_category`, `region`, `mood` and `play_count` can all be used at once.
 *
 * Everything served here has already been through the ingest filter, so a
 * `sermon` verdict can never reach it: the music page reads `tracks` rows with
 * a music `sub_category`, and the exclude filter is what keeps the two tables
 * disjoint.
 */

import { all, get } from "../../db/client.ts";
import { formatDuration } from "../../lib/time.ts";
import { parseJson } from "../../lib/text.ts";
import { REGION_LABELS, regionName } from "../youtube/whitelist.ts";
import type { MediaKind } from "../../types/domain.ts";

export type MusicTrack = {
  id: string;
  title: string;
  artist: string;
  album: string;
  image: string;
  duration: string;
  language: string;
  kind: MediaKind;
  /** The ingest bucket: choirs, hymns, instrumentals, acapella, worship. */
  subCategory: string | null;
  region: string;
  genre: string | null;
  mood: string | null;
  /** Present only on YouTube-sourced tracks. The audio extractor keys off it. */
  youtubeVideoId: string | null;
  playCount: number;
  releaseDate: string | null;
  tags: string[];
};

/** A quick-access bubble at the top of the page. */
export type MusicMix = {
  slug: string;
  title: string;
  subtitle: string;
  /** Two colours the frontend mixes into the bubble's gradient. */
  gradient: [string, string];
  artworkSeed: string;
  trackIds: string[];
  count: number;
};

export type MusicRow = {
  id: string;
  title: string;
  subtitle: string;
  tracks: MusicTrack[];
};

export type MusicHome = {
  mixes: MusicMix[];
  rows: MusicRow[];
  /** The single most-played music track, for the page hero. */
  hero: MusicTrack | null;
  totalTracks: number;
  totalDurationSeconds: number;
};

type MusicRowType = {
  id: string;
  title: string;
  description: string;
  duration_seconds: number;
  language: string;
  kind: string;
  sub_category: string | null;
  region: string;
  genre: string | null;
  mood: string | null;
  youtube_video_id: string | null;
  play_count: number;
  release_date: string | null;
  tags: string;
  image: string;
  album: string;
  artist: string;
};

/**
 * Only rows the ingest filter approved.
 *
 * `sub_category IS NOT NULL` is the load-bearing predicate: editorial tracks
 * seeded for the demo have no bucket, and a sermon routed into `tracks` by an
 * older version of the pipeline has none either. Neither belongs on a page
 * whose whole promise is "this is music, and only music".
 */
const MUSIC_BASE = `
  FROM tracks
  WHERE deleted_at IS NULL
    AND status = 'published'
    AND kind = 'audio'
    AND sub_category IS NOT NULL
    AND sub_category != ''
`;

function toMusicTrack(row: MusicRowType): MusicTrack {
  return {
    id: row.id,
    title: row.title,
    artist: row.artist,
    album: row.album,
    image: row.image,
    duration: formatDuration(row.duration_seconds),
    language: row.language,
    kind: "audio",
    subCategory: row.sub_category,
    region: row.region,
    genre: row.genre,
    mood: row.mood,
    youtubeVideoId: row.youtube_video_id,
    playCount: row.play_count,
    releaseDate: row.release_date,
    tags: parseJson<string[]>(row.tags, []),
  };
}

function query(
  where: string,
  orderBy: string,
  limit: number,
  params: (string | number)[] = [],
  offset = 0,
): MusicTrack[] {
  // `params` come before `limit` and `offset` because that is the order the
  // placeholders appear in the statement.
  const sql =
    `SELECT id, title, artist, album, image, duration_seconds, language, kind, sub_category,
            region, genre, mood, youtube_video_id, play_count, release_date, tags
     ${MUSIC_BASE} ${where}
     ORDER BY ${orderBy}
     LIMIT ? OFFSET ?`;
  return all<MusicRowType>(sql, [...params, limit, offset]).map(toMusicTrack);
}

/** Builds a row without letting a filter return a duplicate of the hero. */
function buildRow(id: string, title: string, subtitle: string, tracks: MusicTrack[], exclude?: string): MusicRow | null {
  const filtered = exclude ? tracks.filter((track) => track.id !== exclude) : tracks;
  if (filtered.length === 0) return null;
  return { id, title, subtitle, tracks: filtered };
}

export function musicHome(options: { limit?: number } = {}): MusicHome {
  const limit = Math.min(24, Math.max(4, options.limit ?? 10));

  // Most-played first: it decides the hero, and every row below excludes it so
  // the same song is not the first card in four different rows.
  const trending = query("", "play_count DESC, release_date DESC, created_at DESC", limit);
  const hero = trending[0] ?? null;

  const rows: (MusicRow | null)[] = [
    // Newest first, by the upload's own date. This is the row that answers
    // "what is new", and it is first because on a music page that is the
    // question people arrive with.
    buildRow(
      "new-releases",
      "New SDA Releases",
      "The most recent uploads from the channels we follow",
      query("", "release_date DESC, created_at DESC", limit),
      hero?.id,
    ),
    buildRow(
      "hymns-of-the-week",
      "Hymns of the Week",
      "From the hymnal, the way a congregation is actually singing them",
      query("AND sub_category = 'hymns'", "release_date DESC, view_count DESC", limit),
      hero?.id,
    ),
    buildRow(
      "worship-sessions",
      "Worship Sessions",
      "Congregational praise, for singing along to",
      query("AND sub_category = 'worship'", "view_count DESC, release_date DESC", limit),
      hero?.id,
    ),
    buildRow(
      "trending-east-africa",
      REGION_LABELS["east-africa"] ?? "Trending in Kenya & East Africa",
      "What East African SDA choirs and ministries are singing right now",
      // Ordered by views, not play_count: every ingested track has play_count 0,
      // so sorting by it would silently mean "newest first" under a heading that
      // claims otherwise. The view count is real, so the row is sorted by it.
      query("AND region = 'east-africa'", "view_count DESC, release_date DESC", limit),
      hero?.id,
    ),
    buildRow(
      "nyimbo-za-kristo",
      "Nyimbo za Kristo Collection",
      "Hymns and sacred songs from the SDA hymnal tradition",
      query(
        "AND (sub_category = 'hymns' OR lower(title) LIKE '%nyimbo%' OR lower(title) LIKE '%ndudzo%' OR lower(title) LIKE '%himno%')",
        "release_date DESC, play_count DESC",
        limit,
      ),
      hero?.id,
    ),
    buildRow(
      "quiet-devotion",
      "Quiet Devotion",
      "No vocals, no hurry — for the hour before prayer",
      query(
        "AND (sub_category = 'instrumentals' OR mood = 'Devotional')",
        "play_count DESC, title ASC",
        limit,
      ),
      hero?.id,
    ),
    buildRow(
      "choir-classics",
      "Choir Classics",
      "Massed voices, oratorios and cantatas from the wider church",
      query("AND sub_category = 'choirs'", "play_count DESC, release_date DESC", limit),
      hero?.id,
    ),
    buildRow(
      "acapella",
      "A Cappella",
      "Vocal only — every note is a person",
      query("AND sub_category = 'acapella'", "play_count DESC, release_date DESC", limit),
      hero?.id,
    ),
    buildRow(
      "piano-instrumentals",
      "Piano Instrumentals",
      "Hymns and worship songs played the way they sound in an empty hall",
      query(
        "AND (sub_category = 'instrumentals' AND (lower(title) LIKE '%piano%' OR lower(genre) LIKE '%piano%' OR lower(tags) LIKE '%piano%'))",
        "play_count DESC",
        limit,
      ),
      hero?.id,
    ),
    buildRow(
      "morning-hymns",
      "Morning Hymns",
      "The songs a family sings before the day gets loud",
      query(
        "AND sub_category IN ('hymns','worship')",
        "CASE lower(title) WHEN 'rise' THEN 0 ELSE 1 END, play_count DESC",
        limit,
      ),
      hero?.id,
    ),
    buildRow(
      "trending-world",
      REGION_LABELS.global ?? "Around the world",
      "From official SDA channels on every continent",
      query("", "play_count DESC, created_at DESC", limit),
      hero?.id,
    ),
  ];

  const total = get<{ total: number; seconds: number }>(
    `SELECT COUNT(*) AS total, COALESCE(SUM(duration_seconds), 0) AS seconds ${MUSIC_BASE}`,
  );

  return {
    mixes: buildMixes(hero?.id),
    rows: rows.filter((row): row is MusicRow => row !== null),
    hero,
    totalTracks: Number(total?.total ?? 0),
    totalDurationSeconds: Number(total?.seconds ?? 0),
  };
}

/**
 * The bubble ring.
 *
 * Bubbles are seeds, not stored collections: each one is a deterministic
 * filter over the same approved music table, so a track uploaded this morning
 * is in "Acapella" the moment the poller routes it. Persisting the membership
 * would mean a second thing to keep in sync with the filter for no benefit.
 */
function buildMixes(excludeHeroId?: string): MusicMix[] {
  const seeds: {
    slug: string;
    title: string;
    subtitle: string;
    where: string;
    order: string;
    gradient: [string, string];
  }[] = [
    {
      slug: "morning-hymns",
      title: "Morning Hymns",
      subtitle: "Start the day singing",
      where: "AND sub_category IN ('hymns','worship')",
      order: "play_count DESC",
      gradient: ["#D9A441", "#8C5A2B"],
    },
    {
      slug: "choir-classics",
      title: "Choir Classics",
      subtitle: "Massed voices, old and new",
      where: "AND sub_category = 'choirs'",
      order: "play_count DESC",
      gradient: ["#49624C", "#26332A"],
    },
    {
      slug: "piano-instrumentals",
      title: "Piano Instrumentals",
      subtitle: "Just keys and space",
      where: "AND sub_category = 'instrumentals'",
      order: "play_count DESC",
      gradient: ["#5A6E8C", "#2B3444"],
    },
    {
      slug: "acapella",
      title: "Acapella",
      subtitle: "Vocal only",
      where: "AND sub_category = 'acapella'",
      order: "play_count DESC",
      gradient: ["#8C4A3C", "#3A1F1A"],
    },
    {
      slug: "nyimbo-za-kristo",
      title: "Nyimbo za Kristo",
      subtitle: "Hymns from home",
      where: "AND (sub_category = 'hymns' OR lower(title) LIKE '%nyimbo%')",
      order: "release_date DESC",
      gradient: ["#7A6A3F", "#3A3320"],
    },
    {
      slug: "quiet-devotion",
      title: "Quiet Devotion",
      subtitle: "For the prayer hour",
      where: "AND (sub_category = 'instrumentals' OR mood = 'Devotional')",
      order: "play_count DESC",
      gradient: ["#3F4A5C", "#1A1F27"],
    },
  ];

  return seeds.flatMap((seed) => {
    const tracks = query(seed.where, seed.order, 24).filter((track) => track.id !== excludeHeroId);
    // A bubble is a doorway, and an empty one is a dead end. "A Cappella" has no
    // matches until an a-cappella upload is ingested, so it is left out of the
    // ring rather than rendered as a circle that opens onto nothing. It is still
    // a valid slug, so a link to it keeps working once the category has content.
    if (tracks.length === 0) return [];
    return [{
      slug: seed.slug,
      title: seed.title,
      subtitle: seed.subtitle,
      gradient: seed.gradient,
      artworkSeed: seed.slug,
      trackIds: tracks.map((track) => track.id),
      count: tracks.length,
    }];
  });
}

/** One bubble's contents, by slug. Powers the "open a mix" screen. */
export function musicMixTracks(slug: string, limit = 30): { mix: MusicMix | null; tracks: MusicTrack[] } {
  const allMixes = buildMixes();
  const mix = allMixes.find((candidate) => candidate.slug === slug) ?? null;
  if (!mix) return { mix: null, tracks: [] };
  const ids = new Set(mix.trackIds);
  const tracks = query("", "play_count DESC", 100).filter((track) => ids.has(track.id)).slice(0, limit);
  return { mix, tracks };
}

/** The full catalogue behind the music page, for search and "see all". */
export type BrowseFilter = { region?: string; category?: string; q?: string };

/**
 * The WHERE clause and its bindings for a catalogue browse.
 *
 * Split out from `browseMusic` because the bug it replaces was a silent one: the
 * clauses were joined as `AND ${clauses.slice(1).join(" ")}`, which discarded the
 * first filter and, with a single filter, emitted a bare `AND` immediately before
 * `ORDER BY`. Every request to the endpoint 500'd and nothing but a log line said
 * so. The parameter count has to match the placeholder count too, so both are
 * asserted here rather than by a request that would fail as a 500.
 */
export function buildBrowseFilter(options: BrowseFilter): { where: string; params: string[] } {
  const clauses: string[] = [];
  const params: string[] = [];
  if (options.region) {
    clauses.push("AND region = ?");
    params.push(options.region);
  }
  if (options.category) {
    clauses.push("AND sub_category = ?");
    params.push(options.category);
  }
  if (options.q) {
    clauses.push("AND (lower(title) LIKE ? OR lower(artist) LIKE ? OR lower(tags) LIKE ?)");
    const needle = `%${options.q.toLowerCase()}%`;
    params.push(needle, needle, needle);
  }
  // Every clause already begins with `AND`, so they are joined as they are and a
  // no-filter browse contributes nothing at all — which is what keeps a stray `AND`
  // from landing in front of `ORDER BY`.
  return { where: clauses.join(" "), params };
}

export function browseMusic(options: { region?: string; category?: string; q?: string; limit?: number; offset?: number } = {}): {
  items: MusicTrack[];
  total: number;
} {
  const limit = Math.min(100, Math.max(1, options.limit ?? 40));
  const offset = Math.max(0, options.offset ?? 0);
  const { where, params } = buildBrowseFilter(options);
  // Ordered by views, not play_count, for the same reason as the trending row:
  // every ingested track has play_count 0, so that column cannot rank anything.
  const items = query(where, "view_count DESC, release_date DESC", limit, params, offset);
  const total = Number(
    get<{ total: number }>(`SELECT COUNT(*) AS total ${MUSIC_BASE} ${where}`, params)?.total ?? 0,
  );
  return { items, total };
}

/** Region facets for the page's filter chips. */
export function musicRegions(): { region: string; label: string; count: number }[] {
  const rows = all<{ region: string; total: number }>(
    `SELECT region, COUNT(*) AS total ${MUSIC_BASE} GROUP BY region ORDER BY total DESC`,
  );
  return rows
    .filter((row) => row.region !== "global" || row.total > 0)
    .map((row) => ({ region: row.region, label: regionName(row.region), count: Number(row.total) }));
}

/** Category facets: choirs, hymns, instrumentals, acapella, worship. */
export function musicCategories(): { category: string; count: number }[] {
  return all<{ category: string; total: number }>(
    `SELECT sub_category AS category, COUNT(*) AS total ${MUSIC_BASE} GROUP BY sub_category ORDER BY total DESC`,
  ).map((row) => ({ category: row.category, count: Number(row.total) }));
}
