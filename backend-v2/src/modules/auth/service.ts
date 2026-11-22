import { z } from "zod";
import { all, get, run, transactionAsync, type Row } from "../../db/client.ts";
import { env } from "../../config/env.ts";
import { conflict, forbidden, notFound, unauthorized, unprocessable } from "../../lib/errors.ts";
import { assertPasswordStrength, hashPassword, verifyPassword, DUMMY_PASSWORD_HASH } from "../../lib/password.ts";
import { createOpaqueToken, hashOpaqueToken, signAccessToken, signRefreshToken, verifyRefreshToken } from "../../lib/tokens.ts";
import { newId } from "../../lib/http.ts";
import { parseJson } from "../../lib/text.ts";
import type { AuthTokens } from "../../types/api.ts";
import type { User, UserPreferences, UserRole, UserStatus } from "../../types/domain.ts";

export type UserRow = Row & {
  id: string;
  email: string;
  password_hash: string;
  role: UserRole;
  status: UserStatus;
  first_name: string;
  last_name: string;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  phone: string | null;
  home_church_id: string | null;
  home_church_name: string | null;
  city: string | null;
  country: string | null;
  timezone: string | null;
  language: string;
  email_verified_at: string | null;
  last_login_at: string | null;
  created_at: string;
};

const userColumns = `
  u.id, u.email, u.password_hash, u.role, u.status, u.first_name, u.last_name, u.display_name,
  u.avatar_url, u.bio, u.phone, u.home_church_id, c.name AS home_church_name, u.city, u.country,
  u.timezone, u.language, u.email_verified_at, u.last_login_at, u.created_at
`;

export function userById(id: string): UserRow | undefined {
  return get<UserRow>(
    `SELECT ${userColumns} FROM users u LEFT JOIN churches c ON c.id = u.home_church_id
     WHERE u.id = ? AND u.deleted_at IS NULL`,
    [id],
  );
}

export function userByEmail(email: string): UserRow | undefined {
  return get<UserRow>(
    `SELECT ${userColumns} FROM users u LEFT JOIN churches c ON c.id = u.home_church_id
     WHERE lower(u.email) = lower(?) AND u.deleted_at IS NULL`,
    [email],
  );
}

export function toUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    role: row.role as UserRole,
    status: row.status as User["status"],
    firstName: row.first_name,
    lastName: row.last_name,
    displayName: row.display_name?.trim() || `${row.first_name} ${row.last_name}`.trim(),
    avatarUrl: row.avatar_url,
    bio: row.bio,
    homeChurchId: row.home_church_id,
    homeChurchName: row.home_church_name,
    city: row.city,
    country: row.country,
    language: row.language,
    emailVerified: Boolean(row.email_verified_at),
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
  };
}

export function findUserById(id: string): User | null {
  const row = userById(id);
  return row ? toUser(row) : null;
}

export function findUserByEmail(email: string): User | null {
  const row = userByEmail(email);
  return row ? toUser(row) : null;
}

// ─── Preferences ─────────────────────────────────────────────────────────────

type PreferenceRow = Row & {
  user_id: string;
  language: string;
  theme: string;
  reading_theme: string;
  reader_font_size: number;
  autoplay: number;
  crossfade: number;
  normalize_volume: number;
  download_quality: string;
  data_saver: number;
  captions: number;
  bedroom_mode: number;
  notify_new_content: number;
  notify_live_events: number;
  notify_weekly_letter: number;
  reminders_enabled: number;
  notify_daily_verse: number;
  daily_verse_time: string;
  notify_reading_streak: number;
  streak_reminder_time: string;
  notify_live_worship: number;
  live_alert_lead_minutes: number;
  notify_new_hymns: number;
  reading_streak_current: number;
  reading_streak_best: number;
  last_reading_day: string | null;
  event_reminder_minutes: number;
  default_bible_version: string;
  bible_translation: string;
  followed_topics: string;
  updated_at: string;
};

function toPreferences(row: PreferenceRow): UserPreferences {
  return {
    language: row.language,
    theme: row.theme as UserPreferences["theme"],
    readingTheme: row.reading_theme as UserPreferences["readingTheme"],
    readerFontSize: row.reader_font_size,
    autoplay: row.autoplay === 1,
    crossfade: row.crossfade === 1,
    normalizeVolume: row.normalize_volume === 1,
    downloadQuality: row.download_quality as UserPreferences["downloadQuality"],
    dataSaver: row.data_saver === 1,
    captions: row.captions === 1,
    bedroomMode: row.bedroom_mode === 1,
    notifyNewContent: row.notify_new_content === 1,
    notifyLiveEvents: row.notify_live_events === 1,
    notifyWeeklyLetter: row.notify_weekly_letter === 1,
    remindersEnabled: row.reminders_enabled === 1,
    notifyDailyVerse: row.notify_daily_verse === 1,
    dailyVerseTime: row.daily_verse_time,
    notifyReadingStreak: row.notify_reading_streak === 1,
    streakReminderTime: row.streak_reminder_time,
    notifyLiveWorship: row.notify_live_worship === 1,
    liveAlertLeadMinutes: row.live_alert_lead_minutes,
    notifyNewHymns: row.notify_new_hymns === 1,
    readingStreak: {
      current: row.reading_streak_current,
      best: row.reading_streak_best,
      lastDay: row.last_reading_day,
    },
    eventReminderMinutes: row.event_reminder_minutes,
    defaultBibleVersion: row.default_bible_version,
    bibleTranslation: row.bible_translation,
    followedTopics: parseJson<string[]>(row.followed_topics, []),
    updatedAt: row.updated_at,
  };
}

export function getPreferences(userId: string): UserPreferences {
  const existing = get<PreferenceRow>("SELECT * FROM user_preferences WHERE user_id = ?", [userId]);
  if (existing) return toPreferences(existing);
  run("INSERT OR IGNORE INTO user_preferences (user_id) VALUES (?)", [userId]);
  const created = get<PreferenceRow>("SELECT * FROM user_preferences WHERE user_id = ?", [userId]);
  if (!created) throw notFound("Preferences");
  return toPreferences(created);
}

export const preferencesSchema = z
  .object({
    language: z.string().trim().min(2).max(40).optional(),
    theme: z
      .enum(["light", "warm", "dark", "sanctuary", "garden", "sunset", "midnight", "system"])
      .optional(),
    readingTheme: z.enum(["cream", "light", "dark"]).optional(),
    readerFontSize: z.number().int().min(14).max(28).optional(),
    autoplay: z.boolean().optional(),
    crossfade: z.boolean().optional(),
    normalizeVolume: z.boolean().optional(),
    downloadQuality: z.enum(["standard", "high", "lossless"]).optional(),
    dataSaver: z.boolean().optional(),
    captions: z.boolean().optional(),
    bedroomMode: z.boolean().optional(),
    notifyNewContent: z.boolean().optional(),
    notifyLiveEvents: z.boolean().optional(),
    notifyWeeklyLetter: z.boolean().optional(),
    // ── Reminders (device-level push) ─────────────────────────────────────
    remindersEnabled: z.boolean().optional(),
    notifyDailyVerse: z.boolean().optional(),
    dailyVerseTime: z
      .string()
      .trim()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a 24-hour time like \"07:00\"")
      .optional(),
    notifyReadingStreak: z.boolean().optional(),
    streakReminderTime: z
      .string()
      .trim()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a 24-hour time like \"19:30\"")
      .optional(),
    notifyLiveWorship: z.boolean().optional(),
    liveAlertLeadMinutes: z.number().int().min(0).max(1440).optional(),
    notifyNewHymns: z.boolean().optional(),
    eventReminderMinutes: z.number().int().min(0).max(10080).optional(),
    defaultBibleVersion: z.string().trim().min(2).max(20).optional(),
    bibleTranslation: z.string().trim().min(1).max(10).optional(),
    followedTopics: z.array(z.string().trim().min(1).max(60)).max(50).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "Provide at least one preference to update" });

export type PreferencesInput = z.output<typeof preferencesSchema>;

const preferenceColumnMap: Record<string, string> = {
  language: "language",
  theme: "theme",
  readingTheme: "reading_theme",
  readerFontSize: "reader_font_size",
  autoplay: "autoplay",
  crossfade: "crossfade",
  normalizeVolume: "normalize_volume",
  downloadQuality: "download_quality",
  dataSaver: "data_saver",
  captions: "captions",
  bedroomMode: "bedroom_mode",
  notifyNewContent: "notify_new_content",
  notifyLiveEvents: "notify_live_events",
  notifyWeeklyLetter: "notify_weekly_letter",
  remindersEnabled: "reminders_enabled",
  notifyDailyVerse: "notify_daily_verse",
  dailyVerseTime: "daily_verse_time",
  notifyReadingStreak: "notify_reading_streak",
  streakReminderTime: "streak_reminder_time",
  notifyLiveWorship: "notify_live_worship",
  liveAlertLeadMinutes: "live_alert_lead_minutes",
  notifyNewHymns: "notify_new_hymns",
  eventReminderMinutes: "event_reminder_minutes",
  defaultBibleVersion: "default_bible_version",
  bibleTranslation: "bible_translation",
};

export function updatePreferences(userId: string, input: PreferencesInput): UserPreferences {
  getPreferences(userId);
  const assignments: string[] = [];
  const params: (string | number)[] = [];

  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    if (key === "followedTopics") continue;
    const column = preferenceColumnMap[key];
    if (!column) continue;
    assignments.push(`${column} = ?`);
    params.push(typeof value === "boolean" ? (value ? 1 : 0) : (value as string | number));
  }

  if (input.followedTopics) {
    assignments.push("followed_topics = ?");
    params.push(JSON.stringify(input.followedTopics));
  }

  if (assignments.length > 0) {
    params.push(userId);
    run(
      `UPDATE user_preferences SET ${assignments.join(", ")}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE user_id = ?`,
      params,
    );
  }

  if (input.followedTopics) {
    run("DELETE FROM followed_topics WHERE user_id = ? AND topic_type = 'news'", [userId]);
    for (const topic of input.followedTopics) {
      run("INSERT OR IGNORE INTO followed_topics (user_id, topic_type, topic) VALUES (?, 'news', ?)", [userId, topic]);
    }
  }

  return getPreferences(userId);
}

// ─── Tokens ──────────────────────────────────────────────────────────────────

type TokenSubject = { id: string; email: string; role: UserRole; status: UserStatus };

export function issueTokens(user: TokenSubject, meta: { userAgent?: string; ip?: string }): AuthTokens {
  const tokenId = newId();
  const access = signAccessToken({ sub: user.id, email: user.email, role: user.role, status: user.status });
  const refresh = signRefreshToken(user.id, tokenId);
  run(
    `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, user_agent, ip_address)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [tokenId, user.id, hashOpaqueToken(refresh.token), refresh.expiresAt, meta.userAgent ?? null, meta.ip ?? null],
  );
  return {
    accessToken: access.token,
    refreshToken: refresh.token,
    accessTokenExpiresAt: access.expiresAt,
    refreshTokenExpiresAt: refresh.expiresAt,
    tokenType: "Bearer",
  };
}

export function rotateRefreshToken(token: string, meta: { userAgent?: string; ip?: string }): { user: User; tokens: AuthTokens } {
  const claims = verifyRefreshToken(token);
  const stored = get<Row & { id: string; user_id: string; revoked_at: string | null }>(
    "SELECT id, user_id, revoked_at FROM refresh_tokens WHERE token_hash = ?",
    [hashOpaqueToken(token)],
  );
  if (!stored) throw unauthorized("Refresh token is not recognised");
  if (stored.revoked_at) {
    // Replaying a rotated token means the session was stolen: revoke the family.
    run("UPDATE refresh_tokens SET revoked_at = datetime('now') WHERE user_id = ? AND revoked_at IS NULL", [stored.user_id]);
    throw unauthorized("Refresh token has already been used — please sign in again");
  }
  const user = userById(stored.user_id);
  if (!user) throw unauthorized("Account no longer exists");
  if (user.status === "suspended") throw forbidden("This account has been suspended");

  run("UPDATE refresh_tokens SET revoked_at = datetime('now') WHERE id = ?", [stored.id]);
  run("UPDATE users SET last_login_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?", [user.id]);
  return { user: toUser(user), tokens: issueTokens(user, meta) };
}

export function revokeRefreshToken(token: string): void {
  run("UPDATE refresh_tokens SET revoked_at = datetime('now') WHERE token_hash = ?", [hashOpaqueToken(token)]);
}

export function revokeAllRefreshTokens(userId: string): void {
  run("UPDATE refresh_tokens SET revoked_at = datetime('now') WHERE user_id = ? AND revoked_at IS NULL", [userId]);
}

export function listActiveSessions(userId: string): Row[] {
  return all<Row>(
    `SELECT id, user_agent, ip_address, created_at, expires_at
     FROM refresh_tokens
     WHERE user_id = ? AND revoked_at IS NULL AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')
     ORDER BY created_at DESC`,
    [userId],
  );
}

export function purgeExpiredTokens(): number {
  const expired = run("DELETE FROM refresh_tokens WHERE expires_at < strftime('%Y-%m-%dT%H:%M:%fZ','now')");
  const used = run("DELETE FROM auth_tokens WHERE expires_at < strftime('%Y-%m-%dT%H:%M:%fZ','now')");
  return expired.changes + used.changes;
}

// ─── Registration and credentials ────────────────────────────────────────────

export const registerSchema = z.object({
  email: z.email().max(180),
  password: z.string().min(8).max(200),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  displayName: z.string().trim().max(120).optional(),
  language: z.string().trim().max(40).default("English"),
  city: z.string().trim().max(120).optional(),
  country: z.string().trim().max(120).optional(),
  homeChurchId: z.string().trim().max(120).optional(),
  newsletter: z.boolean().default(false),
});

export type RegisterInput = z.output<typeof registerSchema>;

export async function registerUser(
  input: RegisterInput,
  meta: { userAgent?: string; ip?: string },
): Promise<{ user: User; tokens: AuthTokens; verificationToken: string }> {
  if (!env.allowPublicRegistration) throw forbidden("Public registration is currently closed");
  const email = input.email.toLowerCase().trim();
  if (userByEmail(email)) throw conflict("An account with this email already exists", { field: "email" });
  assertPasswordStrength(input.password);

  const passwordHash = await hashPassword(input.password);
  const id = newId();
  const { token, hash } = createOpaqueToken();

  await transactionAsync(async () => {
    run(
      `INSERT INTO users (id, email, password_hash, role, status, first_name, last_name, display_name,
                          language, city, country, home_church_id)
       VALUES (?, ?, ?, 'member', 'active', ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        email,
        passwordHash,
        input.firstName,
        input.lastName,
        input.displayName ?? null,
        input.language,
        input.city ?? null,
        input.country ?? null,
        input.homeChurchId ?? null,
      ],
    );
    run("INSERT INTO user_preferences (user_id, language) VALUES (?, ?)", [id, input.language]);
    run(
      `INSERT INTO auth_tokens (id, user_id, purpose, token_hash, expires_at)
       VALUES (?, ?, 'email_verification', ?, ?)`,
      [newId(), id, hash, new Date(Date.now() + 2 * 86_400_000).toISOString()],
    );
    if (input.newsletter) {
      run("INSERT OR IGNORE INTO newsletter_subscribers (id, email, status, source) VALUES (?, ?, 'pending', 'account')", [
        newId(),
        email,
      ]);
    }
  });

  const user = userById(id);
  if (!user) throw unprocessable("Could not create the account");
  return { user: toUser(user), tokens: issueTokens(user, meta), verificationToken: token };
}

export async function authenticate(
  email: string,
  password: string,
  meta: { userAgent?: string; ip?: string },
): Promise<{ user: User; tokens: AuthTokens }> {
  const row = userByEmail(email.trim());
  // Always perform a hash comparison so timing does not reveal account existence.
  const valid = await verifyPassword(password, row?.password_hash ?? DUMMY_PASSWORD_HASH);
  if (!row || !valid) throw unauthorized("Email or password is incorrect");
  if (row.status === "suspended") throw forbidden("This account has been suspended");
  if (row.status === "invited") throw unprocessable("Verify your email address before signing in");

  run("UPDATE users SET last_login_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?", [row.id]);
  return { user: toUser(row), tokens: issueTokens(row, meta) };
}

export async function changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
  const row = userById(userId);
  if (!row) throw notFound("Account");
  if (!(await verifyPassword(currentPassword, row.password_hash))) throw unauthorized("Current password is incorrect");
  assertPasswordStrength(newPassword);
  const hash = await hashPassword(newPassword);
  await transactionAsync(async () => {
    run("UPDATE users SET password_hash = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?", [hash, userId]);
    run("UPDATE refresh_tokens SET revoked_at = datetime('now') WHERE user_id = ? AND revoked_at IS NULL", [userId]);
  });
}

// ─── Email verification and password reset ───────────────────────────────────

export function consumeAuthToken(purpose: "email_verification" | "password_reset", token: string): string {
  const row = get<Row & { id: string; user_id: string; consumed_at: string | null }>(
    "SELECT id, user_id, consumed_at FROM auth_tokens WHERE purpose = ? AND token_hash = ?",
    [purpose, hashOpaqueToken(token)],
  );
  if (!row) throw unauthorized("This link is not valid");
  if (row.consumed_at) throw unprocessable("This link has already been used");
  if (!get("SELECT 1 FROM auth_tokens WHERE id = ? AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')", [row.id])) {
    throw unprocessable("This link has expired — please request a new one");
  }
  run("UPDATE auth_tokens SET consumed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?", [row.id]);
  return row.user_id;
}

export function verifyEmail(token: string): User {
  const userId = consumeAuthToken("email_verification", token);
  run("UPDATE users SET email_verified_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), status = 'active' WHERE id = ?", [userId]);
  const user = userById(userId);
  if (!user) throw notFound("Account");
  return toUser(user);
}

export function resendVerification(userId: string): { sent: boolean; reason?: string; token?: string } {
  const user = userById(userId);
  if (!user) throw notFound("Account");
  if (user.email_verified_at) return { sent: false, reason: "already_verified" };
  run("DELETE FROM auth_tokens WHERE user_id = ? AND purpose = 'email_verification' AND consumed_at IS NULL", [userId]);
  const { token, hash } = createOpaqueToken();
  run(
    `INSERT INTO auth_tokens (id, user_id, purpose, token_hash, expires_at)
     VALUES (?, ?, 'email_verification', ?, ?)`,
    [newId(), userId, hash, new Date(Date.now() + 2 * 86_400_000).toISOString()],
  );
  return { sent: true, token };
}

export function requestPasswordReset(email: string): { token: string | null; userId: string | null } {
  const user = userByEmail(email.trim());
  if (!user) return { token: null, userId: null };
  run("DELETE FROM auth_tokens WHERE user_id = ? AND purpose = 'password_reset'", [user.id]);
  const { token, hash } = createOpaqueToken();
  run(
    `INSERT INTO auth_tokens (id, user_id, purpose, token_hash, expires_at)
     VALUES (?, ?, 'password_reset', ?, ?)`,
    [newId(), user.id, hash, new Date(Date.now() + 3_600_000).toISOString()],
  );
  return { token, userId: user.id };
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  // The strength check runs before the token is consumed: a weak password
  // rejected after burning the link forces the user to request a new one just
  // to retry the same form.
  assertPasswordStrength(newPassword);
  const userId = consumeAuthToken("password_reset", token);
  const hash = await hashPassword(newPassword);
  await transactionAsync(async () => {
    run("UPDATE users SET password_hash = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?", [hash, userId]);
    run("UPDATE refresh_tokens SET revoked_at = datetime('now') WHERE user_id = ? AND revoked_at IS NULL", [userId]);
  });
}
