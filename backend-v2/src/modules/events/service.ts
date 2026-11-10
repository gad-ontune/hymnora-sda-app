import { z } from "zod";
import type { Request } from "express";
import { all, get, run, type Row } from "../../db/client.ts";
import { notFound, unprocessable } from "../../lib/errors.ts";
import { WhereBuilder, orderBy, paginate, selectList } from "../../lib/sql.ts";
import { listQueryFrom, sortColumn } from "../../lib/query.ts";
import { buildMeta, newId, slugify } from "../../lib/http.ts";
import { formatDay, formatEventTime, formatMonth, isoTimestamp } from "../../lib/time.ts";
import type { EventDetail, EventItem } from "../../types/domain.ts";
import type { ListMeta } from "../../types/api.ts";

type EventRow = Row & {
  id: string;
  slug: string;
  title: string;
  category: string;
  place: string;
  venue: string | null;
  city: string | null;
  country: string | null;
  church_id: string | null;
  starts_at: string;
  ends_at: string | null;
  duration_days: number;
  is_online: number;
  is_live: number;
  image: string;
  description: string | null;
  capacity: number | null;
  attending_count: number;
  status: string;
  created_at: string;
  updated_at: string;
};

const selectColumns = `
  e.id, e.slug, e.title, e.category, e.place, e.venue, e.city, e.country, e.church_id, e.starts_at,
  e.ends_at, e.duration_days, e.is_online, e.is_live, e.image, e.description, e.capacity,
  e.attending_count, e.status, e.created_at, e.updated_at
`;

const table = "events e";

function toEvent(row: EventRow): EventItem {
  return {
    id: row.id,
    day: formatDay(row.starts_at),
    month: formatMonth(row.starts_at),
    title: row.title,
    place: row.place,
    time: formatEventTime(row.starts_at, Number(row.duration_days)),
    category: row.category,
    image: row.image,
    live: row.is_live === 1,
    startsAt: row.starts_at,
  };
}

function toEventDetail(row: EventRow, isSaved: boolean): EventDetail {
  return {
    ...toEvent(row),
    slug: row.slug,
    description: row.description,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    isOnline: row.is_online === 1,
    city: row.city,
    country: row.country,
    churchId: row.church_id,
    attendingCount: Number(row.attending_count ?? 0),
    capacity: row.capacity === null ? null : Number(row.capacity),
    isSaved,
    status: row.status as EventDetail["status"],
  };
}

function buildWhere(query: ReturnType<typeof listQueryFrom>, req: Request) {
  const where = new WhereBuilder().addPublished("e", query.includeDrafts === true);
  const category = typeof req.query.category === "string" ? req.query.category : undefined;
  where.addIf(category, "e.category = ?", category);
  const churchId = typeof req.query.church === "string" ? req.query.church : undefined;
  where.addIf(churchId, "e.church_id = ?", churchId);
  const city = typeof req.query.city === "string" ? req.query.city : undefined;
  where.addIf(city, "e.city = ? COLLATE NOCASE", city);
  where.addWhen(req.query.online === "true", "e.is_online = 1");
  where.addWhen(req.query.live === "true", "e.is_live = 1");
  where.addSearch(["e.title", "e.place", "e.city", "e.description", "e.category", "e.venue"], query.q);

  // `?upcoming=true` (the default view) hides events that have already ended.
  if (req.query.upcoming !== "false") {
    where.add("e.starts_at >= ?", isoTimestamp(-86_400_000));
  }
  return where;
}

const sortMap: Record<string, string> = {
  title: "e.title",
  starts: "e.starts_at",
  category: "e.category",
  created: "e.created_at",
};

/** `GET /api/events` — bare `EventItem[]` for the frontend events page. */
export function listEvents(req: Request): { items: EventItem[]; meta: ListMeta } {
  const query = listQueryFrom(req);
  const where = buildWhere(query, req);
  const { rows, total } = paginate<EventRow>({
    select: selectColumns,
    from: table,
    where,
    orderBy: orderBy(sortColumn(query.sort, sortMap, "e.starts_at"), "asc"),
    limit: query.limit,
    offset: query.offset,
  });
  return { items: rows.map(toEvent), meta: buildMeta(total, query.limit, query.offset) };
}

export function findEvent(idOrSlug: string, userId: string | null): EventDetail {
  const row = get<EventRow>(
    `${selectList(selectColumns)} FROM ${table}
     WHERE (e.id = ? OR e.slug = ?) AND e.deleted_at IS NULL AND e.status = 'published'`,
    [idOrSlug, idOrSlug],
  );
  if (!row) throw notFound("Event");
  return toEventDetail(row, isSaved(userId, String(row.id)));
}

function isSaved(userId: string | null, eventId: string): boolean {
  if (!userId) return false;
  return Boolean(get("SELECT 1 FROM saved_events WHERE user_id = ? AND event_id = ?", [userId, eventId]));
}

export function listSavedEvents(userId: string): EventDetail[] {
  const rows = all<EventRow>(
    `${selectList(selectColumns)}
     FROM saved_events s
     JOIN ${table} ON e.id = s.event_id AND e.deleted_at IS NULL
     WHERE s.user_id = ? AND e.status = 'published'
     ORDER BY e.starts_at`,
    [userId],
  );
  return rows.map((row) => toEventDetail(row, true));
}

export function saveEvent(userId: string, idOrSlug: string, remindBeforeMinutes = 60): { saved: boolean } {
  const event = get<{ id: string }>("SELECT id FROM events WHERE (id = ? OR slug = ?) AND deleted_at IS NULL", [idOrSlug, idOrSlug]);
  if (!event) throw notFound("Event");
  run(
    `INSERT INTO saved_events (user_id, event_id, remind_before_minutes) VALUES (?, ?, ?)
     ON CONFLICT(user_id, event_id) DO UPDATE SET remind_before_minutes = excluded.remind_before_minutes`,
    [userId, event.id, Math.min(10_080, Math.max(0, remindBeforeMinutes))],
  );
  return { saved: true };
}

export function unsaveEvent(userId: string, idOrSlug: string): { saved: boolean } {
  run(
    "DELETE FROM saved_events WHERE user_id = ? AND event_id IN (SELECT id FROM events WHERE id = ? OR slug = ?)",
    [userId, idOrSlug, idOrSlug],
  );
  return { saved: false };
}

export function incrementAttending(idOrSlug: string): { attendingCount: number } {
  const event = get<{ id: string }>(
    "SELECT id FROM events WHERE (id = ? OR slug = ?) AND deleted_at IS NULL AND status = 'published'",
    [idOrSlug, idOrSlug],
  );
  if (!event) throw notFound("Event");
  run("UPDATE events SET attending_count = attending_count + 1 WHERE id = ?", [event.id]);
  const row = get<{ attending_count: number }>("SELECT attending_count FROM events WHERE id = ?", [event.id]);
  return { attendingCount: Number(row?.attending_count ?? 0) };
}

export function eventFacets(): { categories: { category: string; count: number }[]; cities: string[] } {
  return {
    categories: all<{ category: string; count: number }>(
      `SELECT category, COUNT(*) AS count FROM events
       WHERE deleted_at IS NULL AND status = 'published' AND starts_at >= ?
       GROUP BY category ORDER BY count DESC, category`,
      [isoTimestamp(-86_400_000)],
    ),
    cities: all<{ city: string }>(
      `SELECT DISTINCT city FROM events
       WHERE deleted_at IS NULL AND status = 'published' AND city IS NOT NULL AND city != ''
       ORDER BY city`,
    ).map((row) => row.city),
  };
}

// ─── Write operations ────────────────────────────────────────────────────────

/**
 * Field definitions live outside the schema so the PATCH body can reuse them.
 * Zod 4 refuses `.partial()` on an object that already carries refinements, and
 * rebuilding from the shape here keeps create and update validating identically.
 */
const eventInputShape = {
  title: z.string().trim().min(1).max(200),
  category: z.string().trim().max(80).default("Worship"),
  place: z.string().trim().max(200).default(""),
  venue: z.string().trim().max(200).nullable().optional(),
  city: z.string().trim().max(120).nullable().optional(),
  country: z.string().trim().max(120).nullable().optional(),
  churchId: z.string().trim().max(120).nullable().optional(),
  startsAt: z.string().trim().min(4).max(40),
  endsAt: z.string().trim().max(40).nullable().optional(),
  durationDays: z.number().int().min(1).max(60).default(1),
  isOnline: z.boolean().default(false),
  isLive: z.boolean().default(false),
  image: z.string().trim().max(400).default(""),
  description: z.string().max(8000).nullable().optional(),
  capacity: z.number().int().min(0).max(10_000_000).nullable().optional(),
  status: z.enum(["draft", "published", "archived", "cancelled"]).default("published"),
  id: z.string().trim().max(120).optional(),
} as const;

/** Rejects unparseable start dates, and ends that precede their start. */
function refineEventDates<T extends { startsAt?: string; endsAt?: string | null }>(value: T, ctx: z.RefinementCtx): void {
  if (value.startsAt !== undefined && !Number.isFinite(Date.parse(value.startsAt))) {
    ctx.addIssue({ code: "custom", message: "startsAt must be an ISO-8601 date", path: ["startsAt"] });
  }
  if (value.endsAt && value.startsAt !== undefined && Date.parse(value.endsAt) < Date.parse(value.startsAt)) {
    ctx.addIssue({ code: "custom", message: "endsAt must be on or after startsAt", path: ["endsAt"] });
  }
}

export const eventInputSchema = z.object(eventInputShape).superRefine(refineEventDates);

/** Unrefined, so `partialOf` can build a PATCH body from it. */
export const eventPatchShapeSchema = z.object(eventInputShape);

/** PATCH body: any subset of the fields, same date rules, at least one field. */
export const eventPatchSchema = eventPatchShapeSchema
  .partial()
  .superRefine(refineEventDates)
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one field to update",
  });

export type EventInput = z.output<typeof eventInputSchema>;

/** Store timestamps as ISO-8601 UTC so `formatDay`/`formatMonth` are stable. */
function toIso(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function uniqueSlug(title: string, ignoreId?: string): string {
  const slug = slugify(title);
  if (!slug) throw unprocessable("The title must contain at least one letter or digit", { field: "title" });
  const clash = get<{ id: string }>("SELECT id FROM events WHERE slug = ?", [slug]);
  if (!clash || clash.id === ignoreId) return slug;
  let candidate = `${slug}-2`;
  let counter = 3;
  while (get("SELECT 1 FROM events WHERE slug = ?", [candidate])) {
    candidate = `${slug}-${counter}`;
    counter += 1;
  }
  return candidate;
}

export function createEvent(input: EventInput, createdBy: string | null): EventDetail {
  const id = input.id ?? newId();
  if (get("SELECT 1 FROM events WHERE id = ?", [id])) {
    throw unprocessable(`An event with the id "${id}" already exists`, { field: "id" });
  }
  const slug = uniqueSlug(input.title);
  run(
    `INSERT INTO events (id, slug, title, category, place, venue, city, country, church_id, starts_at,
                         ends_at, duration_days, is_online, is_live, image, description, capacity, status, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      slug,
      input.title,
      input.category,
      input.place,
      input.venue ?? null,
      input.city ?? null,
      input.country ?? null,
      input.churchId ?? null,
      toIso(input.startsAt),
      input.endsAt ? toIso(input.endsAt) : null,
      input.durationDays,
      input.isOnline ? 1 : 0,
      input.isLive ? 1 : 0,
      input.image,
      input.description ?? null,
      input.capacity ?? null,
      input.status,
      createdBy,
    ],
  );
  return findEvent(id, null);
}

export function updateEvent(id: string, input: Partial<EventInput>): EventDetail {
  const existing = findEvent(id, null);
  const map: Record<string, string> = {
    title: "title",
    category: "category",
    place: "place",
    venue: "venue",
    city: "city",
    country: "country",
    churchId: "church_id",
    endsAt: "ends_at",
    durationDays: "duration_days",
    image: "image",
    description: "description",
    capacity: "capacity",
    status: "status",
  };
  const booleanMap: Record<string, string> = { isOnline: "is_online", isLive: "is_live" };
  const assignments: string[] = [];
  const params: (string | number | null)[] = [];

  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || key === "id" || key === "startsAt") continue;
    if (key === "endsAt") {
      assignments.push("ends_at = ?");
      params.push(typeof value === "string" && value ? toIso(value) : null);
      continue;
    }
    if (booleanMap[key]) {
      assignments.push(`${booleanMap[key]} = ?`);
      params.push(value ? 1 : 0);
      continue;
    }
    const column = map[key];
    if (!column) continue;
    assignments.push(`${column} = ?`);
    params.push(value as string | number | null);
  }
  if (input.title !== undefined) {
    assignments.push("slug = ?");
    params.push(uniqueSlug(input.title, existing.id));
  }
  if (input.startsAt !== undefined) {
    assignments.push("starts_at = ?");
    params.push(toIso(input.startsAt));
  }

  if (assignments.length > 0) {
    params.push(id);
    run(`UPDATE events SET ${assignments.join(", ")}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`, params);
  }
  return findEvent(id, null);
}

export function deleteEvent(id: string): void {
  const result = run("UPDATE events SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND deleted_at IS NULL", [id]);
  if (result.changes === 0) throw notFound("Event");
}

export function restoreEvent(id: string): void {
  const result = run("UPDATE events SET deleted_at = NULL WHERE id = ?", [id]);
  if (result.changes === 0) throw notFound("Event");
}
