/** Formats seconds as `m:ss`, or `h:mm:ss` past an hour. */
export function formatDuration(totalSeconds: number | null | undefined): string {
  if (totalSeconds === null || totalSeconds === undefined || !Number.isFinite(totalSeconds) || totalSeconds < 0) return "—";
  const rounded = Math.round(totalSeconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const seconds = rounded % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** Formats minutes the way sermon cards read: `38 min`. */
export function formatMinutes(totalSeconds: number | null | undefined): string {
  if (!totalSeconds || !Number.isFinite(totalSeconds)) return "—";
  const minutes = Math.max(1, Math.round(totalSeconds / 60));
  return `${minutes} min`;
}

export function parseDurationToSeconds(value: string | null | undefined): number | null {
  if (!value) return null;
  const parts = value.split(":").map((part) => Number.parseInt(part, 10));
  if (parts.some((part) => Number.isNaN(part))) return null;
  if (parts.length === 3) return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!;
  if (parts.length === 2) return parts[0]! * 60 + parts[1]!;
  return parts[0] ?? null;
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** `28` — the day chip on event cards. */
export function formatDay(iso: string): string {
  return String(new Date(iso).getUTCDate()).padStart(2, "0");
}

/** `JUN` — the month chip on event cards. */
export function formatMonth(iso: string): string {
  const month = MONTHS[new Date(iso).getUTCMonth()];
  return month ?? "JAN";
}

/** `Saturday · 9:00 AM` — the event time line. */
export function formatEventTime(iso: string, durationDays = 1): string {
  const start = new Date(iso);
  const weekday = start.toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
  const time = start.toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "UTC" });
  if (durationDays > 1) {
    const end = new Date(start.getTime() + (durationDays - 1) * 86_400_000);
    const endDay = end.getUTCDate();
    const endMonth = MONTHS[end.getUTCMonth()];
    return `${weekday} · ${time} – ${endDay} ${endMonth?.toLowerCase() ?? ""}`;
  }
  return `${weekday} · ${time}`;
}

/** `Today`, `Yesterday`, `12 Jun` — the news date line. */
export function formatRelativeDate(iso: string, now = new Date()): string {
  const date = new Date(iso);
  const startOf = (value: Date) => Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
  const dayDiff = Math.round((startOf(now) - startOf(date)) / 86_400_000);
  if (dayDiff === 0) return "Today";
  if (dayDiff === 1) return "Yesterday";
  if (dayDiff > 1 && dayDiff < 7) return `${dayDiff} days ago`;
  const month = date.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" });
  const sameYear = date.getUTCFullYear() === now.getUTCFullYear();
  return sameYear ? `${date.getUTCDate()} ${month}` : `${date.getUTCDate()} ${month} ${date.getUTCFullYear()}`;
}

/** `4 min read` */
export function formatReadTime(minutes: number): string {
  return `${Math.max(1, Math.round(minutes))} min read`;
}

/** `Now`, `18:00 EAT`, `05 Jul`, `Yesterday` — the live page time line. */
export function formatLiveTime(iso: string | null, status: string, now = new Date()): string {
  if (!iso) return status === "Live now" ? "Now" : "—";
  if (status === "Live now") return "Now";
  const date = new Date(iso);
  if (status === "Starting soon" || status === "Upcoming") {
    // Compare the full UTC calendar day — day-of-month alone would make
    // 5 Jan and 5 Mar look identical.
    const sameDay =
      date.getUTCFullYear() === now.getUTCFullYear() &&
      date.getUTCMonth() === now.getUTCMonth() &&
      date.getUTCDate() === now.getUTCDate();
    if (sameDay) {
      return date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" });
    }
    const month = MONTHS[date.getUTCMonth()];
    return `${String(date.getUTCDate()).padStart(2, "0")} ${month ?? ""}`.trim();
  }
  return formatRelativeDate(iso, now);
}

/** `1.8k watching` / `642 watching` */
export function formatViewers(count: number): string {
  if (count >= 1000) {
    const thousands = count / 1000;
    return `${thousands >= 10 ? Math.round(thousands) : Number(thousands.toFixed(1))}k watching`;
  }
  return `${count} watching`;
}

/** `2.4k listening now` */
export function formatListeners(count: number): string {
  if (count >= 1000) {
    const thousands = count / 1000;
    return `${thousands >= 10 ? Math.round(thousands) : Number(thousands.toFixed(1))}k listening now`;
  }
  return `${count} listening now`;
}

/** `Friday, 27 June 2025` — the home page greeting line. */
export function formatLongDate(date = new Date()): string {
  return date.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

/**
 * An ISO-8601 UTC timestamp `offsetMs` from now.
 *
 * Timestamp columns such as `events.starts_at` are written with
 * `Date.toISOString()`, whose `T`-joined form never compares equal to the
 * space-separated strings SQLite's `datetime()` emits — so any `starts_at >=
 * datetime('now', …)` bound silently leaks rows from the boundary day. Build
 * the bound here and bind it as a parameter instead.
 */
export function isoTimestamp(offsetMs = 0, from = Date.now()): string {
  return new Date(from + offsetMs).toISOString();
}

/** `Sabbath worship · 9:00 AM` style service summary. */
export function formatServiceSummary(serviceTimes: { day: string; name: string; time: string }[]): string {
  if (serviceTimes.length === 0) return "Service times to be confirmed";
  const [first] = serviceTimes;
  if (!first) return "Service times to be confirmed";
  return `${first.name} · ${first.time}`;
}
