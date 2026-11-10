import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const here = dirname(fileURLToPath(import.meta.url));
export const projectRoot = resolve(here, "..", "..");

function loadDotEnv(): void {
  const candidates = [resolve(projectRoot, ".env"), resolve(projectRoot, "..", ".env")];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      dotenv.config({ path: candidate, quiet: true });
      return;
    }
  }
  dotenv.config({ quiet: true });
}

loadDotEnv();

function str(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : value;
}

function optionalStr(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value === "" ? undefined : value;
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Environment variable ${name} must be an integer, received "${raw}"`);
  }
  return parsed;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

function list(name: string, fallback: string[]): string[] {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function resolveFromRoot(value: string): string {
  return isAbsolute(value) ? value : resolve(projectRoot, value);
}

const nodeEnv = str("NODE_ENV", "development");
const isProduction = nodeEnv === "production";

const jwtSecret = str("JWT_SECRET", isProduction ? "" : "dev-only-access-secret-change-me");
const jwtRefreshSecret = str("JWT_REFRESH_SECRET", isProduction ? "" : "dev-only-refresh-secret-change-me");

if (isProduction && (jwtSecret.length < 32 || jwtRefreshSecret.length < 32)) {
  throw new Error("JWT_SECRET and JWT_REFRESH_SECRET must be at least 32 characters in production");
}
if (!jwtSecret || !jwtRefreshSecret) {
  throw new Error("JWT_SECRET and JWT_REFRESH_SECRET are required");
}

export const env = {
  nodeEnv,
  isProduction,
  isTest: nodeEnv === "test",
  port: int("PORT", 4000),
  host: str("HOST", "0.0.0.0"),
  apiPublicUrl: str("API_PUBLIC_URL", "http://localhost:4000").replace(/\/$/, ""),
  corsOrigins: list("CORS_ORIGINS", ["http://localhost:3000", "http://127.0.0.1:3000", "http://localhost:3002", "http://localhost:3001"]),
  trustProxy: list("TRUST_PROXY", ["loopback"]),

  databaseFile: str("DATABASE_MEMORY", "false") === "true" ? ":memory:" : resolveFromRoot(str("DATABASE_FILE", "./data/hymnora.db")),
  databaseMemory: str("DATABASE_MEMORY", "false") === "true",

  jwtSecret,
  jwtRefreshSecret,
  jwtAccessTtl: str("JWT_ACCESS_TTL", "15m"),
  jwtRefreshTtl: str("JWT_REFRESH_TTL", "30d"),
  cookieSecure: bool("COOKIE_SECURE", isProduction),
  allowPublicRegistration: bool("ALLOW_PUBLIC_REGISTRATION", true),

  uploadDir: resolveFromRoot(str("UPLOAD_DIR", "./public/uploads")),
  maxUploadBytes: int("MAX_UPLOAD_BYTES", 25 * 1024 * 1024),

  rateLimitWindowMs: int("RATE_LIMIT_WINDOW_MS", 60_000),
  rateLimitMax: int("RATE_LIMIT_MAX", 300),
  authRateLimitMax: int("AUTH_RATE_LIMIT_MAX", 20),

  seedDemoPassword: str("SEED_DEMO_PASSWORD", "Password123!"),

  // ── Native (device-level) reminders ───────────────────────────────────────
  // VAPID keys sign every Web Push request. Generate a pair once with
  //   npm run vapid:new
  // and keep it out of version control; `.env*` is already gitignored. Without
  // them the app still runs, it just cannot deliver a push, and the Reminders
  // modal says so instead of silently failing.
  vapidPublicKey: optionalStr("VAPID_PUBLIC_KEY"),
  vapidPrivateKey: optionalStr("VAPID_PRIVATE_KEY"),
  vapidSubject: str("VAPID_SUBJECT", "mailto:devops@hymnora.app"),
  // The origin serving the service worker. Used to check a subscription belongs
  // to a host we control, and to document the scope a push notification reopens.
  vapidOrigin: str("VAPID_ORIGIN", "http://localhost:3000"),
  pushTimeoutMs: int("PUSH_TIMEOUT_MS", 8_000),
  // A device that has failed this many deliveries is retired instead of being
  // retried forever against a browser that cleared its subscription. Set above 3
  // because a phone in a lift should not lose its subscription.
  pushMaxFailures: int("PUSH_MAX_FAILURES", 6),

  // ── YouTube Data API ──────────────────────────────────────────────────────
  // Server-side only. There is no NEXT_PUBLIC_ prefix here on purpose: a key in
  // a client bundle is a key anybody can lift and burn through the quota.
  youtubeApiKey: optionalStr("YOUTUBE_API_KEY"),
  youtubeDailyQuota: int("YOUTUBE_DAILY_QUOTA", 10_000),
  // Stop the poller for the day once this many units are spent, so a runaway
  // loop degrades into "no new uploads" rather than a quota bill.
  youtubeQuotaSafetyMargin: int("YOUTUBE_QUOTA_SAFETY_MARGIN", 100),
  youtubePollIntervalMs: int("YOUTUBE_POLL_INTERVAL_MS", 15 * 60 * 1000),
  // Cap on new rows written per run, so one poll cannot flood the music page
  // with a channel's entire back catalogue on the first night.
  youtubeMaxNewPerRun: int("YOUTUBE_MAX_NEW_PER_RUN", 250),

  // ── Background worker ─────────────────────────────────────────────────────
  // Every job is an interval rather than a cron expression so the worker has no
  // scheduler dependency. `JOBS_TICK_MS` is how often the worker wakes up to see
  // which intervals are due.
  jobTickMs: int("JOBS_TICK_MS", 60_000),
  // Off by default so a developer running `npm run dev` does not also poll
  // YouTube every fifteen minutes without meaning to. The API process never runs
  // jobs; this only affects the dedicated worker.
  jobEnabled: bool("JOBS_ENABLED", false),
  // Reminder jobs sweep every user; sweeping in slices keeps a big table from
  // producing one enormous transaction.
  jobUserBatchSize: int("JOBS_USER_BATCH_SIZE", 500),
} as const;

export type Env = typeof env;

/** True when a VAPID key pair is present and push can actually be delivered. */
export function pushConfigured(): boolean {
  return Boolean(env.vapidPublicKey && env.vapidPrivateKey);
}

/** True when a YouTube Data API key is present and the poller can run. */
export function youtubeConfigured(): boolean {
  return Boolean(env.youtubeApiKey);
}

/** Reads an optional 32+ byte secret used for opaque tokens (resets, email verification). */
export function opaqueSecret(): string {
  const fromFile = optionalStr("OPAQUE_TOKEN_SECRET");
  return fromFile ?? env.jwtRefreshSecret;
}

/** Utility for scripts: resolve a project-relative path. */
export function fromRoot(value: string): string {
  return resolveFromRoot(value);
}

/** Loads a JSON file relative to the project root (used for seed fixtures). */
export function readJsonFixture<T>(relativePath: string): T {
  return JSON.parse(readFileSync(resolveFromRoot(relativePath), "utf8")) as T;
}
