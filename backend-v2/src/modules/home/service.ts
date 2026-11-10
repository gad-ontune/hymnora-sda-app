import { all, get, type Row } from "../../db/client.ts";
import { formatDay, formatEventTime, formatListeners, formatLongDate, formatMonth, isoTimestamp } from "../../lib/time.ts";
import { formatDistance, distanceKm, isValidCoordinate } from "../../lib/geo.ts";
import { formatReadTime, formatRelativeDate } from "../../lib/time.ts";
import { readingMinutes, parseJson } from "../../lib/text.ts";
import { toTrackWithProgress, toTrackDetail, type TrackRow } from "../tracks/service.ts";
import { continueListening } from "../library/service.ts";
import type { AuthenticatedUser } from "../../middleware/auth.ts";
import type { Church, EventItem, HomeDashboard, NewsArticle, Track, TrackDetail } from "../../types/domain.ts";

/**
 * `GET /api/home` assembles the entire home screen in one request.
 *
 * The page renders a dozen rails; fetching them individually would be a dozen
 * round trips on the critical path. Each rail here is one indexed query, and the
 * whole payload is still a handful of milliseconds on SQLite.
 */

const trackColumns = `
  t.id, t.title, t.artist, t.album, t.album_id, t.image, t.audio_url, t.video_url, t.stream_url,
  t.duration_seconds, t.language, t.kind, t.genre, t.mood, t.is_live, t.live_status,
  t.captions_available, t.downloadable, t.is_explicit, t.featured, t.play_count, t.like_count,
  t.release_date, t.lyrics, t.credits, t.view_count, t.status, t.published_at,
  t.created_at, t.updated_at
`;

function popularTracks(limit: number): Track[] {
  return all<TrackRow>(
    `${trackColumns.replace(/^/, "SELECT ")}
     FROM tracks t
     WHERE t.deleted_at IS NULL AND t.status = 'published'
     ORDER BY t.featured DESC, t.play_count DESC
     LIMIT ?`,
    [limit],
  ).map((row) => toTrackWithProgress(row));
}

/**
 * The hero track.
 *
 * Prefers something currently live so the banner reflects real activity, then
 * falls back to the most-played published track. `GET /api/hero-track` serves
 * this same row for the frontend's single-purpose helper.
 */
export function heroTrack(): TrackDetail {
  const live = get<TrackRow>(
    `${trackColumns.replace(/^/, "SELECT ")}
     FROM tracks t
     WHERE t.deleted_at IS NULL AND t.status = 'published' AND t.is_live = 1
     ORDER BY t.play_count DESC LIMIT 1`,
  );
  if (live) return toTrackDetail(live);
  const popular = get<TrackRow>(
    `${trackColumns.replace(/^/, "SELECT ")}
     FROM tracks t
     WHERE t.deleted_at IS NULL AND t.status = 'published'
     ORDER BY t.featured DESC, t.play_count DESC LIMIT 1`,
  );
  if (!popular) throw new Error("No published tracks are available for the hero banner");
  return toTrackDetail(popular);
}

function latestNews(limit: number): NewsArticle[] {
  return all<
    Row & {
      id: string;
      slug: string;
      title: string;
      category: string;
      excerpt: string;
      source: string;
      image: string;
      region: string | null;
      tags: string;
      featured: number;
      published_at: string | null;
      created_at: string;
      body: string | null;
      author: string | null;
    }
  >(
    `SELECT n.id, n.slug, n.title, n.category, n.excerpt, n.source, n.image, n.region, n.tags, n.featured,
            COALESCE(n.published_at, n.created_at) AS published_at, n.created_at, n.body, n.author
     FROM news_articles n
     WHERE n.deleted_at IS NULL AND n.status = 'published'
     ORDER BY n.featured DESC, published_at DESC
     LIMIT ?`,
    [limit],
  ).map((row) => {
    const published = String(row.published_at);
    const minutes = readingMinutes(row.body);
    return {
      id: row.id,
      category: row.category,
      title: row.title,
      excerpt: row.excerpt,
      source: row.source,
      date: formatRelativeDate(published),
      image: row.image,
      readTime: formatReadTime(minutes),
      slug: row.slug,
      body: row.body,
      region: row.region,
      tags: parseJson<string[]>(row.tags, []),
      author: row.author,
      featured: row.featured === 1,
      publishedAt: published,
      readTimeMinutes: minutes,
      status: "published" as const,
    };
  });
}

function upcomingEvents(limit: number): EventItem[] {
  return all<Row & { id: string; title: string; place: string; starts_at: string; duration_days: number; category: string; image: string; is_live: number }>(
    `SELECT e.id, e.title, e.place, e.starts_at, e.duration_days, e.category, e.image, e.is_live
     FROM events e
     WHERE e.deleted_at IS NULL AND e.status = 'published' AND e.starts_at >= ?
     ORDER BY e.is_live DESC, e.starts_at ASC
     LIMIT ?`,
    [isoTimestamp(-86_400_000), limit],
  ).map((row) => ({
    id: row.id,
    day: formatDay(row.starts_at),
    month: formatMonth(row.starts_at),
    title: row.title,
    place: row.place,
    time: formatEventTime(row.starts_at, Number(row.duration_days)),
    category: row.category,
    image: row.image,
    live: row.is_live === 1,
    startsAt: row.starts_at,
  }));
}

/** Nearby churches around the signed-in user's home church, else the largest. */
function nearbyChurches(user: AuthenticatedUser | undefined, limit: number): Church[] {
  if (user?.homeChurchId) {
    const anchor = get<{ latitude: number; longitude: number }>(
      "SELECT latitude, longitude FROM churches WHERE id = ? AND deleted_at IS NULL",
      [user.homeChurchId],
    );
    if (anchor && isValidCoordinate(anchor.latitude, anchor.longitude)) {
      const rows = nearbyByDistance(anchor, limit);
      if (rows.length > 0) return rows;
    }
  }
  return all<Row & { id: string; name: string; location: string; service: string; image: string; verified: number; is_live: number; latitude: number; longitude: number }>(
    `SELECT c.id, c.name, c.location, c.service, c.image, c.verified, c.is_live, c.latitude, c.longitude
     FROM churches c
     WHERE c.deleted_at IS NULL AND c.is_active = 1
     ORDER BY c.is_live DESC, c.verified DESC, c.name
     LIMIT ?`,
    [limit],
  ).map(toChurch);
}

/**
 * Churches nearest a known centre. `users.city` holds a name rather than
 * coordinates, so the only reliable anchor in the data today is the user's
 * home church; without one the caller falls back to the list above.
 *
 * Rows are sorted in JS by haversine distance — the same maths
 * `churches/service.ts` uses for `?lat=&lng=&radius=` searches — because the
 * earlier `ORDER BY is_live DESC, name` ignored the anchor entirely.
 */
function nearbyByDistance(anchor: { latitude: number; longitude: number }, limit: number): Church[] {
  const rows = all<Row & { id: string; name: string; location: string; service: string; image: string; verified: number; is_live: number; latitude: number; longitude: number }>(
    `SELECT c.id, c.name, c.location, c.service, c.image, c.verified, c.is_live, c.latitude, c.longitude
     FROM churches c
     WHERE c.deleted_at IS NULL AND c.is_active = 1`,
  );
  return rows
    .filter((row) => isValidCoordinate(Number(row.latitude), Number(row.longitude)))
    .map((row) => ({ row, distance: distanceKm(anchor, { latitude: Number(row.latitude), longitude: Number(row.longitude) }) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit)
    .map(({ row, distance }) => toChurch(row, distance));
}

function toChurch(
  row: Row & { id: string; name: string; location: string; service: string; image: string; verified: number; is_live: number; latitude: number; longitude: number },
  distance?: number,
): Church {
  return {
    id: row.id,
    name: row.name,
    location: row.location,
    service: row.service,
    image: row.image,
    status: row.is_live === 1 ? "Live now" : row.verified === 1 ? "Verified" : undefined,
    distance: distance === undefined ? "—" : formatDistance(distance),
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
  };
}

function liveNowCount(): number {
  return Number(get<{ total: number }>("SELECT COUNT(*) AS total FROM churches WHERE deleted_at IS NULL AND is_live = 1")?.total ?? 0);
}

function stats(): HomeDashboard["stats"] {
  const scalar = (sql: string, params: (string | number)[] = []) => Number(get<{ total: number }>(sql, params)?.total ?? 0);
  return {
    churches: scalar("SELECT COUNT(*) AS total FROM churches WHERE deleted_at IS NULL AND is_active = 1"),
    liveNow: liveNowCount(),
    events: scalar("SELECT COUNT(*) AS total FROM events WHERE deleted_at IS NULL AND status = 'published' AND starts_at >= ?", [isoTimestamp()]),
    tracks: scalar("SELECT COUNT(*) AS total FROM tracks WHERE deleted_at IS NULL AND status = 'published'"),
    hymns: scalar("SELECT COUNT(*) AS total FROM hymns WHERE deleted_at IS NULL AND status = 'published'"),
    sermons: scalar("SELECT COUNT(*) AS total FROM sermons WHERE deleted_at IS NULL AND status = 'published'"),
    news: scalar("SELECT COUNT(*) AS total FROM news_articles WHERE deleted_at IS NULL AND status = 'published'"),
  };
}

export function buildHomeDashboard(user: AuthenticatedUser | undefined): HomeDashboard {
  const hero = heroTrack();
  const resume = user ? continueListening(user.id, 8) : [];
  // The home page expects `Track[]` here, so the hydrated history rows are
  // narrowed back down to the fields the rail renders.
  const continueRail: Track[] = resume.map((entry) => ({
    id: entry.itemId,
    title: entry.title,
    artist: entry.subtitle,
    album: "",
    image: entry.image,
    duration: entry.duration,
    language: hero.language,
    kind: "audio",
    progress: entry.progressPercent,
  }));

  return {
    greeting: {
      name: user?.firstName ?? "Guest",
      dateLabel: formatLongDate(),
      locationLabel: [user?.city, user?.country].filter(Boolean).join(", ") || "Set your location",
    },
    hero: { ...hero, listenersLabel: formatListeners(hero.playCount) },
    dailyPaths: [
      { label: "Morning worship", detail: "Start the day in song", href: "/music?mood=Reverent", icon: "sunrise" },
      { label: "Sabbath school", detail: "Study the Sabbath lesson", href: "/bible", icon: "book" },
      { label: "Midweek prayer", detail: "Live and replayed", href: "/sermons", icon: "hands" },
      { label: "Quiet time", detail: "Scripture and hymns", href: "/bible/John%203", icon: "leaf" },
    ],
    quickLinks: [
      { label: "Live now", note: "Services streaming", href: "/live", icon: "radio" },
      { label: "My history", note: "Pick up where you left off", href: "/library/history", icon: "clock" },
      { label: "Downloads", note: "Available offline", href: "/library/downloads", icon: "download" },
      { label: "Bible", note: "Read and bookmark", href: "/bible", icon: "book-open" },
    ],
    continueListening: continueRail,
    popularMusic: popularTracks(10),
    sections: [
      { id: "worship", title: "Sabbath Worship", subtitle: "Reverent songs for the Sabbath", image: "", href: "/music?collection=worship", cta: "Play" },
      { id: "swahili", title: "Swahili Worship", subtitle: "Nyimbo za maombi", image: "", href: "/music?language=Swahili", cta: "Listen" },
      { id: "hymns", title: "Classic Hymns", subtitle: "The Seventh-day Adventist hymnal", image: "", href: "/hymns", cta: "Explore" },
      { id: "sermons", title: "Sermons", subtitle: "Preaching for the week", image: "", href: "/sermons", cta: "Watch" },
    ],
    latestNews: latestNews(6),
    upcomingEvents: upcomingEvents(4),
    nearbyChurches: nearbyChurches(user, 6),
    reminder: {
      title: "Sabbath begins",
      body: "Join a congregation near you for worship this week.",
    },
    stats: stats(),
  };
}
