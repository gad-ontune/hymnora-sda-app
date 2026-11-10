import { env } from "../config/env.ts";
import { all, closeDatabase, exec, run, transaction } from "./client.ts";
import { runMigrations } from "./migrate.ts";
import { themeFor } from "./hymnThemes.ts";
import { slugify, stableId } from "../lib/http.ts";
import { hashPassword } from "../lib/password.ts";
import { CHANNEL_WHITELIST } from "../modules/youtube/whitelist.ts";
import { validateWhitelistShape } from "../modules/youtube/whitelist-check.ts";
import { backfillArticlePlaces, backfillContentLinks, backfillReelCategories, seedReelCategories } from "../modules/reels/backfill.ts";

/**
 * Demo dataset.
 *
 * Ids are derived with {@link stableId} from natural keys so re-seeding is
 * idempotent — running `npm run seed` twice updates rows instead of duplicating
 * them, and cross-table references stay stable.
 */

const now = () => new Date().toISOString();
const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

type UserSeed = {
  email: string;
  firstName: string;
  lastName: string;
  role: "member" | "moderator" | "editor" | "admin";
  city: string | null;
  country: string | null;
  homeChurchId: string | null;
};

const USERS: UserSeed[] = [
  { email: "admin@hymnora.app", firstName: "Ada", lastName: "Okonkwo", role: "admin", city: "Nairobi", country: "Kenya", homeChurchId: "church-nairobi-central" },
  { email: "editor@hymnora.app", firstName: "Samuel", lastName: "Mwangi", role: "editor", city: "Kisumu", country: "Kenya", homeChurchId: "church-kisumu-hope" },
  { email: "moderator@hymnora.app", firstName: "Grace", lastName: "Wanjiru", role: "moderator", city: "Nakuru", country: "Kenya", homeChurchId: "church-nakuru-ridge" },
  { email: "member@hymnora.app", firstName: "Peter", lastName: "Kamau", role: "member", city: "Mombasa", country: "Kenya", homeChurchId: "church-mombasa-harbour" },
  { email: "reader@hymnora.app", firstName: "Mary", lastName: "Achieng", role: "member", city: "Kisii", country: "Kenya", homeChurchId: null },
];

type TrackSeed = {
  key: string;
  title: string;
  artist: string;
  album: string;
  seconds: number;
  language: string;
  kind: "audio" | "video" | "hymn" | "sermon";
  genre: string;
  mood: string;
  plays: number;
  featured?: boolean;
  downloadable?: boolean;
  captions?: boolean;
  live?: boolean;
  liveStatus?: string;
  release: string;
  lyrics?: string;
};

const TRACKS: TrackSeed[] = [
  { key: "t1", title: "Nearer, My God, to Thee", artist: "Hymnora Singers", album: "Songs of Worship", seconds: 254, language: "English", kind: "hymn", genre: "Hymn", mood: "Reverent", plays: 18420, featured: true, downloadable: true, captions: true, release: "2024-01-14" },
  { key: "t2", title: "What a Friend We Have in Jesus", artist: "Hymnora Singers", album: "Songs of Worship", seconds: 221, language: "English", kind: "hymn", genre: "Hymn", mood: "Comforting", plays: 15980, featured: true, downloadable: true, release: "2024-01-14" },
  { key: "t3", title: "Amazing Grace", artist: "Grace Wanjiru", album: "Grace & Mercy", seconds: 238, language: "English", kind: "audio", genre: "Gospel", mood: "Grateful", plays: 14210, downloadable: true, release: "2024-03-02" },
  { key: "t4", title: "Thine Be the Glory", artist: "Hymnora Singers", album: "Easter Victories", seconds: 265, language: "English", kind: "hymn", genre: "Hymn", mood: "Triumphant", plays: 12140, featured: true, release: "2024-04-21" },
  { key: "t5", title: "Wakme Yesu (Wake, Jesus)", artist: "Peter Kamau", album: "Swahili Worship", seconds: 289, language: "Kiswahili", kind: "audio", genre: "Afro-gospel", mood: "Awakening", plays: 11095, captions: true, release: "2024-05-11" },
  { key: "t6", title: "Just As I Am", artist: "Hymnora Singers", album: "Songs of Worship", seconds: 212, language: "English", kind: "hymn", genre: "Hymn", mood: "Surrender", plays: 9840, release: "2024-01-14" },
  { key: "t7", title: "Bwana Yesu Karibu", artist: "Peter Kamau", album: "Swahili Worship", seconds: 276, language: "Kiswahili", kind: "audio", genre: "Afro-gospel", mood: "Welcoming", plays: 8720, captions: true, release: "2024-05-11" },
  { key: "t8", title: "Because He Lives", artist: "Mary Achieng", album: "Living Hope", seconds: 248, language: "English", kind: "audio", genre: "Contemporary", mood: "Hopeful", plays: 8115, featured: true, downloadable: true, release: "2024-06-30" },
  { key: "t9", title: "The Old Rugged Cross", artist: "Hymnora Singers", album: "Easter Victories", seconds: 259, language: "English", kind: "hymn", genre: "Hymn", mood: "Devotional", plays: 7640, release: "2024-04-21" },
  { key: "t10", title: "Nyimbo za Mwanga", artist: "Peter Kamau", album: "Swahili Worship", seconds: 301, language: "Kiswahili", kind: "audio", genre: "Afro-gospel", mood: "Reflective", plays: 6930, captions: true, release: "2024-05-11" },
  { key: "t11", title: "Morning Has Broken", artist: "Grace Wanjiru", album: "Grace & Mercy", seconds: 227, language: "English", kind: "hymn", genre: "Hymn", mood: "Peaceful", plays: 6120, downloadable: true, release: "2024-03-02" },
  { key: "t12", title: "Battle of the Cross", artist: "Hymnora Singers", album: "Songs of Worship", seconds: 294, language: "English", kind: "hymn", genre: "Hymn", mood: "Solemn", plays: 5480, release: "2024-01-14" },
  { key: "t13", title: "Sermon: The Narrow Gate", artist: "Samuel Mwangi", album: "Living Water Series", seconds: 2280, language: "English", kind: "sermon", genre: "Sermon", mood: "Exhortation", plays: 4210, captions: true, release: "2024-07-07" },
  { key: "t14", title: "Sermon: Abide in Me", artist: "Samuel Mwangi", album: "Living Water Series", seconds: 2460, language: "English", kind: "sermon", genre: "Sermon", mood: "Devotional", plays: 3880, captions: true, release: "2024-07-14" },
  { key: "t15", title: "Sermon: The Good Shepherd", artist: "Ada Okonkwo", album: "Pastoral Care", seconds: 2105, language: "English", kind: "sermon", genre: "Sermon", mood: "Pastoral", plays: 3405, captions: true, release: "2024-08-04" },
  { key: "t16", title: "Sabbath School Live Worship", artist: "Hymnora Live", album: "Live Sessions", seconds: 3120, language: "English", kind: "audio", genre: "Live", mood: "Worship", plays: 2870, live: true, liveStatus: "Live now", release: "2024-09-01" },
  { key: "t17", title: "Choir Magnificat", artist: "Hymnora Singers", album: "Songs of Worship", seconds: 302, language: "English", kind: "video", genre: "Hymn", mood: "Majestic", plays: 2540, captions: true, release: "2024-02-08" },
  { key: "t18", title: "How Great Thou Art", artist: "Grace Wanjiru", album: "Grace & Mercy", seconds: 268, language: "English", kind: "audio", genre: "Hymn", mood: "Awed", plays: 2180, downloadable: true, release: "2024-03-02" },
  { key: "t19", title: "Tumaini (Hope)", artist: "Mary Achieng", album: "Living Hope", seconds: 285, language: "Kiswahili", kind: "audio", genre: "Contemporary", mood: "Hopeful", plays: 1960, captions: true, release: "2024-06-30" },
  { key: "t20", title: "Draw Nearer", artist: "Hymnora Singers", album: "Easter Victories", seconds: 274, language: "English", kind: "hymn", genre: "Hymn", mood: "Intimate", plays: 1725, release: "2024-04-21" },
  { key: "t21", title: "Hymn 330 · A room for rest", artist: "Chuo cha Upendo", album: "Songs of Worship", seconds: 1100, language: "English", kind: "video", genre: "Hymn", mood: "Reverent", plays: 9410, featured: true, captions: true, release: "2024-05-05" },
  { key: "t22", title: "Light of the world · Nairobi", artist: "Mwangaza Voices", album: "Living Hope", seconds: 764, language: "English", kind: "video", genre: "Contemporary", mood: "Majestic", plays: 8320, captions: true, release: "2024-06-16" },
  { key: "t23", title: "Sabbath rest in the city", artist: "Chuo cha Upendo", album: "Songs of Worship", seconds: 948, language: "Kiswahili", kind: "video", genre: "Afro-gospel", mood: "Peaceful", plays: 7045, downloadable: true, release: "2024-07-21" },
  { key: "t24", title: "Cross and crown · a choral film", artist: "Hymnora Singers", album: "Easter Victories", seconds: 1236, language: "English", kind: "video", genre: "Hymn", mood: "Devotional", plays: 6180, captions: true, release: "2024-08-25" },
  { key: "t25", title: "Mwingieo wa asubuhi", artist: "Peter Kamau", album: "Swahili Worship", seconds: 872, language: "Kiswahili", kind: "video", genre: "Afro-gospel", mood: "Awakening", plays: 5290, release: "2024-09-15" },
];

const ALBUMS = [
  { key: "album-songs", title: "Songs of Worship", artist: "Hymnora Singers", year: 2024 },
  { key: "album-grace", title: "Grace & Mercy", artist: "Grace Wanjiru", year: 2024 },
  { key: "album-easter", title: "Easter Victories", artist: "Hymnora Singers", year: 2024 },
  { key: "album-swahili", title: "Swahili Worship", artist: "Peter Kamau", year: 2024 },
  { key: "album-hope", title: "Living Hope", artist: "Mary Achieng", year: 2024 },
  { key: "album-series", title: "Living Water Series", artist: "Samuel Mwangi", year: 2024 },
  { key: "album-pastoral", title: "Pastoral Care", artist: "Ada Okonkwo", year: 2024 },
  { key: "album-live", title: "Live Sessions", artist: "Hymnora Live", year: 2024 },
];

const CHURCHES = [
  { id: "church-nairobi-central", name: "Nairobi Central SDA", location: "Nairobi, Kenya", service: "Sabbat 10:00 & 15:00", lat: -1.2921, lon: 36.8219, status: "Live now", image: "https://images.unsplash.com/photo-1432900012587-113b17d4b6d3?w=800" },
  { id: "church-kisumu-hope", name: "Kisumu Hope Fellowship", location: "Kisumu, Kenya", service: "Sat 09:00", lat: -0.0917, lon: 34.768, status: "Verified", image: "https://images.unsplash.com/photo-1548013146-72479768bada?w=800" },
  { id: "church-nakuru-ridge", name: "Nakuru Ridge Church", location: "Nakuru, Kenya", service: "Sat 10:30", lat: -0.3031, lon: 36.08, status: "Verified", image: "https://images.unsplash.com/photo-1529070538774-1843cb3265df?w=800" },
  { id: "church-mombasa-harbour", name: "Mombasa Harbour SDA", location: "Mombasa, Kenya", service: "Sat 08:00 & 14:00", lat: -4.0435, lon: 39.6682, status: "Verified", image: "https://images.unsplash.com/photo-1590059390047-0e8b0d0d0e8e?w=800" },
  { id: "church-kisii-hills", name: "Kisii Hills Chapel", location: "Kisii, Kenya", service: "Sun 09:30", lat: -6.7053, lon: 39.5586, status: "Verified", image: "https://images.unsplash.com/photo-1465101162946-4377e57745c3?w=800" },
];

type LiveStreamSeed = {
  key: string;
  title: string;
  church: string;
  status: "Live now" | "Starting soon" | "Upcoming" | "Recently ended";
  category: string;
  language: string;
  viewers: number;
  captions?: boolean;
  multiview?: number;
  trackKey?: string;
  /** Minutes from now: negative for streams that already started or ended. */
  inMinutes: number;
  minutesLong?: number;
  image: string;
};

const LIVE_STREAMS: LiveStreamSeed[] = [
  { key: "ls1", title: "Nairobi Central Sabbath Worship", church: "church-nairobi-central", status: "Live now", category: "Worship service", language: "English", viewers: 1840, captions: true, multiview: 4, trackKey: "t16", inMinutes: -35, minutesLong: 90, image: "https://images.unsplash.com/photo-1432900012587-113b17d4b6d3?w=800" },
  { key: "ls2", title: "Hope in the gathering", church: "church-kisumu-hope", status: "Live now", category: "Concert", language: "English", viewers: 642, captions: true, multiview: 2, inMinutes: -12, minutesLong: 60, image: "https://images.unsplash.com/photo-1466428996289-fb355538da1b?w=800" },
  { key: "ls3", title: "Youth Sabbath: Rooted", church: "church-nairobi-central", status: "Starting soon", category: "Youth programme", language: "English", viewers: 0, captions: true, inMinutes: 120, minutesLong: 75, image: "https://images.unsplash.com/photo-1523240795612-9a054b0db644?w=800" },
  { key: "ls4", title: "Choir Magnificat live", church: "church-mombasa-harbour", status: "Starting soon", category: "Choir", language: "English", viewers: 0, multiview: 3, inMinutes: 240, minutesLong: 50, image: "https://images.unsplash.com/photo-1504052434569-70ad5836ab65?w=800" },
  { key: "ls5", title: "Nyimbo za Umoja", church: "church-nakuru-ridge", status: "Upcoming", category: "Worship service", language: "Kiswahili", viewers: 0, captions: true, inMinutes: 2_880, minutesLong: 90, image: "https://images.unsplash.com/photo-1465101162946-4377e57745c3?w=800" },
  { key: "ls6", title: "A reflection for the week ahead", church: "church-kisii-hills", status: "Recently ended", category: "Devotional", language: "English", viewers: 318, captions: true, inMinutes: -1_440, minutesLong: 30, image: "https://images.unsplash.com/photo-1507692049790-de58290a4334?w=800" },
];

type NewsSeed = { key: string; category: string; title: string; excerpt: string; source: string; days: number; image: string };

const NEWS: NewsSeed[] = [
  { key: "n1", category: "Church", title: "New believers class breaks record at Nairobi Central", excerpt: "Over 120 people joined the baptismal preparation programme this quarter, the largest since 2019.", source: "Adventist News", days: 1, image: "https://images.unsplash.com/photo-1529070538774-1843cb3265df?w=800" },
  { key: "n2", category: "Mission", title: "Youth team completes water project in Tana River", excerpt: "Four boreholes now serve roughly 1,800 people across three villages in the Tana delta.", source: "Horizons", days: 2, image: "https://images.unsplash.com/photo-1541544181051-e46607bc22a4?w=800" },
  { key: "n3", category: "Health", title: "Community clinic opens in Kisumu Hope Fellowship", excerpt: "The clinic offers maternal health services three days a week, staffed by volunteer nurses.", source: "Adventist Health", days: 4, image: "https://images.unsplash.com/photo-1519494026892-80bbd2d6fd0d?w=800" },
  { key: "n4", category: "Education", title: "Scholarship fund sends 45 students to university", excerpt: "The fund, seeded by alumni giving, covered full tuition for 45 students across five campuses.", source: "Campus Life", days: 6, image: "https://images.unsplash.com/photo-1523240795612-9a054b0db644?w=800" },
  { key: "n5", category: "Worship", title: "Hymnora Singers release Easter Victories album", excerpt: "Twelve traditional hymns recorded live with the full choir and organ at Nairobi Central.", source: "Hymnora", days: 8, image: "https://images.unsplash.com/photo-1466428996289-fb355538da1b?w=800" },
  { key: "n6", category: "Church", title: "Nakuru Ridge dedicates a new solar-powered sanctuary", excerpt: "The 600-seat hall runs entirely on solar, cutting fuel costs to near zero.", source: "Adventist News", days: 11, image: "https://images.unsplash.com/photo-1507692049790-de58290a4334?w=800" },
  { key: "n7", category: "Mission", title: "Literature evangelists report record scripture distribution", excerpt: "More than 30,000 pieces of literature were distributed across the union in Q2.", source: "Horizons", days: 14, image: "https://images.unsplash.com/photo-1504052434569-70ad5836ab65?w=800" },
  { key: "n8", category: "Health", title: "Mental health counselling added to pastoral care training", excerpt: "Training now covers listening skills and referral pathways for church leaders.", source: "Adventist Health", days: 17, image: "https://images.unsplash.com/photo-1573497019940-1c28c88b4f3e?w=800" },
];

type EventSeed = { key: string; title: string; place: string; time: string; category: string; inDays: number; live?: boolean; image: string };

const EVENTS: EventSeed[] = [
  { key: "e1", title: "Sabbath School Convention", place: "Kisumu Hope Fellowship", time: "08:00", category: "Sabbath School", inDays: 3, image: "https://images.unsplash.com/photo-1529070538774-1843cb3265df?w=800" },
  { key: "e2", title: "Nairobi Central Live Worship", place: "Nairobi Central SDA", time: "10:00", category: "Worship", inDays: 1, live: true, image: "https://images.unsplash.com/photo-1432900012587-113b17d4b6d3?w=800" },
  { key: "e3", title: "Marriage Enrichment Seminar", place: "Nakuru Ridge Church", time: "14:00", category: "Family", inDays: 6, image: "https://images.unsplash.com/photo-1511632765486-a01980e01a18?w=800" },
  { key: "e4", title: "Health Expo & Free Screening", place: "Mombasa Harbour SDA", time: "09:00", category: "Health", inDays: 9, image: "https://images.unsplash.com/photo-1519494026892-80bbd2d6fd0d?w=800" },
  { key: "e5", title: "Evangelism Week Kick-off", place: "Kisii Hills Chapel", time: "07:30", category: "Outreach", inDays: 12, image: "https://images.unsplash.com/photo-1504052434569-70ad5836ab65?w=800" },
  { key: "e6", title: "Choir Masterclass", place: "Nairobi Central SDA", time: "16:00", category: "Music", inDays: 15, image: "https://images.unsplash.com/photo-1466428996289-fb355538da1b?w=800" },
  { key: "e7", title: "Pathfinder Investiture", place: "Kisumu Hope Fellowship", time: "10:00", category: "Youth", inDays: 18, image: "https://images.unsplash.com/photo-1523240795612-9a054b0db644?w=800" },
  { key: "e8", title: "Communion & Foot-washing Service", place: "Mombasa Harbour SDA", time: "10:30", category: "Worship", inDays: 21, image: "https://images.unsplash.com/photo-1465101162946-4377e57745c3?w=800" },
];

const SERMON_SERIES = [
  { key: "series-living-water", title: "Living Water", description: "A twelve-week journey through the waters of life, drawing on Ezekiel 47 and the Gospel of John." },
  { key: "series-pastoral", title: "Pastoral Care", description: "Practical theology for those who shepherd others: grief, marriage, and spiritual formation." },
];

const SERMONS = [
  { key: "s1", seriesKey: "series-living-water", title: "The Narrow Gate", speaker: "Samuel Mwangi", topic: "Discipleship", minutes: 38, day: 7, plays: 4210, language: "English" },
  { key: "s2", seriesKey: "series-living-water", title: "Abide in Me", speaker: "Samuel Mwangi", topic: "Prayer", minutes: 41, day: 14, plays: 3880, language: "English" },
  { key: "s3", seriesKey: "series-living-water", title: "Living Water", speaker: "Samuel Mwangi", topic: "Grace", minutes: 36, day: 21, plays: 3510, language: "English" },
  { key: "s4", seriesKey: "series-pastoral", title: "The Good Shepherd", speaker: "Ada Okonkwo", topic: "Shepherding", minutes: 35, day: 4, plays: 3405, language: "English" },
  { key: "s5", seriesKey: "series-pastoral", title: "Bearing One Another's Burdens", speaker: "Ada Okonkwo", topic: "Community", minutes: 39, day: 11, plays: 2980, language: "English" },
  { key: "s6", seriesKey: "series-pastoral", title: "The Comforting Spirit", speaker: "Ada Okonkwo", topic: "Consolation", minutes: 33, day: 18, plays: 2610, language: "English" },
];

const HYMNS = [
  { key: "h1", number: "004", title: "Nearer, My God, to Thee", edition: "Hymns and Carols of the Seventh-day Adventist", language: "English", seconds: 254, theme: "Devotion" },
  { key: "h2", number: "010", title: "What a Friend We Have in Jesus", edition: "Hymns and Carols of the Seventh-day Adventist", language: "English", seconds: 221, theme: "Comfort" },
  { key: "h3", number: "007", title: "Amazing Grace", edition: "Hymns and Carols of the Seventh-day Adventist", language: "English", seconds: 238, theme: "Grace" },
  { key: "h4", number: "142", title: "Thine Be the Glory", edition: "Hymns and Carols of the Seventh-day Adventist", language: "English", seconds: 265, theme: "Resurrection" },
  { key: "h5", number: "018", title: "Just As I Am", edition: "Hymns and Carols of the Seventh-day Adventist", language: "English", seconds: 212, theme: "Surrender" },
  { key: "h6", number: "089", title: "The Old Rugged Cross", edition: "Hymns and Carols of the Seventh-day Adventist", language: "English", seconds: 259, theme: "Atonement" },
  { key: "h7", number: "023", title: "Battle of the Cross", edition: "Hymns and Carols of the Seventh-day Adventist", language: "English", seconds: 294, theme: "Sanctification" },
  { key: "h8", number: "051", title: "Morning Has Broken", edition: "Hymns and Carols of the Seventh-day Adventist", language: "English", seconds: 227, theme: "Praise" },
  { key: "h9", number: "076", title: "How Great Thou Art", edition: "Hymns and Carols of the Seventh-day Adventist", language: "English", seconds: 268, theme: "Worship" },
  { key: "h10", number: "215", title: "Draw Nearer", edition: "Hymns and Carols of the Seventh-day Adventist", language: "English", seconds: 274, theme: "Communion" },
];

const BIBLE_VERSIONS = [
  { key: "kjv", name: "King James Version", code: "KJV", year: 1611, language: "English", status: "Public domain" },
  { key: "web", name: "World English Bible", code: "WEB", year: 2020, language: "English", status: "Public domain" },
  { key: "niv", name: "New International Version", code: "NIV", year: 2011, language: "English", status: "Licensed" },
  { key: "nasb", name: "New American Standard Bible", code: "NASB", year: 1995, language: "English", status: "Licensed" },
];

/**
 * Books carry their real chapter/verse counts so the reader can navigate the
 * whole canon. Text is seeded for a representative set of chapters; remaining
 * chapters are marked pending so counts stay honest until a full import runs.
 */
const BOOKS: {
  key: string;
  name: string;
  abbr: string;
  chapters: number;
  verses: number;
  testament: "old" | "new";
  text?: Record<string, Record<string, string>>;
}[] = [
  {
    key: "gen", name: "Genesis", abbr: "Gen", chapters: 50, verses: 1533, testament: "old",
    text: {
      "1": {
        "1": "In the beginning God created the heaven and the earth.",
        "2": "And the earth was without form, and void; and darkness was upon the face of the deep. And the Spirit of God moved upon the face of the waters.",
        "3": "And God said, Let there be light: and there was light.",
        "26": "And God said, Let us make man in our image, after our likeness: and let them have dominion over the fish of the sea, and over the fowl of the heaven, and over the cattle of the earth, and over all the earth.",
      },
    },
  },
  {
    key: "psa", name: "Psalms", abbr: "Ps", chapters: 150, verses: 2276, testament: "old",
    text: {
      "23": {
        "1": "The LORD is my shepherd; I shall not want.",
        "2": "He maketh me to lie down in green pastures: he leadeth me beside the still waters.",
        "3": "He restoreth my soul: he leadeth me in the paths of righteousness for his name's sake.",
        "4": "Yea, though I walk through the valley of the shadow of death, I will fear no evil: for thou art with me; thy rod and thy staff they comfort me.",
      },
    },
  },
  {
    key: "pro", name: "Proverbs", abbr: "Prov", chapters: 31, verses: 915, testament: "old",
    text: {
      "3": {
        "5": "Trust in the LORD with all thine heart; and lean not unto thine own understanding.",
        "6": "In all thy ways acknowledge him, and he shall direct thy paths.",
      },
    },
  },
  {
    key: "matt", name: "Matthew", abbr: "Matt", chapters: 28, verses: 1071, testament: "new",
    text: {
      "5": {
        "3": "Blessed are the poor in spirit: for theirs is the kingdom of heaven.",
        "4": "Blessed are they that mourn: for they shall be comforted.",
        "5": "Blessed are the meek: for they shall inherit the earth.",
      },
      "6": {
        "33": "But seek ye first the kingdom of God, and his righteousness; and all these things shall be added unto you.",
      },
    },
  },
  {
    key: "mark", name: "Mark", abbr: "Mark", chapters: 16, verses: 678, testament: "new",
    text: {
      "1": {
        "1": "The beginning of the gospel of Jesus Christ, the Son of God.",
      },
    },
  },
  {
    key: "luke", name: "Luke", abbr: "Luke", chapters: 24, verses: 1151, testament: "new",
    text: {
      "2": {
        "14": "And it came to pass, when the days were fulfilled that they should be circumcised, he was called Jesus: and his name was so called by the angel before he was conceived.",
      },
    },
  },
  {
    key: "john", name: "John", abbr: "John", chapters: 21, verses: 879, testament: "new",
    text: {
      "1": {
        "1": "In the beginning was the Word, and the Word was with God, and the Word was God.",
        "3": "All things were made by him; and without him was not any thing made that was made.",
        "14": "And the Word was made flesh, and dwelt among us, and we beheld his glory, the glory as of the only begotten of the Father, full of grace and truth.",
      },
      "3": {
        "16": "For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.",
        "17": "For God sent not his Son into the world to condemn the world; but that the world through him might be saved.",
      },
    },
  },
  { key: "acts", name: "Acts", abbr: "Acts", chapters: 28, verses: 1150, testament: "new" },
  { key: "rom", name: "Romans", abbr: "Rom", chapters: 16, verses: 433, testament: "new" },
  { key: "heb", name: "Hebrews", abbr: "Heb", chapters: 13, verses: 641, testament: "new" },
  { key: "rev", name: "Revelation", abbr: "Rev", chapters: 22, verses: 404, testament: "new" },
];

export type SeedSummary = {
  users: number;
  albums: number;
  tracks: number;
  churches: number;
  events: number;
  news: number;
  sermons: number;
  hymns: number;
  bibleVersions: number;
  bibleBooks: number;
  bibleVerses: number;
  collections: number;
  liveStreams: number;
  youtubeChannels: number;
};

function truncateAll(): void {
  // Discover the real table set rather than hardcoding an order that can drift
  // out of sync with the schema. `search_index_fts` is excluded: it is an FTS5
  // shadow table and must be driven by its triggers, not emptied directly.
  const tables = all<{ name: string }>(
    `SELECT name FROM sqlite_master
      WHERE type = 'table'
        AND name NOT LIKE 'sqlite_%'
        AND name NOT LIKE '%_fts%'
        AND name NOT LIKE '\\_migrations' ESCAPE '\\'
      ORDER BY name`,
  ).map((row) => row.name);

  // Foreign keys are disabled for the wipe so table order stops mattering, and
  // any table we cannot clear is reported rather than silently skipped.
  exec("PRAGMA foreign_keys = OFF");
  const failures: string[] = [];
  try {
    for (const table of tables) {
      try {
        run(`DELETE FROM ${table}`);
      } catch (error) {
        failures.push(`${table}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } finally {
    exec("PRAGMA foreign_keys = ON");
  }

  if (failures.length > 0) {
    throw new Error(`[seed] could not reset tables:\n  ${failures.join("\n  ")}`);
  }
}

/**
 * Inserts a seed row, or updates it in place when the key already exists.
 *
 * Ids come from {@link stableId}, so re-running `npm run seed` refreshes the
 * demo dataset instead of failing on a UNIQUE constraint.
 *
 * Columns listed in `literals` are emitted as raw SQL instead of placeholders,
 * so they are omitted from `values`. `conflict` names the constraint to resolve:
 * `"id"` for tables with a synthetic primary key, or an explicit column list for
 * the polymorphic library tables that use a composite primary key.
 */
function upsert(
  table: string,
  columns: string[],
  values: unknown[],
  options: { conflict?: string; literals?: Record<string, string> } = {},
): void {
  const { conflict = "id", literals = {} } = options;
  const placeholders = columns.map((column) => literals[column] ?? "?");
  const keyColumns = new Set(conflict.split(",").map((column) => column.trim()));
  const assignments = columns
    .filter((column) => !keyColumns.has(column) && !(column in literals))
    .map((column) => `${column} = excluded.${column}`);
  run(
    `INSERT INTO ${table} (${columns.join(", ")})
     VALUES (${placeholders.join(", ")})
     ON CONFLICT(${conflict}) DO UPDATE SET ${assignments.join(", ")}`,
    values as never[],
  );
}

/**
 * The channel whitelist goes into the database from a code constant, not from a
 * fixture file.
 *
 * That is deliberate: the whitelist is a security boundary (it is the only
 * thing the poller is allowed to spend quota on) and a constant is the only
 * form of it that is reviewed in a diff. Editing `modules/youtube/whitelist.ts`
 * and re-seeding is a code change with an audit trail, which a JSON file
 * edited in place does not have.
 *
 * A malformed id aborts the seed rather than landing in the table. See the
 * warning at the top of `whitelist.ts` for why that failure has to be loud.
 */
function seedYouTubeWhitelist(counts: SeedSummary): void {
  const problems = validateWhitelistShape();
  if (problems.length > 0) {
    throw new Error(
      `[seed] the channel whitelist has ${problems.length} problem(s):\n  ` +
        problems.map((problem) => `${problem.title} (${problem.channelId}) — ${problem.problem}`).join("\n  "),
    );
  }

  for (const channel of CHANNEL_WHITELIST) {
    upsert(
      "youtube_channels",
      ["id", "title", "handle", "channel_id", "country", "region", "language", "focus", "denomination", "is_active", "max_new_per_run", "created_at", "updated_at"],
      [
        stableId("yt-channel", channel.channelId),
        channel.title,
        channel.handle,
        channel.channelId,
        channel.country,
        channel.region,
        channel.language,
        channel.focus,
        channel.denomination,
        channel.denomination === "sda" ? 1 : 0,
        12,
        now(),
        now(),
      ],
      { conflict: "channel_id" },
    );
    counts.youtubeChannels += 1;
  }
}

export async function seed(options: { reset?: boolean } = {}): Promise<SeedSummary> {
  if (options.reset) truncateAll();

  const counts: SeedSummary = {
    users: 0, albums: 0, tracks: 0, churches: 0, events: 0, news: 0,
    sermons: 0, hymns: 0, bibleVersions: 0, bibleBooks: 0, bibleVerses: 0, collections: 0,
    liveStreams: 0, youtubeChannels: 0,
  };

  seedYouTubeWhitelist(counts);

  const passwordHash = await hashPassword(env.seedDemoPassword);

  transaction(() => {
    // ── Churches ──
    for (const church of CHURCHES) {
      const [city = "", country = ""] = church.location.split(",").map((part) => part.trim());
      const isLive = church.status === "Live now";
      upsert(
        "churches",
        ["id", "slug", "name", "location", "city", "country", "latitude", "longitude",
         "service", "service_times", "image", "verified", "is_live", "live_status", "is_active", "created_at", "updated_at"],
        [church.id, slugify(church.name), church.name, church.location, city, country,
          church.lat, church.lon, church.service, JSON.stringify([church.service]), church.image,
          1, isLive ? 1 : 0, isLive ? "Live now" : null, 1, daysAgo(30), now()],
      );
      counts.churches += 1;
    }

    // ── Users ──
    for (const user of USERS) {
      upsert(
        "users",
        ["id", "email", "password_hash", "role", "status", "first_name", "last_name", "display_name",
          "city", "country", "home_church_id", "language", "email_verified_at", "updated_at"],
        [stableId("user", user.email), user.email, passwordHash, user.role, user.firstName, user.lastName,
          `${user.firstName} ${user.lastName}`, user.city, user.country, user.homeChurchId ?? null, now(), now()],
        { literals: { status: "'active'", language: "'English'" } },
      );
      counts.users += 1;
    }
    const memberId = stableId("user", "member@hymnora.app");

    // ── Albums ──
    const albumIds = new Map<string, string>();
    for (const album of ALBUMS) {
      const id = stableId("album", album.key);
      albumIds.set(album.key, id);
      upsert(
        "albums",
        ["id", "title", "artist", "release_date", "kind", "created_at", "updated_at"],
        [id, album.title, album.artist, `${album.year}-01-01`, now(), now()],
        { literals: { kind: "'audio'" } },
      );
      counts.albums += 1;
    }

    // ── Tracks ──
    const trackIds = new Map<string, string>();
    const albumKeyByTitle = new Map(ALBUMS.map((a) => [a.title, a.key]));
    for (const track of TRACKS) {
      const id = stableId("track", track.key);
      trackIds.set(track.key, id);
      const albumKey = albumKeyByTitle.get(track.album);
      upsert(
        "tracks",
        ["id", "title", "artist", "album_id", "album", "image", "audio_url", "stream_url", "duration_seconds",
          "language", "kind", "genre", "mood", "is_live", "live_status", "captions_available", "downloadable",
          "featured", "play_count", "like_count", "release_date", "credits", "view_count", "status", "published_at", "created_at", "updated_at"],
        [id, track.title, track.artist, albumKey ? albumIds.get(albumKey)! : null, track.album,
          `https://images.unsplash.com/photo-1511379938547-c1f69419868d?w=600`,
          `/media/tracks/${track.key}.mp3`, `/media/tracks/${track.key}.m3u8`, track.seconds,
          track.language, track.kind, track.genre, track.mood, track.live ? 1 : 0, track.liveStatus ?? null,
          track.captions ? 1 : 0, track.downloadable ? 1 : 0, track.featured ? 1 : 0,
          track.plays, Math.round(track.plays * 0.08), track.release,
          Math.round(track.plays * 3), track.release, daysAgo(60), now()],
        { literals: { credits: "'[]'", status: "'published'" } },
      );
      counts.tracks += 1;
    }

    // ── Collections ──
    const collectionSeeds = [
      { key: "c1", title: "Sabbath Morning Worship", tone: "Reverent", featured: true, tracks: ["t1", "t2", "t6", "t9", "t12"] },
      { key: "c2", title: "Swahili Worship", tone: "Joyful", featured: true, tracks: ["t5", "t7", "t10", "t19"] },
      { key: "c3", title: "Easter & Resurrection", tone: "Triumphant", featured: false, tracks: ["t4", "t9", "t20"] },
      { key: "c4", title: "Quiet Morning", tone: "Peaceful", featured: false, tracks: ["t11", "t18", "t3"] },
    ];
    for (const collection of collectionSeeds) {
      const id = stableId("collection", collection.key);
      upsert(
        "collections",
        ["id", "title", "slug", "description", "kind", "tone", "curator", "featured", "item_count", "created_at", "updated_at"],
        [id, collection.title, collection.title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
          `A curated ${collection.tone.toLowerCase()} selection for the week.`, collection.tone,
          collection.featured ? 1 : 0, collection.tracks.length, now(), now()],
        { literals: { kind: "'music'", curator: "'Hymnora Editorial'" } },
      );
      collection.tracks.forEach((trackKey, position) => {
        upsert(
          "collection_items",
          ["id", "collection_id", "track_id", "position"],
          [stableId("ci", collection.key, trackKey), id, trackIds.get(trackKey)!, position],
        );
      });
      counts.collections += 1;
    }

    // ── Live streams ──
    // Offsets are relative to "now" so the schedule stays believable every time
    // the seed runs, and `status` is what the live page filters its tabs on.
    const churchNameById = new Map(CHURCHES.map((church) => [church.id, church.name]));
    for (const stream of LIVE_STREAMS) {
      const startsAt = new Date(Date.now() + stream.inMinutes * 60_000);
      const endsAt = new Date(startsAt.getTime() + (stream.minutesLong ?? 60) * 60_000);
      upsert(
        "live_streams",
        ["id", "title", "church_id", "church_name", "status", "image", "stream_url", "replay_url",
          "viewer_count", "captions_available", "multiview_count", "language", "category", "chat_enabled",
          "track_id", "starts_at", "ends_at", "view_count", "created_at", "updated_at"],
        [stableId("live", stream.key), stream.title, stream.church, churchNameById.get(stream.church) ?? "",
          stream.status, stream.image, `/streams/${stream.key}.m3u8`,
          stream.status === "Recently ended" ? `/streams/${stream.key}-replay.mp4` : null,
          stream.viewers, stream.captions ? 1 : 0, stream.multiview ?? 1, stream.language, stream.category,
          1, stream.trackKey ? trackIds.get(stream.trackKey) ?? null : null,
          startsAt.toISOString(), endsAt.toISOString(), stream.viewers * 3, daysAgo(2), now()],
      );
      counts.liveStreams += 1;
    }

    // ── Hymns ──
    const editionName = "Hymns and Carols of the Seventh-day Adventist";
    const editionId = stableId("edition", "hcasda");
    upsert(
      "hymn_editions",
      ["id", "name", "code", "language", "year", "publisher", "description", "created_at"],
      [editionId, editionName, "HCASDA", 1987, "Adventist Review",
        "The official hymnal of the Seventh-day Adventist Church.", now()],
      { literals: { language: "'English'" } },
    );
    for (const hymn of HYMNS) {
      // Themes come from assets/hymn-themes.json so the seed and the browse chips
      // can never drift apart. HYMNS[].theme is the fallback for a hymn the config
      // does not cover yet.
      const theme = themeFor("HCASDA", hymn.number) ?? { name: hymn.theme, slug: slugify(hymn.theme) };
      upsert(
        "hymns",
        ["id", "number", "sort_number", "title", "edition_id", "edition", "language", "theme", "theme_slug",
          "duration_seconds", "image", "audio_url", "status", "created_at", "updated_at"],
        [stableId("hymn", hymn.key), hymn.number, Number.parseInt(hymn.number, 10) || 0, hymn.title,
          editionId, editionName, hymn.language, theme.name, theme.slug, hymn.seconds,
          `https://images.unsplash.com/photo-1466428996289-fb355538da1b?w=600`,
          `/media/hymns/${hymn.key}.mp3`, daysAgo(90), now()],
        { literals: { status: "'published'" } },
      );
      counts.hymns += 1;
    }

    // ── Bible ──
    const versionIds = new Map<string, string>();
    for (const version of BIBLE_VERSIONS) {
      const id = stableId("bver", version.key);
      versionIds.set(version.key, id);
      upsert(
        "bible_versions",
        ["id", "name", "language", "language_code", "status", "publisher", "year", "description", "created_at"],
        [id, version.name, version.language, version.status, "Bible Society", version.year,
          `${version.name} (${version.code})`, now()],
        { literals: { language_code: "'en'" } },
      );
      counts.bibleVersions += 1;
    }

    const kjvId = versionIds.get("kjv")!;
    let bookOrdinal = 0;
    for (const book of BOOKS) {
      bookOrdinal += 1;
      const bookId = stableId("bbook", book.key);
      upsert(
        "bible_books",
        ["id", "version_id", "name", "abbreviation", "testament", "book_number", "chapter_count", "verse_count"],
        [bookId, kjvId, book.name, book.abbr, book.testament === "old" ? "Old" : "New",
          bookOrdinal, book.chapters, book.verses],
      );
      counts.bibleBooks += 1;

      for (const [chapter, verses] of Object.entries(book.text ?? {})) {
        for (const [verse, text] of Object.entries(verses)) {
          upsert(
            "bible_verses",
            ["id", "version_id", "book_id", "book", "chapter", "verse", "text"],
            [stableId("bverse", book.key, chapter, verse), kjvId, bookId, book.name,
              Number.parseInt(chapter, 10), Number.parseInt(verse, 10), text],
          );
          counts.bibleVerses += 1;
        }
      }
      run("UPDATE bible_versions SET books_count = (SELECT COUNT(*) FROM bible_books WHERE version_id = bible_versions.id) WHERE id = ?", [kjvId]);
    }

    // ── Sermons ──
    const speakerIds = new Map<string, string>();
    const speakers = [
      { key: "samuel", name: "Samuel Mwangi", title: "Pastor" },
      { key: "ada", name: "Ada Okonkwo", title: "Pastor" },
    ];
    for (const speaker of speakers) {
      const id = stableId("speaker", speaker.key);
      speakerIds.set(speaker.key, id);
      upsert(
        "speakers",
        ["id", "name", "slug", "title", "image", "bio", "created_at"],
        [id, speaker.name, slugify(speaker.name), speaker.title,
          `https://images.unsplash.com/photo-1560250097-0b93528c311a?w=400`,
          `${speaker.name} has pastored for over a decade and teaches regularly on grace and discipleship.`, now()],
      );
    }

    // `speaker` and `series` are denormalised onto `sermons` so list queries
    // never need a join; keep them in step with the parent rows above.
    const seriesIds = new Map<string, string>();
    for (const series of SERMON_SERIES) {
      const id = stableId("sseries", series.key);
      seriesIds.set(series.key, id);
      upsert(
        "sermon_series",
        ["id", "name", "slug", "description", "cover_url", "created_at"],
        [id, series.title, slugify(series.title), series.description,
          `https://images.unsplash.com/photo-1432900012587-113b17d4b6d3?w=600`, now()],
      );
    }

    for (const sermon of SERMONS) {
      const speakerKey = sermon.speaker.startsWith("Samuel") ? "samuel" : "ada";
      const series = SERMON_SERIES.find((s) => s.key === sermon.seriesKey)!;
      upsert(
        "sermons",
        ["id", "title", "speaker_id", "speaker", "topic", "series_id", "series", "image", "duration_seconds",
          "language", "audio_url", "captions_available", "play_count", "status", "published_at", "created_at", "updated_at"],
        [stableId("sermon", sermon.key), sermon.title, speakerIds.get(speakerKey)!, sermon.speaker,
          sermon.topic, seriesIds.get(sermon.seriesKey)!, series.title,
          `https://images.unsplash.com/photo-1432900012587-113b17d4b6d3?w=600`,
          sermon.minutes * 60, sermon.language, `/media/sermons/${sermon.key}.mp3`,
          sermon.plays, daysAgo(sermon.day), daysAgo(sermon.day + 1), now()],
        { literals: { captions_available: "1", status: "'published'" } },
      );
      counts.sermons += 1;
    }

    // ── News ──
    for (const article of NEWS) {
      upsert(
        "news_articles",
        ["id", "slug", "title", "category", "excerpt", "body", "source", "image", "tags", "featured", "view_count", "published_at", "status", "created_at", "updated_at"],
        [stableId("news", article.key), slugify(article.title).slice(0, 90), article.title, article.category,
          article.excerpt, `${article.excerpt}\n\n${article.excerpt}`, article.source, article.image,
          JSON.stringify([article.category]), article.days * 137, daysAgo(article.days), daysAgo(article.days), now()],
        { literals: { featured: "0", status: "'published'" } },
      );
      counts.news += 1;
    }

    // ── Events ──
    for (const event of EVENTS) {
      const at = new Date(Date.now() + event.inDays * 86_400_000);
      upsert(
        "events",
        ["id", "slug", "title", "category", "place", "starts_at", "ends_at", "is_live", "is_online", "image", "status", "created_at", "updated_at"],
        [stableId("event", event.key), slugify(event.title).slice(0, 90), event.title, event.category,
          event.place, at.toISOString(), new Date(at.getTime() + 3 * 3_600_000).toISOString(),
          event.live ? 1 : 0, event.image, now(), now()],
        { literals: { is_online: "1", status: "'published'" } },
      );
      counts.events += 1;
    }

    // ── Personalised starter data for the demo member ──
    // Library tables are polymorphic (`item_type` + `item_id`) so the same
    // tables back tracks, hymns, sermons and articles.
    for (const key of ["t1", "t3", "t8", "t13"]) {
      upsert(
        "favorites",
        ["user_id", "item_type", "item_id", "created_at"],
        [memberId, trackIds.get(key)!, daysAgo(3)],
        { conflict: "user_id, item_type, item_id", literals: { item_type: "'track'" } },
      );
    }
    upsert(
      "favorites",
      ["user_id", "item_type", "item_id", "created_at"],
      [memberId, stableId("hymn", "h1"), daysAgo(2)],
      { conflict: "user_id, item_type, item_id", literals: { item_type: "'hymn'" } },
    );
    upsert(
      "favorites",
      ["user_id", "item_type", "item_id", "created_at"],
      [memberId, "church-mombasa-harbour", daysAgo(5)],
      { conflict: "user_id, item_type, item_id", literals: { item_type: "'church'" } },
    );

    const playlistId = stableId("playlist", memberId);
    const playlistTracks = ["t1", "t4", "t8"];
    const playlistSeconds = playlistTracks.reduce((total, key) => {
      const track = TRACKS.find((t) => t.key === key)!;
      return total + track.seconds;
    }, 0);
    upsert(
      "playlists",
      ["id", "user_id", "title", "description", "is_public", "item_count", "total_duration_seconds", "created_at", "updated_at"],
      [playlistId, memberId, "Sabbath Listening", "Songs to start the day.",
        playlistTracks.length, playlistSeconds, daysAgo(10), now()],
      { literals: { is_public: "0" } },
    );
    playlistTracks.forEach((key, index) => {
      upsert(
        "playlist_items",
        ["id", "playlist_id", "item_type", "item_id", "position", "created_at"],
        [stableId("pi", memberId, key), playlistId, trackIds.get(key)!, index, now()],
        { literals: { item_type: "'track'" } },
      );
    });

    upsert(
      "play_history",
      ["id", "user_id", "item_type", "item_id", "progress_percent", "seconds_played", "completed", "played_at"],
      [stableId("ph", memberId), memberId, trackIds.get("t1")!, daysAgo(1)],
      { literals: { item_type: "'track'", progress_percent: "42", seconds_played: "106", completed: "0" } },
    );

    upsert(
      "notes",
      ["id", "user_id", "item_type", "item_id", "body", "timestamp_seconds", "reference", "created_at", "updated_at"],
      [stableId("note", memberId), memberId, stableId("sermon", "s2"),
        "The vine and the branches — revisit this before the midweek prayer.", daysAgo(4), daysAgo(4)],
      { literals: { item_type: "'sermon'", timestamp_seconds: "412", reference: "'John 15:5'" } },
    );

    upsert(
      "followed_churches",
      ["user_id", "church_id", "notify_live", "created_at"],
      [memberId, "church-mombasa-harbour", daysAgo(20)],
      { conflict: "user_id, church_id", literals: { notify_live: "1" } },
    );
    upsert(
      "followed_topics",
      ["user_id", "topic_type", "topic", "created_at"],
      [memberId, "Mission", daysAgo(15)],
      { conflict: "user_id, topic_type, topic", literals: { topic_type: "'news'" } },
    );
  });

  // FTS index is external-content; rebuild only if the table exists.
  try {
    exec("INSERT INTO search_index(search_index_fts) VALUES ('rebuild')");
  } catch {
    // FTS table absent in a partial database — search falls back to LIKE.
  }

  return counts;
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

const isDirectRun = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;

if (isDirectRun) {
  const reset = process.argv.includes("--reset");
  runMigrations();
  const counts = await seed({ reset });
  // The feed's derived data is part of seeding rather than a one-off script, so
  // a rule change in `reels/category.ts` is repaired by the next `npm run seed`
  // and never by remembering to go and re-run anything.
  const categories = seedReelCategories();
  const shelves = backfillReelCategories();
  const links = backfillContentLinks();
  const places = backfillArticlePlaces();
  console.log(`[seed]   reel categories  ${categories}`);
  console.log(`[seed]   classified       ${shelves.classified} (${shelves.shelfChanges} moved)`);
  console.log(`[seed]   content links    ${links.linksCreated} created, ${links.linksKept} kept`);
  console.log(`[seed]   place links      ${places.churches} church, ${places.events} event`);
  console.log(`[seed] ${reset ? "reset and " : ""}seeded ${env.databaseFile}`);
  for (const [name, value] of Object.entries(counts)) {
    console.log(`[seed]   ${name.padEnd(14)} ${value}`);
  }
  closeDatabase();
}
