import { z } from "zod";
import { createHash, randomBytes } from "node:crypto";
import { all, get, run, type Row } from "../../db/client.ts";
import { badRequest, conflict, notFound } from "../../lib/errors.ts";
import { newId } from "../../lib/http.ts";
import { parseJson } from "../../lib/text.ts";
import type { MediaAsset, UserPreferences } from "../../types/domain.ts";

/**
 * Newsletter signup, media uploads and user preferences.
 *
 * These are the small platform-wide endpoints that do not belong to a content
 * module: they are not CRUD over published content, but the account and
 * infrastructure surface the frontend needs to boot.
 */

// ─── Newsletter ──────────────────────────────────────────────────────────────

export const subscribeSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address").max(200),
  topics: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  source: z.string().trim().max(120).optional(),
});

/**
 * Subscribes an address.
 *
 * Re-subscribing an existing address flips it back to pending rather than
 * erroring, which is what someone who previously unsubscribed expects when they
 * sign up again. The response never reveals whether the address was known.
 */
export function subscribe(input: z.output<typeof subscribeSchema>): { subscribed: boolean; status: string } {
  const existing = get<{ id: string; status: string }>("SELECT id, status FROM newsletter_subscribers WHERE email = ?", [input.email]);
  if (existing) {
    if (existing.status === "confirmed") return { subscribed: true, status: "confirmed" };
    run(
      `UPDATE newsletter_subscribers
       SET status = 'pending', topics = ?, unsubscribed_at = NULL, token_hash = ?
       WHERE id = ?`,
      [JSON.stringify(input.topics), hashToken(newToken()), existing.id],
    );
    return { subscribed: true, status: "pending" };
  }
  run(
    `INSERT INTO newsletter_subscribers (id, email, status, topics, source, token_hash)
     VALUES (?, ?, 'pending', ?, ?, ?)`,
    [newId(), input.email, JSON.stringify(input.topics), input.source ?? null, hashToken(newToken())],
  );
  return { subscribed: true, status: "pending" };
}

export function unsubscribe(email: string): { unsubscribed: boolean } {
  const result = run(
    `UPDATE newsletter_subscribers
     SET status = 'unsubscribed', unsubscribed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE email = ?`,
    [email.trim().toLowerCase()],
  );
  if (result.changes === 0) throw notFound("Subscriber");
  return { unsubscribed: true };
}

function newToken(): string {
  return randomBytes(24).toString("hex");
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// ─── Media assets ────────────────────────────────────────────────────────────

type AssetRow = Row & {
  id: string;
  kind: string;
  filename: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  url: string;
  alt_text: string | null;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  created_at: string;
};

function toAsset(row: AssetRow): MediaAsset {
  return {
    id: row.id,
    kind: row.kind as MediaAsset["kind"],
    filename: row.filename,
    originalName: row.original_name,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes ?? 0),
    url: row.url,
    altText: row.alt_text,
    width: row.width === null ? null : Number(row.width),
    height: row.height === null ? null : Number(row.height),
    durationSeconds: row.duration_seconds === null ? null : Number(row.duration_seconds),
    createdAt: row.created_at,
  };
}

const assetSelect = `
  id, kind, filename, original_name, mime_type, size_bytes, url, alt_text, width, height,
  duration_seconds, created_at
`;

/** MIME types accepted per asset kind, so an upload cannot smuggle a mismatch. */
const ALLOWED: Record<string, string[]> = {
  image: ["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"],
  audio: ["audio/mpeg", "audio/mp4", "audio/ogg", "audio/wav", "audio/x-m4a"],
  video: ["video/mp4", "video/webm", "application/x-mpegURL", "application/vnd.apple.mpegurl"],
  document: ["application/pdf"],
};

export function allowedMimeTypes(): Record<string, string[]> {
  return ALLOWED;
}

export function assertMimeAllowed(kind: string, mimeType: string): void {
  const allowed = ALLOWED[kind];
  if (!allowed) throw badRequest(`Unknown asset kind "${kind}"`);
  if (!allowed.includes(mimeType)) {
    throw badRequest(`"${mimeType}" is not an accepted ${kind} type`, { allowed });
  }
}

export function recordAsset(input: {
  ownerId: string | null;
  kind: string;
  filename: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  url: string;
  altText?: string | null;
  width?: number | null;
  height?: number | null;
  durationSeconds?: number | null;
  checksum?: string | null;
}): MediaAsset {
  assertMimeAllowed(input.kind, input.mimeType);
  const id = newId();
  run(
    `INSERT INTO media_assets (id, owner_id, kind, filename, original_name, mime_type, size_bytes,
                               storage_path, url, alt_text, width, height, duration_seconds, checksum, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready')`,
    [
      id,
      input.ownerId,
      input.kind,
      input.filename,
      input.originalName,
      input.mimeType,
      input.sizeBytes,
      input.storagePath,
      input.url,
      input.altText ?? null,
      input.width ?? null,
      input.height ?? null,
      input.durationSeconds ?? null,
      input.checksum ?? null,
    ],
  );
  return findAsset(id);
}

export function findAsset(id: string): MediaAsset {
  const row = get<AssetRow>(`SELECT ${assetSelect} FROM media_assets WHERE id = ?`, [id]);
  if (!row) throw notFound("Asset");
  return toAsset(row);
}

export function listAssets(kind?: string, limit = 50): MediaAsset[] {
  const params: (string | number)[] = [];
  let sql = `SELECT ${assetSelect} FROM media_assets`;
  if (kind) {
    sql += " WHERE kind = ?";
    params.push(kind);
  }
  sql += " ORDER BY created_at DESC LIMIT ?";
  params.push(Math.min(200, Math.max(1, limit)));
  return all<AssetRow>(sql, params).map(toAsset);
}

export function deleteAsset(id: string): void {
  const result = run("DELETE FROM media_assets WHERE id = ?", [id]);
  if (result.changes === 0) throw notFound("Asset");
}

// ─── User preferences ────────────────────────────────────────────────────────

export const preferencesInputSchema = z.object({
  language: z.string().trim().min(2).max(40).optional(),
  theme: z.enum(["light", "warm", "dark"]).optional(),
  readingTheme: z.enum(["cream", "light", "dark"]).optional(),
  readerFontSize: z.number().int().min(12).max(32).optional(),
  autoplay: z.boolean().optional(),
  crossfade: z.boolean().optional(),
  normalizeVolume: z.boolean().optional(),
  downloadQuality: z.enum(["standard", "high", "lossless"]).optional(),
  dataSaver: z.boolean().optional(),
  notifyNewContent: z.boolean().optional(),
  notifyLiveEvents: z.boolean().optional(),
  notifyWeeklyLetter: z.boolean().optional(),
  // Reminders. These were readable from migration 005 but had no write path:
  // the Reminders modal PATCHed them, Zod stripped the unknown keys, and
  // `updatePreferences` never had a column mapping for them, so every reminder
  // setting silently reverted to its default on save.
  remindersEnabled: z.boolean().optional(),
  notifyDailyVerse: z.boolean().optional(),
  /** `HH:MM`, 24-hour, interpreted in the user's own timezone. */
  dailyVerseTime: z
    .string()
    .trim()
    .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Expected a 24-hour HH:MM time")
    .optional(),
  notifyReadingStreak: z.boolean().optional(),
  streakReminderTime: z
    .string()
    .trim()
    .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Expected a 24-hour HH:MM time")
    .optional(),
  notifyLiveWorship: z.boolean().optional(),
  liveAlertLeadMinutes: z.number().int().min(0).max(1_440).optional(),
  notifyNewHymns: z.boolean().optional(),
  eventReminderMinutes: z.number().int().min(0).max(10_080).optional(),
  defaultBibleVersion: z.string().trim().max(40).optional(),
  bibleTranslation: z.string().trim().max(10).optional(),
  followedTopics: z.array(z.string().trim().min(1).max(60)).max(40).optional(),
});

export type PreferencesInput = z.output<typeof preferencesInputSchema>;

/** Preferences always exist for a registered user; the row is created lazily. */
function ensurePreferences(userId: string): void {
  run("INSERT INTO user_preferences (user_id) VALUES (?) ON CONFLICT(user_id) DO NOTHING", [userId]);
}

export function getPreferences(userId: string): UserPreferences {
  ensurePreferences(userId);
  const row = get<Row & Record<string, never>>("SELECT * FROM user_preferences WHERE user_id = ?", [userId])!;
  const value = (key: string) => (row[key] === null || row[key] === undefined ? null : row[key]);
  return {
    language: String(value("language") ?? "English"),
    theme: (value("theme") ?? "warm") as UserPreferences["theme"],
    readingTheme: (value("reading_theme") ?? "cream") as UserPreferences["readingTheme"],
    readerFontSize: Number(value("reader_font_size") ?? 18),
    autoplay: Number(value("autoplay") ?? 1) === 1,
    crossfade: Number(value("crossfade") ?? 0) === 1,
    normalizeVolume: Number(value("normalize_volume") ?? 1) === 1,
    downloadQuality: (value("download_quality") ?? "high") as UserPreferences["downloadQuality"],
    dataSaver: Number(value("data_saver") ?? 0) === 1,
    captions: Number(value("captions") ?? 0) === 1,
    bedroomMode: Number(value("bedroom_mode") ?? 0) === 1,
    notifyNewContent: Number(value("notify_new_content") ?? 1) === 1,
    notifyLiveEvents: Number(value("notify_live_events") ?? 1) === 1,
    notifyWeeklyLetter: Number(value("notify_weekly_letter") ?? 0) === 1,
    remindersEnabled: Number(value("reminders_enabled") ?? 1) === 1,
    notifyDailyVerse: Number(value("notify_daily_verse") ?? 1) === 1,
    dailyVerseTime: String(value("daily_verse_time") ?? "07:00"),
    notifyReadingStreak: Number(value("notify_reading_streak") ?? 1) === 1,
    streakReminderTime: String(value("streak_reminder_time") ?? "19:30"),
    notifyLiveWorship: Number(value("notify_live_worship") ?? 1) === 1,
    liveAlertLeadMinutes: Number(value("live_alert_lead_minutes") ?? 15),
    notifyNewHymns: Number(value("notify_new_hymns") ?? 0) === 1,
    readingStreak: {
      current: Number(value("reading_streak_current") ?? 0),
      best: Number(value("reading_streak_best") ?? 0),
      lastDay: value("last_reading_day") === null ? null : String(value("last_reading_day")),
    },
    eventReminderMinutes: Number(value("event_reminder_minutes") ?? 60),
    defaultBibleVersion: String(value("default_bible_version") ?? "KJV"),
    bibleTranslation: String(value("bible_translation") ?? "KJV"),
    followedTopics: parseJson<string[]>(value("followed_topics"), []),
    updatedAt: String(value("updated_at") ?? ""),
  };
}

const preferenceColumns: Record<string, string> = {
  language: "language",
  theme: "theme",
  readingTheme: "reading_theme",
  readerFontSize: "reader_font_size",
  downloadQuality: "download_quality",
  defaultBibleVersion: "default_bible_version",
  bibleTranslation: "bible_translation",
  eventReminderMinutes: "event_reminder_minutes",
  followedTopics: "followed_topics",
  // Non-boolean reminder settings.
  dailyVerseTime: "daily_verse_time",
  streakReminderTime: "streak_reminder_time",
  liveAlertLeadMinutes: "live_alert_lead_minutes",
};

const preferenceBooleans: Record<string, string> = {
  autoplay: "autoplay",
  crossfade: "crossfade",
  normalizeVolume: "normalize_volume",
  dataSaver: "data_saver",
  notifyNewContent: "notify_new_content",
  notifyLiveEvents: "notify_live_events",
  notifyWeeklyLetter: "notify_weekly_letter",
  // Reminder switches. Without these rows the Reminders modal saved nothing.
  remindersEnabled: "reminders_enabled",
  notifyDailyVerse: "notify_daily_verse",
  notifyReadingStreak: "notify_reading_streak",
  notifyLiveWorship: "notify_live_worship",
  notifyNewHymns: "notify_new_hymns",
};

export function updatePreferences(userId: string, input: PreferencesInput): UserPreferences {
  ensurePreferences(userId);
  const assignments: string[] = [];
  const params: (string | number | null)[] = [];

  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    if (key === "followedTopics") {
      assignments.push("followed_topics = ?");
      params.push(JSON.stringify(value));
      continue;
    }
    if (preferenceBooleans[key]) {
      assignments.push(`${preferenceBooleans[key]} = ?`);
      params.push(value ? 1 : 0);
      continue;
    }
    const column = preferenceColumns[key];
    if (!column) continue;
    assignments.push(`${column} = ?`);
    params.push(value as string | number);
  }

  if (assignments.length > 0) {
    // `followed_topics` is denormalised onto the preferences row *and* the
    // `followed_topics` table, so keep both in step.
    if (input.followedTopics !== undefined) {
      run("DELETE FROM followed_topics WHERE user_id = ?", [userId]);
      for (const topic of input.followedTopics) {
        run("INSERT INTO followed_topics (user_id, topic_type, topic) VALUES (?, 'news', ?)", [userId, topic]);
      }
    }
    params.push(userId);
    run(
      `UPDATE user_preferences SET ${assignments.join(", ")}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE user_id = ?`,
      params,
    );
  }
  return getPreferences(userId);
}

export function followedTopics(userId: string): string[] {
  return all<{ topic: string }>("SELECT topic FROM followed_topics WHERE user_id = ? ORDER BY topic", [userId]).map((row) => row.topic);
}

export function followTopic(userId: string, topic: string, topicType = "news"): { following: boolean } {
  const trimmed = topic.trim().slice(0, 60);
  if (!trimmed) throw badRequest("Provide a topic to follow");
  run(
    "INSERT INTO followed_topics (user_id, topic_type, topic) VALUES (?, ?, ?) ON CONFLICT(user_id, topic_type, topic) DO NOTHING",
    [userId, topicType, trimmed],
  );
  return { following: true };
}

export function unfollowTopic(userId: string, topic: string, topicType = "news"): { following: boolean } {
  run("DELETE FROM followed_topics WHERE user_id = ? AND topic_type = ? AND topic = ?", [userId, topicType, topic]);
  return { following: false };
}

// ─── Notifications ───────────────────────────────────────────────────────────

export function listNotifications(userId: string, limit = 30): { id: string; type: string; title: string; body: string | null; href: string | null; readAt: string | null; createdAt: string }[] {
  return all<Row & { id: string; type: string; title: string; body: string | null; href: string | null; read_at: string | null; created_at: string }>(
    `SELECT id, type, title, body, href, read_at, created_at FROM notifications
     WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
    [userId, Math.min(100, Math.max(1, limit))],
  ).map((row) => ({
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    href: row.href,
    readAt: row.read_at,
    createdAt: row.created_at,
  }));
}

export function markNotificationsRead(userId: string): { updated: boolean } {
  run(
    "UPDATE notifications SET read_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE user_id = ? AND read_at IS NULL",
    [userId],
  );
  return { updated: true };
}

// ─── Platform stats ──────────────────────────────────────────────────────────

/** Public counters for the marketing footer and the admin overview. */
export function platformStats(): Record<string, number> {
  const scalar = (sql: string) => Number(get<{ total: number }>(sql)?.total ?? 0);
  return {
    churches: scalar("SELECT COUNT(*) AS total FROM churches WHERE deleted_at IS NULL AND is_active = 1"),
    tracks: scalar("SELECT COUNT(*) AS total FROM tracks WHERE deleted_at IS NULL AND status = 'published'"),
    videos: scalar("SELECT COUNT(*) AS total FROM tracks WHERE kind = 'video' AND deleted_at IS NULL AND status = 'published'"),
    albums: scalar("SELECT COUNT(*) AS total FROM albums"),
    collections: scalar("SELECT COUNT(*) AS total FROM collections"),
    hymns: scalar("SELECT COUNT(*) AS total FROM hymns WHERE deleted_at IS NULL AND status = 'published'"),
    sermons: scalar("SELECT COUNT(*) AS total FROM sermons WHERE deleted_at IS NULL AND status = 'published'"),
    news: scalar("SELECT COUNT(*) AS total FROM news_articles WHERE deleted_at IS NULL AND status = 'published'"),
    events: scalar("SELECT COUNT(*) AS total FROM events WHERE deleted_at IS NULL AND status = 'published'"),
    liveStreams: scalar("SELECT COUNT(*) AS total FROM live_streams"),
    bibleVersions: scalar("SELECT COUNT(*) AS total FROM bible_versions"),
    bibleVerses: scalar("SELECT COALESCE(SUM(verse_count), 0) AS total FROM bible_chapters"),
    users: scalar("SELECT COUNT(*) AS total FROM users WHERE deleted_at IS NULL"),
    subscribers: scalar("SELECT COUNT(*) AS total FROM newsletter_subscribers WHERE status != 'unsubscribed'"),
  };
}

export { conflict };
