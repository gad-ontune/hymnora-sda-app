/**
 * Domain types for the Hymnora SDA platform.
 *
 * The six entity shapes at the top (`Track`, `Hymn`, `Sermon`, `NewsItem`,
 * `Church`, `EventItem`) are byte-for-byte compatible with the shapes the
 * Next.js frontend already consumes in `src/lib/types.ts`, so the frontend can
 * swap its in-memory mock data for these endpoints without touching a single
 * component. Everything below the "extended" marker is additive: fields the
 * current UI does not render yet but that a real platform needs (rights,
 * offline availability, transcripts, coordinates, moderation state).
 */

// ─── Frontend-compatible core shapes ─────────────────────────────────────────

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
  /**
   * Set on everything the ingest filter approved as music. The frontend's audio
   * extractor reads this: with it, playback goes through the YouTube IFrame
   * player in audio-only mode; without it, the track has a real file URL.
   */
  youtubeVideoId?: string | null;
  /** `choirs` | `hymns` | `instrumentals` | `acapella` | `worship`. */
  subCategory?: string | null;
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

export type ChurchStatus = "Live now" | "Verified";

export type Church = {
  id: string;
  name: string;
  location: string;
  service: string;
  image: string;
  status?: ChurchStatus;
  distance: string;
  latitude: number;
  longitude: number;
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
  /**
   * The machine-readable start, alongside the three formatted parts above.
   *
   * `day`, `month` and `time` are for a card. Anything that has to *count* —
   * "live this week", "new this week" — needs a date it can compare against
   * now, and re-parsing three display strings is how a week silently becomes a
   * month at a month boundary.
   */
  startsAt: string;
};

// ─── Extended shapes (superset of the above) ─────────────────────────────────

export type PublishStatus = "draft" | "published" | "archived";
export type Availability = "any" | "live" | "replay" | "download";
export type UserRole = "member" | "moderator" | "editor" | "admin";
export type UserStatus = "active" | "invited" | "suspended";

export type TrackDetail = Track & {
  albumId: string | null;
  audioUrl: string | null;
  videoUrl: string | null;
  streamUrl: string | null;
  durationSeconds: number;
  genre: string | null;
  mood: string | null;
  isLive: boolean;
  liveStatus: string | null;
  captionsAvailable: boolean;
  downloadable: boolean;
  isExplicit: boolean;
  featured: boolean;
  playCount: number;
  likeCount: number;
  releaseDate: string | null;
  lyrics: string | null;
  credits: Credit[];
  status: PublishStatus;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Credit = { role: string; name: string };

export type Album = {
  id: string;
  title: string;
  artist: string;
  coverUrl: string | null;
  releaseDate: string | null;
  description: string | null;
  kind: MediaKind;
  trackCount: number;
};

export type HymnDetail = Hymn & {
  sortNumber: number;
  editionId: string;
  editionCode: string;
  publisher: string | null;
  copyright: string | null;
  tune: string | null;
  meter: string | null;
  musicalKey: string | null;
  verseCount: number;
  lyrics: string | null;
  themeSlug: string | null;
  downloadable: boolean;
  audioUrl: string | null;
  status: PublishStatus;
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

export type SermonDetail = Sermon & {
  speakerBio: string | null;
  seriesId: string | null;
  description: string | null;
  scriptureReference: string | null;
  durationSeconds: number;
  audioUrl: string | null;
  videoUrl: string | null;
  downloadable: boolean;
  captionsAvailable: boolean;
  transcript: string | null;
  chapters: SermonChapter[];
  playCount: number;
  publishedAt: string | null;
  status: PublishStatus;
};

export type SermonChapter = { at: number; label: string };

export type SermonSeries = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  coverUrl: string | null;
  speaker: string | null;
  episodeCount: number;
};

export type NewsArticle = NewsItem & {
  slug: string;
  body: string | null;
  region: string | null;
  tags: string[];
  author: string | null;
  featured: boolean;
  publishedAt: string;
  readTimeMinutes: number;
  status: PublishStatus;
};

export type ChurchDetail = Church & {
  slug: string;
  address: string | null;
  city: string;
  region: string | null;
  country: string;
  countryCode: string | null;
  conference: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  members: number | null;
  established: string | null;
  description: string | null;
  ministries: string[];
  serviceTimes: ServiceTime[];
  verified: boolean;
  isLive: boolean;
  upcomingEvents: EventItem[];
  createdAt: string;
};

export type ServiceTime = {
  day: string;
  name: string;
  time: string;
  language?: string;
};

export type EventDetail = EventItem & {
  slug: string;
  description: string | null;
  startsAt: string;
  endsAt: string | null;
  isOnline: boolean;
  city: string | null;
  country: string | null;
  churchId: string | null;
  attendingCount: number;
  capacity: number | null;
  isSaved: boolean;
  status: PublishStatus;
};

export type LiveStream = {
  id: string;
  title: string;
  church: string;
  churchId: string | null;
  viewers: string;
  image: string;
  status: LiveStreamStatus;
  time: string;
  streamUrl: string | null;
  replayUrl: string | null;
  captionsAvailable: boolean;
  multiviewCount: number;
  viewerCount: number;
  language: string;
  category: string;
  chatEnabled: boolean;
  startsAt: string | null;
  endsAt: string | null;
  trackId: string | null;
};

export type LiveStreamStatus = "Live now" | "Starting soon" | "Upcoming" | "Recently ended";

export type BibleVersion = {
  id: string;
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

export type BibleBook = {
  id: string;
  name: string;
  abbreviation: string;
  testament: "Old" | "New";
  bookNumber: number;
  chapterCount: number;
  verseCount: number;
};

export type BibleVerse = {
  id: string;
  book: string;
  bookAbbreviation: string;
  chapter: number;
  verse: number;
  text: string;
};

export type BiblePassage = {
  version: BibleVersion;
  reference: string;
  book: string;
  chapter: number;
  verses: BibleVerse[];
  text: string;
  verseCount: number;
};

export type BibleBookmark = {
  id: string;
  versionId: string;
  reference: string;
  book: string;
  chapter: number;
  verse: number;
  text: string;
  highlightColor: string | null;
  note: string | null;
  createdAt: string;
};

export type Collection = {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  image: string;
  itemCount: number;
  curator: string | null;
  kind: "music" | "video" | "mixed";
  tone: string | null;
  items: Track[];
};

export type Playlist = {
  id: string;
  title: string;
  description: string | null;
  coverUrl: string | null;
  isPublic: boolean;
  itemCount: number;
  totalDurationSeconds: number;
  createdAt: string;
  updatedAt: string;
  items: PlaylistItem[];
};

export type PlaylistItem = {
  id: string;
  itemType: ContentType;
  itemId: string;
  position: number;
  note: string | null;
  addedAt: string;
  title: string;
  subtitle: string;
  image: string;
  duration: string;
};

export type PlayHistoryEntry = {
  id: string;
  itemType: ContentType;
  itemId: string;
  title: string;
  subtitle: string;
  image: string;
  duration: string;
  playedAt: string;
  progressPercent: number;
  completed: boolean;
};

export type Note = {
  id: string;
  itemType: ContentType;
  itemId: string;
  itemTitle: string;
  body: string;
  timestampSeconds: number | null;
  reference: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DownloadRecord = {
  id: string;
  itemType: ContentType;
  itemId: string;
  title: string;
  subtitle: string;
  image: string;
  duration: string;
  quality: string;
  sizeBytes: number | null;
  downloadedAt: string;
  expiresAt: string | null;
};

export type SearchResult = {
  id: string;
  type: string;
  title: string;
  subtitle: string;
  meta: string;
  image: string;
  href: string;
  entityType: ContentType | "bible" | "ministry";
  entityId: string;
  language: string | null;
  availability: Availability;
  score?: number;
};

export type User = {
  id: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  firstName: string;
  lastName: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  homeChurchId: string | null;
  homeChurchName: string | null;
  city: string | null;
  country: string | null;
  language: string;
  emailVerified: boolean;
  lastLoginAt: string | null;
  createdAt: string;
};

export type UserPreferences = {
  language: string;
  theme: "light" | "warm" | "dark" | "system";
  readingTheme: "cream" | "light" | "dark";
  readerFontSize: number;
  autoplay: boolean;
  crossfade: boolean;
  normalizeVolume: boolean;
  downloadQuality: "standard" | "high" | "lossless";
  dataSaver: boolean;
  captions: boolean;
  bedroomMode: boolean;
  notifyNewContent: boolean;
  notifyLiveEvents: boolean;
  notifyWeeklyLetter: boolean;
  /**
   * Reminders are device-level push, not an in-app inbox. The master switch is
   * `remindersEnabled`; the three per-purpose flags below are the only three
   * things the Reminders modal exposes.
   */
  remindersEnabled: boolean;
  notifyDailyVerse: boolean;
  /** `HH:MM`, in the user's own timezone. */
  dailyVerseTime: string;
  notifyReadingStreak: boolean;
  streakReminderTime: string;
  notifyLiveWorship: boolean;
  liveAlertLeadMinutes: number;
  notifyNewHymns: boolean;
  readingStreak: { current: number; best: number; lastDay: string | null };
  eventReminderMinutes: number;
  defaultBibleVersion: string;
  bibleTranslation: string;
  followedTopics: string[];
  updatedAt: string;
};

export type Notification = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  href: string | null;
  readAt: string | null;
  createdAt: string;
};

export type MediaAsset = {
  id: string;
  kind: "image" | "audio" | "video" | "document";
  filename: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
  altText: string | null;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  createdAt: string;
};

export type HomeDashboard = {
  greeting: { name: string; dateLabel: string; locationLabel: string };
  hero: TrackDetail & { listenersLabel: string };
  dailyPaths: { label: string; detail: string; href: string; icon: string }[];
  quickLinks: { label: string; note: string; href: string; icon: string }[];
  continueListening: Track[];
  popularMusic: Track[];
  sections: { id: string; title: string; subtitle: string; image: string; href: string; cta: string }[];
  latestNews: NewsArticle[];
  upcomingEvents: EventItem[];
  nearbyChurches: Church[];
  reminder: { title: string; body: string };
  stats: { churches: number; liveNow: number; events: number; tracks: number; hymns: number; sermons: number; news: number };
};

// ─── Shared enumerations ─────────────────────────────────────────────────────

export type ContentType =
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

export const CONTENT_TYPES: ContentType[] = [
  "track",
  "hymn",
  "sermon",
  "news",
  "church",
  "event",
  "video",
  "collection",
  "bible_verse",
  "bible_book",
  "live_stream",
  "ministry",
];

/** Frontend route for each content type — powers search results and share links. */
export const CONTENT_TYPE_ROUTES: Record<ContentType, string> = {
  track: "/music",
  hymn: "/hymns",
  sermon: "/sermons",
  news: "/news",
  church: "/churches",
  event: "/events",
  video: "/videos",
  collection: "/music",
  bible_verse: "/bible",
  bible_book: "/bible",
  live_stream: "/live",
  ministry: "/churches",
};

/**
 * Labels the frontend search tabs filter on.
 *
 * Every label must be one of the frontend's tab names — "Live" and
 * "Ministries" are not tabs, so those two are folded onto the nearest tab
 * that exists (a live stream is a video; a ministry sits with the churches)
 * rather than being filed under a name no reader can click.
 */
export const CONTENT_TYPE_LABELS: Record<ContentType, string> = {
  track: "Music",
  hymn: "Hymns",
  sermon: "Sermons",
  news: "News",
  church: "Churches",
  event: "Events",
  video: "Videos",
  collection: "Music",
  bible_verse: "Bible",
  bible_book: "Bible",
  live_stream: "Videos",
  ministry: "Churches",
};
