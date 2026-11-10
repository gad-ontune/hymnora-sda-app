import { authedFetch } from "./session";
import type {
  Track, Hymn, HymnDetail, HymnEdition, HymnTheme, Sermon, NewsItem, NewsArticle, NewsFacets,
  Church, EventItem, HomeDashboard, LiveStream, MusicHome, MusicFacets, MusicTrack, MixDetail,
  VideoPage, VideoFacets, VideoDetail, VideoSort, SearchResult,
  ReelPage, ReelFacets, ReelDetail, ReelFeedName,
  Comment, CommentThread, CommentTargetType, FollowsResponse,
  FollowTargetType, NewsRelated,
} from "./types";
export type {
  MediaKind, Track, NewsItem, NewsArticle, NewsFacets, Church, Hymn, HymnDetail, HymnEdition,
  HymnTheme, Sermon, EventItem, HomeLink, DailyPath, HomeDashboard, LiveStream,
  MusicTrack, MusicMix, MusicRow, MusicHome, MusicFacets, MixDetail,
  VideoCard, VideoPage, VideoFacets, VideoDetail, VideoSort, SearchResult,
  Reel, ReelPage, ReelFacets, ReelDetail, ReelFeedName, ReelCategoryId, ReelCategory, RelatedItem,
  Comment, CommentThread, CommentTargetType, CommentSummary, FollowEntry, FollowsResponse,
  FollowTargetType, NewsRelated,
  PushConfig, PushStatus, PushSubscriptionSummary, ReminderPreferences, ReadingStreak,
} from "./types";

const BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

/**
 * `revalidate: 60` is right for the catalogue: the same list serves every reader
 * for a minute. A reader's *own* radius search is not that, so `noStore` opts it
 * out — a cached answer to "3 km near me" is an answer about somebody else.
 */
async function fetchJson<T>(path: string, options: { noStore?: boolean } = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, options.noStore ? { cache: "no-store" } : { next: { revalidate: 60 } });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function getTracks() { return fetchJson<Track[]>("/api/tracks"); }
export async function getTrack(id: string) { return fetchJson<Track>(`/api/tracks/${id}`); }
export async function getHeroTrack() { return fetchJson<Track>("/api/hero-track"); }
export async function getHome() { return fetchJson<HomeDashboard>("/api/home"); }
export async function getLiveStreams() { return fetchJson<LiveStream[]>("/api/live"); }
export async function getVideos() { return fetchJson<Track[]>("/api/videos"); }
export async function getHymns() { return fetchJson<Hymn[]>("/api/hymns"); }

/**
 * The list endpoint caps `limit` at 100, so browsing the 9,000+ hymn catalogue
 * has to filter server-side rather than pull everything and filter in the
 * browser. `sort=number` orders by hymn number instead of the created_at
 * default, which is what a hymnal reader expects.
 */
export type HymnQuery = {
  edition?: string;
  language?: string;
  theme?: string;
  q?: string;
  sort?: "number" | "title" | "created";
  order?: "asc" | "desc";
  limit?: number;
  offset?: number;
};

export function hymnQueryString(query: HymnQuery = {}): string {
  const params = new URLSearchParams();
  if (query.edition) params.set("edition", query.edition);
  if (query.language) params.set("language", query.language);
  if (query.theme) params.set("theme", query.theme);
  if (query.q) params.set("q", query.q);
  if (query.sort) params.set("sort", query.sort);
  if (query.order) params.set("order", query.order);
  params.set("limit", String(query.limit ?? 100));
  if (query.offset) params.set("offset", String(query.offset));
  return params.toString();
}

export async function getHymnsPage(query: HymnQuery = {}) {
  return fetchJson<Hymn[]>(`/api/hymns?${hymnQueryString(query)}`);
}

export async function getHymnDetail(id: string) {
  return fetchJson<HymnDetail>(`/api/hymns/${encodeURIComponent(id)}`);
}

export async function getHymnEditions() {
  return fetchJson<HymnEdition[]>("/api/hymns/editions");
}

export async function getHymnThemes(language?: string) {
  const query = language && language !== "all" ? `?language=${encodeURIComponent(language)}` : "";
  return fetchJson<HymnTheme[]>(`/api/hymns/themes${query}`);
}

export async function getSermons() { return fetchJson<Sermon[]>("/api/sermons"); }
export async function getNews() { return fetchJson<NewsItem[]>("/api/news"); }

/**
 * The reading copy of the newsroom: full articles with body, byline, region and
 * tags. `/api/news` returns the card shape and would drop every one of those.
 */
export async function getNewsArticles() { return fetchJson<NewsArticle[]>("/api/news/detail"); }
export async function getNewsFacets() { return fetchJson<NewsFacets>("/api/news/facets"); }
export async function getNewsArticle(idOrSlug: string) {
  return fetchJson<NewsArticle>(`/api/news/${encodeURIComponent(idOrSlug)}`);
}

/** Fire-and-forget: a missing view count should never fail an article render. */
export async function recordNewsView(idOrSlug: string): Promise<void> {
  try {
    await fetch(`${BASE}/api/news/${encodeURIComponent(idOrSlug)}/view`, { method: "POST", cache: "no-store" });
  } catch {
    /* Nothing to do; the count is best-effort. */
  }
}
export async function getChurches() { return fetchJson<Church[]>("/api/churches"); }
export async function getChurchDetail(idOrSlug: string) {
  return fetchJson<import("./types").ChurchDetail>(`/api/churches/${encodeURIComponent(idOrSlug)}`);
}

/**
 * Churches inside a real radius, nearest first.
 *
 * The centre is the reader's own position, so this is deliberately `no-store`
 * rather than the shared 60s cache the catalogue pages use: two people asking for
 * "3 km near me" are asking about two different places, and a cached answer from
 * someone else's neighbourhood is worse than no answer.
 */
export async function getChurchesNearby(lat: number, lng: number, radiusKm: number) {
  const query = new URLSearchParams({ lat: String(lat), lng: String(lng), radius: String(radiusKm) });
  return fetchJson<Church[]>(`/api/churches?${query.toString()}`, { noStore: true });
}

/** The churches broadcasting right now — the count on the community card. */
export async function getLiveChurches() {
  return fetchJson<Church[]>("/api/churches?live=true");
}

export async function getEvents() { return fetchJson<EventItem[]>("/api/events"); }
export async function search(q: string) { return fetchJson<SearchResult[]>(`/api/search?q=${encodeURIComponent(q)}`); }

// HelloAO Bible endpoints (backend-v2: /api/bible/helloao)
//
// These proxy bible.helloao.org; the shapes below match what backend-v2
// returns from its external fetchers.
export type HelloAOTranslation = {
  id: string;
  name: string;
  shortName: string;
  englishName: string;
  language: string;
  textDirection: "ltr" | "rtl";
  numberOfBooks: number;
  totalNumberOfChapters: number;
  totalNumberOfVerses: number;
  languageName?: string;
  languageEnglishName?: string;
};

export type HelloAOBook = {
  id: string;
  translationId: string;
  name: string;
  commonName: string;
  title: string;
  order: number;
  numberOfChapters: number;
  totalNumberOfVerses: number;
};

export type HelloAOCommentary = {
  id: string;
  name: string;
  englishName: string;
  language: string;
  textDirection: string;
  website: string;
};

export type HelloAODataset = {
  id: string;
  name: string;
  englishName: string;
  language: string;
  textDirection: string;
  listOfBooksApiLink: string;
};

export async function getBibleTranslations() {
  return fetchJson<{ translations: HelloAOTranslation[] }>("/api/bible/helloao/translations");
}

/** A whole Bible held locally — every one of these has all 66 books verified. */
export type CompleteBible = {
  id: string;
  versionKey: string;
  name: string;
  label: string;
  language: string;
  languageCode: string;
  status: string;
  publisher: string | null;
  year: number | null;
  booksCount: number;
  chaptersCount: number;
  versesCount: number;
  description: string | null;
};

/** Totals for the home-page card, counted from the verses actually stored. */
export type BibleOverview = {
  versionCount: number;
  languageCount: number;
  bookCount: number;
  /** Chapters summed across the whole library. */
  chapterCount: number;
  /** Chapters in a single translation — a Bible's own shape. */
  chaptersPerVersion: number;
  verseCount: number;
  booksPerVersion: number;
};

/** One attributed verse for the rotating home-page card. */
export type SpotlightVerse = {
  id: string;
  reference: string;
  text: string;
  versionId: string;
  versionName: string;
  language: string;
  languageCode: string;
  dayOfYear: number;
};

export async function getCompleteBibles() { return fetchJson<CompleteBible[]>("/api/bible/complete-versions"); }
export async function getBibleOverview() { return fetchJson<BibleOverview>("/api/bible/overview"); }
export async function getBibleSpotlight(limit = 6) { return fetchJson<SpotlightVerse[]>(`/api/bible/spotlight?limit=${limit}`); }

/** Locally-stored scripture, so reading works with no network. */
export type LocalBook = { id: string; name: string; abbreviation: string; testament: "Old" | "New"; bookNumber: number; chapterCount: number; verseCount: number };
export type LocalVerse = { id: string; book: string; bookAbbreviation: string; chapter: number; verse: number; text: string };
export type LocalPassage = { version: CompleteBible; reference: string; book: string; chapter: number; verses: LocalVerse[]; text: string; verseCount: number };

export async function getLocalVersions() { return fetchJson<CompleteBible[]>("/api/bible/versions"); }
export async function getLocalBooks(version: string) { return fetchJson<LocalBook[]>(`/api/bible/books?version=${encodeURIComponent(version)}`); }
export async function getLocalChapter(version: string, book: string, chapter: number) {
  return fetchJson<LocalVerse[]>(`/api/bible/chapters/${chapter}?version=${encodeURIComponent(version)}&book=${encodeURIComponent(book)}`);
}
export async function getLocalPassage(version: string, reference: string) {
  return fetchJson<LocalPassage>(`/api/bible/verses?version=${encodeURIComponent(version)}&reference=${encodeURIComponent(reference)}`);
}
export async function getBibleBooks(translation: string) {
  return fetchJson<{ translation: HelloAOTranslation; books: HelloAOBook[] }>(
    `/api/bible/helloao/books/${encodeURIComponent(translation)}`,
  );
}

/** A chapter: the passage itself plus navigation links to its neighbours. */
export type HelloAOChapter = {
  thisChapterReference: Record<string, unknown>;
  numberOfVerses: number;
  nextChapterApiLink: string | null;
  previousChapterApiLink: string | null;
};

export async function getBibleChapter(translation: string, book: string, chapter: number) {
  return fetchJson<HelloAOChapter>(
    `/api/bible/helloao/chapter/${encodeURIComponent(translation)}/${encodeURIComponent(book)}/${chapter}`,
  );
}

export async function getBibleCommentaries() {
  return fetchJson<{ commentaries: HelloAOCommentary[] }>("/api/bible/helloao/commentaries");
}

export async function getBibleDatasets() {
  return fetchJson<{ datasets: HelloAODataset[] }>("/api/bible/helloao/datasets");
}

// ─── Music page ──────────────────────────────────────────────────────────────

/** The whole music page in one payload: bubbles, rows and the hero. */
export async function getMusicHome(limit?: number) {
  return fetchJson<MusicHome>(`/api/music/home${limit ? `?limit=${limit}` : ""}`);
}

export async function getMix(slug: string, limit?: number) {
  return fetchJson<MixDetail>(`/api/music/mixes/${encodeURIComponent(slug)}${limit ? `?limit=${limit}` : ""}`);
}

export async function getMusicFacets() { return fetchJson<MusicFacets>("/api/music/facets"); }

/**
 * A page of the catalogue. The total is the count of everything that matches,
 * not of this page — a browse view shows "38 recordings" over four rows, and a
 * length would say 40.
 */
export type MusicBrowsePage = { items: MusicTrack[]; total: number };

export async function browseMusic(query: { region?: string; category?: string; q?: string; limit?: number; offset?: number } = {}): Promise<MusicBrowsePage> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const search = params.toString();
  return fetchJson<MusicBrowsePage>(`/api/music/browse${search ? `?${search}` : ""}`);
}

// ─── Video page ──────────────────────────────────────────────────────────────

/**
 * The video grid.
 *
 * Note the singular `/api/video`. The plural `/api/videos` is the older
 * `kind = 'video'` view and returns nothing for ingested YouTube content,
 * because every ingested upload is stored as audio for the music player.
 */
export async function getVideosPage(query: {
  category?: string;
  region?: string;
  q?: string;
  sort?: VideoSort;
  limit?: number;
  offset?: number;
} = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "" && value !== "all") params.set(key, String(value));
  }
  const search = params.toString();
  return fetchJson<VideoPage>(`/api/video${search ? `?${search}` : ""}`);
}

export async function getVideoFacets() { return fetchJson<VideoFacets>("/api/video/facets"); }

/** Accepts our row id or a bare YouTube id, which is what a shared link carries. */
export async function getVideoDetail(id: string) {
  return fetchJson<VideoDetail>(`/api/video/${encodeURIComponent(id)}`);
}

// ─── Reels ───────────────────────────────────────────────────────────────────

/**
 * The feed.
 *
 * `authedFetch` rather than `fetchJson`, because the "Following" tab and the
 * follow buttons on every card are the viewer's own state and are invisible to
 * an anonymous request. Called from a server component it degrades to exactly
 * the anonymous behaviour, which is the right first paint, and the client
 * re-asks with the session once it has one.
 */
export async function getReels(
  query: { feed?: ReelFeedName; category?: string; region?: string; limit?: number; offset?: number } = {},
): Promise<ReelPage> {
  const params = new URLSearchParams();
  params.set("feed", query.feed ?? "for-you");
  if (query.category && query.category !== "all") params.set("category", query.category);
  if (query.region && query.region !== "all") params.set("region", query.region);
  params.set("limit", String(query.limit ?? 10));
  if (query.offset) params.set("offset", String(query.offset));
  const res = await authedFetch(`/api/reels?${params.toString()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function getReelFacets(): Promise<ReelFacets> {
  const res = await authedFetch("/api/reels/categories", { cache: "no-store" });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function getReel(videoId: string): Promise<ReelDetail> {
  const res = await authedFetch(`/api/reels/${encodeURIComponent(videoId)}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

/** An article's related rail: real links first, then inference, both marked. */
export async function getNewsRelated(idOrSlug: string): Promise<NewsRelated> {
  return fetchJson<NewsRelated>(`/api/news/${encodeURIComponent(idOrSlug)}/related`);
}

// ─── Comments ────────────────────────────────────────────────────────────────

export async function getComments(
  targetType: CommentTargetType,
  targetId: string,
  limit = 20,
  offset = 0,
): Promise<CommentThread> {
  const params = new URLSearchParams({ targetType, targetId, limit: String(limit), offset: String(offset) });
  const res = await authedFetch(`/api/comments?${params.toString()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function postComment(
  targetType: CommentTargetType,
  targetId: string,
  body: string,
  parentId?: string | null,
): Promise<Comment> {
  const res = await authedFetch("/api/comments", {
    method: "POST",
    body: JSON.stringify({ targetType, targetId, body, parentId: parentId ?? null }),
  });
  if (!res.ok) throw new Error((await res.text()) || `API error: ${res.status}`);
  return res.json();
}

export async function toggleCommentLike(commentId: string): Promise<{ liked: boolean; likeCount: number }> {
  const res = await authedFetch(`/api/comments/${encodeURIComponent(commentId)}/like`, { method: "POST" });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function deleteComment(commentId: string): Promise<{ deleted: boolean }> {
  const res = await authedFetch(`/api/comments/${encodeURIComponent(commentId)}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

// ─── Follows ─────────────────────────────────────────────────────────────────

export async function getFollows(): Promise<FollowsResponse> {
  const res = await authedFetch("/api/follows", { cache: "no-store" });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function followTarget(
  type: FollowTargetType,
  id: string,
  label: string,
  notifyNew = true,
): Promise<{ following: boolean }> {
  const res = await authedFetch("/api/follows", {
    method: "POST",
    body: JSON.stringify({ type, id, label, notifyNew }),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function unfollowTarget(type: FollowTargetType, id: string): Promise<{ following: boolean }> {
  const res = await authedFetch(`/api/follows/${encodeURIComponent(type)}/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

/** "Not interested" — server-side, so it holds on the next device too. */
export async function hideReel(videoId: string, reason?: string): Promise<{ hidden: boolean }> {
  const res = await authedFetch(`/api/reels/${encodeURIComponent(videoId)}/hide`, {
    method: "POST",
    body: JSON.stringify({ reason: reason ?? "not-interested" }),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

/**
 * The heart on a reel.
 *
 * One route for both directions because a like is one row and the server
 * decides the new state; the caller renders what it is told rather than
 * assuming its own click did what it meant.
 */
export async function toggleReelLike(videoId: string): Promise<{ liked: boolean; likeCount: number }> {
  const res = await authedFetch(`/api/reels/${encodeURIComponent(videoId)}/like`, { method: "POST" });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}
