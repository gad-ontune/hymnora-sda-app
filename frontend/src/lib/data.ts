import {
  getTracks, getHeroTrack, getHome, getLiveStreams, getVideos, getHymns, getSermons,
  getNews, getNewsArticles, getNewsFacets, getNewsArticle, recordNewsView,
  getChurches, getEvents, search,
  getMusicHome, getMusicFacets, getMix, browseMusic,
  getVideosPage, getVideoFacets, getVideoDetail, getReels, getReelFacets, getReel, getNewsRelated,
  getChurchesNearby, getChurchDetail, getLiveChurches,
} from "./api";
import type {
  Track, Hymn, Sermon, NewsItem, NewsArticle, NewsFacets, Church, ChurchDetail, EventItem,
  HomeDashboard, LiveStream,
  MusicHome, MusicFacets, MixDetail, VideoPage, VideoFacets, VideoDetail,
  ReelPage, ReelFacets, ReelDetail, NewsRelated,
} from "./types";

export async function getTracksData(): Promise<Track[]> { return getTracks(); }
export async function getHeroTrackData(): Promise<Track> { return getHeroTrack(); }
export async function getHomeData(): Promise<HomeDashboard> { return getHome(); }
export async function getLiveStreamsData(): Promise<LiveStream[]> { return getLiveStreams(); }
export async function getVideosData(): Promise<Track[]> { return getVideos(); }
export async function getHymnsData(): Promise<Hymn[]> { return getHymns(); }
export async function getSermonsData(): Promise<Sermon[]> { return getSermons(); }
export async function getNewsData(): Promise<NewsItem[]> { return getNews(); }
export async function getNewsArticlesData(): Promise<NewsArticle[]> { return getNewsArticles(); }
export async function getNewsFacetsData(): Promise<NewsFacets> { return getNewsFacets(); }
export async function getNewsArticleData(idOrSlug: string): Promise<NewsArticle> { return getNewsArticle(idOrSlug); }
export async function recordArticleView(idOrSlug: string): Promise<void> { return recordNewsView(idOrSlug); }
export async function getChurchesData(): Promise<Church[]> { return getChurches(); }

/**
 * The radius search the "churches near me" map runs on, and the record behind a
 * selected church. `getChurchesData` is the whole directory — the map never asks
 * for it once a position is known, because a list of every church in the country
 * is the wrong answer to "what is within 2 km of me".
 */
export async function getNearbyChurchesData(lat: number, lng: number, radiusKm: number): Promise<Church[]> {
  return getChurchesNearby(lat, lng, radiusKm);
}
export async function getChurchDetailData(idOrSlug: string): Promise<ChurchDetail> {
  return getChurchDetail(idOrSlug);
}
export async function getLiveChurchesData(): Promise<Church[]> { return getLiveChurches(); }

/**
 * Reels. The newsroom asks only for the count behind its "Reels" link; the reels
 * page itself takes the whole first page, because a full-bleed feed that fills
 * in after hydration is the empty dark rectangle this page exists to avoid.
 */
export async function getReelCountData(): Promise<number> {
  const page = await getReels({ limit: 1 });
  return page.total;
}
export async function getReelsData(query: Parameters<typeof getReels>[0] = {}): Promise<ReelPage> { return getReels(query); }
export async function getReelFacetsData(): Promise<ReelFacets> { return getReelFacets(); }
export async function getReelData(videoId: string): Promise<ReelDetail> { return getReel(videoId); }
export async function getNewsRelatedData(idOrSlug: string): Promise<NewsRelated> { return getNewsRelated(idOrSlug); }
export async function getEventsData(): Promise<EventItem[]> { return getEvents(); }
export async function getSearchData(q: string) { return search(q); }

// ─── Music and video pages ───────────────────────────────────────────────────

/**
 * The music and video pages fetch on the server and pass the result down, rather
 * than pulling in a client-side effect: the first paint then already has the
 * rows, and a filter change is the only thing that refetches.
 */
export async function getMusicHomeData(limit?: number): Promise<MusicHome> { return getMusicHome(limit); }
export async function getMusicFacetsData(): Promise<MusicFacets> { return getMusicFacets(); }
export async function getMixData(slug: string, limit?: number): Promise<MixDetail> { return getMix(slug, limit); }
export async function browseMusicData(query: Parameters<typeof browseMusic>[0] = {}) { return browseMusic(query); }

export async function getVideoPageData(query: Parameters<typeof getVideosPage>[0] = {}): Promise<VideoPage> {
  return getVideosPage(query);
}
export async function getVideoFacetsData(): Promise<VideoFacets> { return getVideoFacets(); }
export async function getVideoDetailData(id: string): Promise<VideoDetail> { return getVideoDetail(id); }

export type {
  Track, Hymn, Sermon, NewsItem, NewsArticle, NewsFacets, Church, EventItem,
  HomeDashboard, LiveStream,
  MusicTrack, MusicMix, MusicRow, MusicHome, MusicFacets, MixDetail,
  VideoCard, VideoPage, VideoFacets, VideoDetail, VideoSort,
} from "./types";
