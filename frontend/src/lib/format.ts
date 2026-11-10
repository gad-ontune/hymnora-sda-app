/**
 * Small formatting helpers shared by the player and the video surfaces.
 *
 * `formatClock` takes seconds and returns the `m:ss` a person would say out loud.
 * The point of it being shared is that a duration read off the YouTube player and
 * a duration from the database are the same number, and must not be able to
 * disagree about how to be written — `14:59` in one place and `899` in another
 * reads as a bug, because it is one.
 */

/** Seconds → `m:ss`, or `h:mm:ss` past an hour. */
export function formatClock(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "0:00";
  const seconds = Math.floor(totalSeconds);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

/**
 * A view count, abbreviated the way YouTube abbreviates it.
 *
 * Exact numbers for a 44,437-view video are noise; the shape of the scale is the
 * information, so `44K` and `1.2M` it is. Under a thousand is left exact, because
 * "9 views" and "0.9K views" are not the same claim.
 */
export function formatViews(views: number): string {
  if (!Number.isFinite(views) || views <= 0) return "No views";
  if (views < 1_000) return `${views} view${views === 1 ? "" : "s"}`;
  if (views < 1_000_000) {
    const thousands = views / 1_000;
    return `${thousands < 10 ? thousands.toFixed(1) : Math.round(thousands)}K views`;
  }
  const millions = views / 1_000_000;
  return `${millions < 10 ? millions.toFixed(1) : Math.round(millions)}M views`;
}

/**
 * A plain number with thousands separators, for a like count.
 *
 * Deliberately not `formatViews`: that one abbreviates and pluralises for views,
 * which turned a like count into "16 views likes". A like count is small and the
 * exact figure is the point, so it stays exact.
 */
export function formatCount(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return "0";
  return count.toLocaleString();
}

/** A relative day, for "3 days ago". Falls back to a date past a month. */
export function formatWhen(iso: string, now = new Date()): string {
  if (!iso) return "";
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "";
  const seconds = Math.round((now.getTime() - then.getTime()) / 1000);
  if (seconds < 0) return "just now";
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  const weeks = Math.round(days / 7);
  if (weeks < 5) return `${weeks} week${weeks === 1 ? "" : "s"} ago`;
  return then.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** A long total, for "42 min" rather than "0:42:00". */
export function formatTotal(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} hr ${rest} min` : `${hours} hr`;
}

/**
 * Two letters for an avatar.
 *
 * The sidebar used to show a hardcoded "AM" whatever the account was, which is
 * the kind of detail that quietly makes an app feel like a mock-up, so this
 * reads the name first and falls back to the email — a member who registered as
 * "Peter Kamau" should see PK, and one who gave a one-word name should see
 * something other than an empty circle.
 */
export function initials(name?: string | null, email?: string | null): string {
  const name_ = (name ?? "").trim();
  // The local part only: the domain is where the mail went, not who it belongs to.
  const email_ = (email ?? "").trim().split("@")[0] ?? "";
  const source = name_ || email_;
  if (!source) return "";
  const words = source.split(/[\s._-]+/).filter(Boolean);
  if (words.length === 0) return "";
  const letters = words.slice(0, 2).map((word) => [...word][0] ?? "");
  const joined = letters.join("").toUpperCase();
  return joined || source[0]!.toUpperCase();
}
