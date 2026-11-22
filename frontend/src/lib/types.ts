export type MediaKind = "audio" | "video" | "hymn" | "sermon";

export type Track = {
  id: string;
  title: string;
  artist: string;
  album: string;
  image: string;
  duration: string;
  language: string;
  kind: MediaKind;
  progress?: number;
};

export type NewsItem = {
  id: string;
  category: string;
  title: string;
  excerpt: string;
  source: string;
  date: string;
  image: string;
  readTime: string;
};

/**
 * `GET /api/news/detail` and `GET /api/news/:idOrSlug`.
 *
 * The list endpoint strips the article down to a card, so anything that needs
 * the story — the reading view, related-story matching, byline and region — has
 * to come through the detail shape.
 */
export type NewsArticle = NewsItem & {
  slug: string;
  body: string | null;
  region: string | null;
  tags: string[];
  author: string | null;
  featured: boolean;
  publishedAt: string;
  readTimeMinutes: number;
  status: "draft" | "published" | "archived";
};

/** `GET /api/news/facets` — the category chips with real counts. */
export type NewsFacets = {
  categories: { category: string; count: number }[];
  regions: string[];
};

export type Church = {
  id: string;
  name: string;
  location: string;
  service: string;
  image: string;
  status?: "Live now" | "Verified";
  distance: string;
  latitude: number;
  longitude: number;
};

/**
 * A scheduled service. Seeded churches store a bare label ("Sabbath 09:00"),
 * admin-created churches store a structured slot — both shapes reach the UI.
 */
export type ServiceTime = { day: string; name: string; time: string; language?: string };

/** `GET /api/churches/:idOrSlug` — the record behind a selected church. */
export type ChurchDetail = Church & {
  slug: string;
  address: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  /** Null when the church has never recorded a membership figure. */
  members: number | null;
  established: string | null;
  description: string | null;
  ministries: string[];
  serviceTimes: Array<string | ServiceTime>;
  verified: boolean;
  isLive: boolean;
  upcomingEvents: EventItem[];
  createdAt: string;
};

export type Hymn = {
  id: string;
  number: string;
  title: string;
  edition: string;
  /** Short hymnal identifier, e.g. "SDAH" or "CIS-swahili". */
  editionCode: string | null;
  language: string;
  duration: string;
  image: string;
  /** Null for hymns no configured theme range covers. */
  theme: string | null;
};

/** The `GET /api/hymns/:id` shape: a hymn plus everything the reader needs. */
export type HymnDetail = Hymn & {
  sortNumber?: number;
  editionId?: string;
  editionCode?: string;
  publisher?: string | null;
  copyright?: string;
  tune?: string | null;
  meter?: string | null;
  musicalKey?: string | null;
  verseCount?: number;
  lyrics?: string | null;
  themeSlug?: string | null;
  downloadable?: boolean;
  audioUrl?: string | null;
  status?: string;
};

export type HymnEdition = {
  id: string;
  name: string;
  code: string;
  language: string;
  year: number | null;
  publisher: string | null;
  rights: string | null;
  description: string | null;
  hymnCount: number;
};

export type HymnTheme = {
  theme: string;
  slug: string | null;
  count: number;
};

export type Sermon = {
  id: string;
  title: string;
  speaker: string;
  topic: string;
  duration: string;
  image: string;
  series: string;
  language: string;
};

export type EventItem = {
  id: string;
  day: string;
  month: string;
  title: string;
  place: string;
  time: string;
  category: string;
  image: string;
  live?: boolean;
  /** The real start, so "this week" can be counted rather than guessed. */
  startsAt?: string;
};

/** Nav card on the home screen: label, supporting note and an icon key. */
export type HomeLink = {
  label: string;
  note: string;
  href: string;
  icon: string;
};

/** "Your day, gathered" row — same shape as a nav card but with `detail`. */
export type DailyPath = {
  label: string;
  detail: string;
  href: string;
  icon: string;
};

/** `GET /api/live` — an authorized broadcast, live or upcoming. */
export type LiveStream = {
  id: string;
  title: string;
  church: string;
  churchId: string | null;
  viewers: string;
  image: string;
  status: string;
  time: string;
  streamUrl: string | null;
  replayUrl: string | null;
  captionsAvailable: boolean;
  multiviewCount: number;
  viewerCount: number;
  language: string;
  category: string;
  chatEnabled: boolean;
  startsAt: string;
  endsAt: string;
  trackId: string | null;
};

/** `GET /api/home` — the whole home screen in one payload. */
export type HomeDashboard = {
  greeting: { name: string; dateLabel: string; locationLabel: string };
  hero: Track & { isLive: boolean; liveStatus: string | null; listenersLabel: string | null; genre: string | null; mood: string | null };
  dailyPaths: DailyPath[];
  quickLinks: HomeLink[];
  continueListening: Track[];
  popularMusic: Track[];
  sections: { id: string; title: string; subtitle: string; image: string; href: string; cta: string }[];
  latestNews: NewsItem[];
  upcomingEvents: EventItem[];
  nearbyChurches: Church[];
  reminder: { title: string; body: string };
  stats: { churches: number; liveNow: number; events: number; tracks: number; hymns: number; sermons: number; news: number };
};

// ─── Music page ──────────────────────────────────────────────────────────────

/** A track on the music page, including the YouTube fields. */
export type MusicTrack = {
  id: string;
  title: string;
  artist: string;
  album: string;
  image: string;
  duration: string;
  language: string;
  kind: MediaKind;
  subCategory: string | null;
  region: string;
  genre: string | null;
  mood: string | null;
  /** Null for editorial tracks. The audio player keys off this. */
  youtubeVideoId: string | null;
  playCount: number;
  releaseDate: string | null;
  tags: string[];
};

/** A quick-access bubble at the top of the music page. */
export type MusicMix = {
  slug: string;
  title: string;
  subtitle: string;
  gradient: [string, string];
  artworkSeed: string;
  trackIds: string[];
  count: number;
};

/** One horizontal row of the music page. */
export type MusicRow = { id: string; title: string; subtitle: string; tracks: MusicTrack[] };

export type MusicHome = {
  mixes: MusicMix[];
  rows: MusicRow[];
  hero: MusicTrack | null;
  totalTracks: number;
  totalDurationSeconds: number;
};

export type MusicFacets = {
  regions: { region: string; label: string; count: number }[];
  categories: { category: string; count: number }[];
};

export type MixDetail = { mix: MusicMix; tracks: MusicTrack[] };

// ─── Video page ──────────────────────────────────────────────────────────────

/**
 * A card in the video grid. Deliberately not `Track`: the video page answers a
 * different question (what is watchable) and needs a view count, a Live flag and
 * a category that includes sermons, none of which the audio row carries.
 */
export type VideoCard = {
  id: string;
  videoId: string;
  title: string;
  channel: string;
  thumbnail: string;
  duration: string;
  /** The raw length in seconds, for rules that must not parse the label. */
  durationSeconds: number;
  views: number;
  likes: number;
  publishedAt: string;
  language: string;
  region: string;
  regionLabel: string;
  category: "choirs" | "hymns" | "instrumentals" | "acapella" | "worship" | "sermons";
  isLive: boolean;
  watchUrl: string;
};

export type VideoSort = "newest" | "views" | "oldest" | "added";

export type VideoPage = { items: VideoCard[]; total: number };

export type VideoFacets = {
  categories: { id: string; label: string; count: number }[];
  regions: { id: string; label: string; count: number }[];
  total: number;
};

/** `GET /api/video/:id` — everything the player page renders. */
export type VideoDetail = {
  video: VideoCard;
  description: string;
  channel: { id: string; title: string; handle: string | null; country: string | null };
  more: VideoCard[];
};

/** `GET /api/search` — every kind of media flattened into one card shape. */
export type SearchResult = {
  id: string;
  type: "Music" | "Hymns" | "Sermons" | "News" | "Churches" | "Events" | "Videos" | "Bible";
  title: string;
  subtitle: string;
  meta: string;
  image: string;
  href: string;
  entityType: string;
  entityId: string;
  language: string;
  availability: string;
};

// ─── Reminders ───────────────────────────────────────────────────────────────

/** `GET /api/push/config` — public, so it can be read before login. */
/**
 * `GET /api/push/config`.
 *
 * `publicKey` is the VAPID *public* key, and is `null` whenever `configured` is
 * false — the two are never in disagreement, because the server derives the key
 * from the private one and cannot produce a public half without it.
 */
export type PushConfig = { configured: boolean; publicKey: string | null };

/**
 * One registered device, from `GET /api/push/subscriptions`.
 *
 * There is deliberately no `endpoint` here. A push endpoint is a long,
 * push-service-specific secret-ish string, and a client that only needs to know
 * "is this row mine?" gets `endpointFingerprint` — the first 16 hex characters of
 * the SHA-256 of the endpoint, which the browser computes itself from its own
 * endpoint to find its row.
 */
export type PushSubscriptionSummary = {
  id: string;
  label: string | null;
  createdAt: string;
  lastSuccessAt: string | null;
  endpointFingerprint: string;
};

export type PushStatus = {
  configured: boolean;
  publicKey: string | null;
  /** Always "default": the browser owns the real permission, not the server. */
  permission: "default" | "granted" | "denied" | "unsupported";
  subscriptionCount: number;
  devices: PushSubscriptionSummary[];
};

/** The reminder preferences the modal renders, from `GET /api/preferences`. */
export type ReminderPreferences = {
  remindersEnabled: boolean;
  notifyDailyVerse: boolean;
  dailyVerseTime: string;
  notifyReadingStreak: boolean;
  streakReminderTime: string;
  notifyLiveWorship: boolean;
  liveAlertLeadMinutes: number;
  notifyNewHymns: boolean;
  readingStreak: { current: number; best: number; lastDay: string | null };
};

/** `GET /api/reading/streak`. */
export type ReadingStreak = { current: number; best: number; lastDay: string | null };

// ─── Reels ───────────────────────────────────────────────────────────────────

/** The feed's shelf ids. `for-you` is the unfiltered feed, not a classification. */
export type ReelCategoryId =
  | "for-you" | "worship" | "choirs" | "mission" | "youth" | "bible" | "testimonies"
  | "sermons" | "church-life" | "events" | "education" | "community" | "hymns"
  | "instrumentals" | "acapella";

export type ReelCategory = {
  id: ReelCategoryId;
  label: string;
  description: string;
  position: number;
};

/**
 * A reel.
 *
 * `videoId` is the YouTube id and is what the player is given, while `id` is the
 * app's own id for the same row (`yt-<videoId>` for a track, a seeded id for a
 * sermon). Comments and follows key off `videoId`, because that is the one
 * identifier both a track row and a sermon row agree on.
 */
export type Reel = VideoCard & {
  reelCategory: ReelCategoryId;
  reelCategoryLabel: string;
  channelId: string;
  channelFollowers: number;
  isFollowingChannel: boolean;
  commentCount: number;
  /**
   * Named apart from `VideoCard.likes`, which is the video page's YouTube-side
   * total. This one is counted from `reel_likes` and knows whether *you* liked
   * it, and overwriting `likes` with it would make the two pages disagree about
   * the same number.
   */
  likeCount: number;
  liked: boolean;
  shareCount: number;
  weight: number;
};

export type ReelFeedName = "for-you" | "following";

export type ReelPage = {
  items: Reel[];
  total: number;
  feed: ReelFeedName;
  /**
   * False when the reader follows nothing, or follows nothing that has published
   * a reel — the general feed is standing in, and the client says so rather than
   * showing an empty page that looks broken.
   */
  personalised: boolean;
  hasMore: boolean;
};

export type ReelFacets = {
  categories: { id: ReelCategoryId; label: string; count: number }[];
  regions: { id: string; label: string; count: number }[];
  total: number;
  all: ReelCategory[];
};

export type ReelDetail = {
  reel: Reel;
  description: string;
  comments: CommentSummary;
  more: Reel[];
  related: RelatedItem[];
};

/** One piece of real related content, from `content_links` or from inference. */
export type RelatedItem = {
  type: "article" | "reel" | "church" | "track" | "sermon" | "event";
  id: string;
  title: string;
  subtitle: string | null;
  href: string;
  imageUrl: string | null;
  meta: string | null;
  /** `inferred` was worked out from shared words, not chosen by an editor. */
  via: "linked" | "inferred";
};

// ─── Comments ────────────────────────────────────────────────────────────────

export type CommentTargetType = "reel" | "article" | "church" | "track" | "sermon" | "event";

export type CommentAuthor = { id: string; name: string; avatarUrl: string | null };

export type Comment = {
  id: string;
  targetType: CommentTargetType;
  targetId: string;
  body: string;
  likeCount: number;
  liked: boolean;
  createdAt: string;
  author: CommentAuthor;
  replies: Comment[];
  replyCount: number;
  /** Set on an optimistic row that the server has not confirmed yet. */
  pending?: boolean;
};

export type CommentSummary = { comments: number; likes: number; participants: number };

export type CommentThread = {
  items: Comment[];
  total: number;
  summary: CommentSummary;
};

// ─── Follows ─────────────────────────────────────────────────────────────────

export type FollowTargetType = "creator" | "choir" | "church" | "ministry" | "topic" | "region";

export type FollowEntry = {
  type: FollowTargetType;
  id: string;
  label: string;
  meta: Record<string, unknown>;
  notifyNew: boolean;
  createdAt: string;
};

export type FollowsSummary = {
  total: number;
  churches: number;
  creators: number;
  topics: number;
  regions: number;
  ministries: number;
  choirs: number;
};

export type FollowsResponse = { items: FollowEntry[]; summary: FollowsSummary };

export type NewsRelated = { items: RelatedItem[]; comments: CommentSummary };
