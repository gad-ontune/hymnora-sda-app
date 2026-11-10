import { z } from "zod";
import type { Request } from "express";
import { all, get, run, type Row } from "../../db/client.ts";
import { notFound, unprocessable } from "../../lib/errors.ts";
import { WhereBuilder, orderBy, paginate, selectList } from "../../lib/sql.ts";
import { listQueryFrom, sortColumn } from "../../lib/query.ts";
import { buildMeta, newId, slugify } from "../../lib/http.ts";
import { formatDay, formatEventTime, formatMonth, isoTimestamp } from "../../lib/time.ts";
import { formatDistance, isValidCoordinate, radiusFilter } from "../../lib/geo.ts";
import { parseJson } from "../../lib/text.ts";
import type { Church, ChurchDetail, EventDetail, EventItem, ServiceTime } from "../../types/domain.ts";
import type { ListMeta } from "../../types/api.ts";

type ChurchRow = Row & {
  id: string;
  slug: string;
  name: string;
  location: string;
  address: string | null;
  city: string;
  region: string | null;
  country: string;
  country_code: string | null;
  conference: string | null;
  latitude: number;
  longitude: number;
  service: string;
  service_times: string;
  image: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  members: number | null;
  established: string | null;
  description: string | null;
  ministries: string;
  verified: number;
  is_live: number;
  live_status: string | null;
  is_active: number;
  created_at: string;
  distance_km?: number;
};

const churchSelect = `
  c.id, c.slug, c.name, c.location, c.address, c.city, c.region, c.country, c.country_code, c.conference,
  c.latitude, c.longitude, c.service, c.service_times, c.image, c.phone, c.email, c.website,
  c.members, c.established, c.description, c.ministries, c.verified, c.is_live, c.live_status,
  c.is_active, c.created_at
`;

/**
 * `distance` is a display string, so callers that computed a real distance pass
 * it in; otherwise it reads as "—" rather than a fabricated number.
 */
function toChurch(row: ChurchRow, distanceKm?: number): Church {
  const status: Church["status"] = row.is_live === 1 ? "Live now" : row.verified === 1 ? "Verified" : undefined;
  return {
    id: row.id,
    name: row.name,
    location: row.location,
    service: row.service,
    image: row.image,
    status,
    distance: distanceKm === undefined ? "—" : formatDistance(distanceKm),
    latitude: row.latitude,
    longitude: row.longitude,
  };
}

function toChurchDetail(row: ChurchRow, upcomingEvents: EventItem[]): ChurchDetail {
  return {
    ...toChurch(row),
    slug: row.slug,
    address: row.address,
    city: row.city,
    region: row.region,
    country: row.country,
    countryCode: row.country_code,
    conference: row.conference,
    phone: row.phone,
    email: row.email,
    website: row.website,
    members: row.members === null ? null : Number(row.members),
    established: row.established,
    description: row.description,
    ministries: parseJson<string[]>(row.ministries, []),
    serviceTimes: parseJson<ServiceTime[]>(row.service_times, []),
    verified: row.verified === 1,
    isLive: row.is_live === 1,
    upcomingEvents,
    createdAt: row.created_at,
  };
}

const table = "churches c";

function buildWhere(query: ReturnType<typeof listQueryFrom>, req: Request) {
  const where = new WhereBuilder().addActive("c", query.includeDrafts === true);
  where.addWhen(req.query.verified === "true", "c.verified = 1");
  where.addWhen(req.query.live === "true", "c.is_live = 1");
  const country = typeof req.query.country === "string" ? req.query.country : undefined;
  where.addIf(country, "c.country = ? COLLATE NOCASE", country);
  const city = typeof req.query.city === "string" ? req.query.city : undefined;
  where.addIf(city, "c.city = ? COLLATE NOCASE", city);
  const conference = typeof req.query.conference === "string" ? req.query.conference : undefined;
  where.addIf(conference, "c.conference = ?", conference);
  where.addSearch(["c.name", "c.city", "c.country", "c.location", "c.description"], query.q);
  return where;
}

const sortMap: Record<string, string> = {
  name: "c.name",
  city: "c.city",
  country: "c.country",
  members: "c.members",
  created: "c.created_at",
};

type ChurchQuery = { lat?: number; lng?: number; radiusKm?: number };

/**
 * Reads `?lat=&lng=&radius=` into a radius search.
 *
 * A radius filter is meaningless without a centre, so partial pairs are ignored
 * rather than silently defaulting to (0,0) off the coast of Africa.
 */
function readRadius(req: Request): ChurchQuery {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  const radius = Number(req.query.radius ?? 50);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return {};
  if (!isValidCoordinate(lat, lng)) return {};
  return { lat, lng, radiusKm: Number.isFinite(radius) ? Math.min(20_000, Math.max(1, radius)) : 50 };
}

/** `GET /api/churches` — bare `Church[]` for the frontend churches page. */
export function listChurches(req: Request): { items: Church[]; meta: ListMeta } {
  const query = listQueryFrom(req);
  const where = buildWhere(query, req);
  const radius = readRadius(req);

  // When a centre is supplied, switch to a bounding-box prefilter + exact
  // haversine ordering so pagination stays correct (a plain LIMIT with a
  // computed distance would page arbitrarily).
  if (radius.lat !== undefined && radius.lng !== undefined && radius.radiusKm !== undefined) {
    const box = radiusFilter(radius.lat, radius.lng, radius.radiusKm);
    where.add(box.sql, ...box.params);
    const rows = all<ChurchRow & { distance_km: number }>(
      `${selectList(`${churchSelect},
        (6371 * 2 * asin(sqrt(pow(sin(radians((${radius.lat} - c.latitude) / 2)), 2) +
             cos(radians(${radius.lat})) * cos(radians(c.latitude)) *
             pow(sin(radians((${radius.lng} - c.longitude) / 2)), 2)))) AS distance_km`)}
       FROM ${table} WHERE ${where.sql}
       ORDER BY distance_km ASC, c.name ASC
       LIMIT ? OFFSET ?`,
      [...where.values, query.limit, query.offset],
    );
    const total = Number(
      get<{ total: number }>(`SELECT COUNT(*) AS total FROM ${table} WHERE ${where.sql}`, where.values)?.total ?? 0,
    );
    return {
      items: rows.map((row) => toChurch(row, Number(row.distance_km))),
      meta: buildMeta(total, query.limit, query.offset),
    };
  }

  const { rows, total } = paginate<ChurchRow>({
    select: churchSelect,
    from: table,
    where,
    orderBy: orderBy(sortColumn(query.sort, sortMap, "c.name"), "asc"),
    limit: query.limit,
    offset: query.offset,
  });
  return { items: rows.map((row) => toChurch(row)), meta: buildMeta(total, query.limit, query.offset) };
}

export function findChurch(idOrSlug: string): ChurchDetail {
  const row = get<ChurchRow>(
    `${selectList(churchSelect)} FROM ${table}
     WHERE (c.id = ? OR c.slug = ?) AND c.deleted_at IS NULL AND c.is_active = 1`,
    [idOrSlug, idOrSlug],
  );
  if (!row) throw notFound("Church");
  return toChurchDetail(row, upcomingEventsForChurch(String(row.id)));
}

/** Next 5 events for a church, as the detail card shows them. */
function upcomingEventsForChurch(churchId: string, limit = 5): EventItem[] {
  return all<Row & { id: string; title: string; place: string; starts_at: string; duration_days: number; category: string; image: string; is_live: number }>(
    `SELECT e.id, e.title, e.place, e.starts_at, e.duration_days, e.category, e.image, e.is_live
     FROM events e
     WHERE e.church_id = ? AND e.deleted_at IS NULL AND e.status = 'published'
       AND e.starts_at >= ?
     ORDER BY e.starts_at LIMIT ?`,
    [churchId, isoTimestamp(-86_400_000), limit],
  ).map((row) => ({
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
  }));
}

/** Churches the user follows, for the "my churches" rail. */
export function followedChurches(userId: string): Church[] {
  const rows = all<ChurchRow>(
    `${selectList(churchSelect)}
     FROM followed_churches f
     JOIN ${table} ON c.id = f.church_id AND c.deleted_at IS NULL
     WHERE f.user_id = ? ORDER BY c.name`,
    [userId],
  );
  return rows.map((row) => toChurch(row));
}

export function followChurch(userId: string, churchId: string, notifyLive = true): { following: boolean } {
  const target = get<{ id: string }>(
    "SELECT id FROM churches WHERE (id = ? OR slug = ?) AND deleted_at IS NULL",
    [churchId, churchId],
  );
  if (!target) throw notFound("Church");
  run(
    `INSERT INTO followed_churches (user_id, church_id, notify_live) VALUES (?, ?, ?)
     ON CONFLICT(user_id, church_id) DO UPDATE SET notify_live = excluded.notify_live`,
    [userId, target.id, notifyLive ? 1 : 0],
  );
  return { following: true };
}

export function unfollowChurch(userId: string, churchId: string): { following: boolean } {
  run("DELETE FROM followed_churches WHERE user_id = ? AND church_id = ?", [userId, churchId]);
  return { following: false };
}

export function churchFacets(): { countries: string[]; cities: string[]; conferences: string[] } {
  const distinct = (column: string) =>
    all<{ value: string }>(
      `SELECT DISTINCT ${column} AS value FROM churches
       WHERE deleted_at IS NULL AND is_active = 1 AND ${column} IS NOT NULL AND ${column} != ''
       ORDER BY ${column}`,
    ).map((row) => row.value);
  return { countries: distinct("country"), cities: distinct("city"), conferences: distinct("conference") };
}

// ─── Write operations ────────────────────────────────────────────────────────

export const churchInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  location: z.string().trim().max(200).default(""),
  address: z.string().trim().max(300).nullable().optional(),
  city: z.string().trim().max(120).default(""),
  region: z.string().trim().max(120).nullable().optional(),
  country: z.string().trim().max(120).default(""),
  countryCode: z.string().trim().max(4).nullable().optional(),
  conference: z.string().trim().max(160).nullable().optional(),
  latitude: z.number().min(-90).max(90).default(0),
  longitude: z.number().min(-180).max(180).default(0),
  service: z.string().trim().max(160).default("Divine Worship"),
  serviceTimes: z
    .array(z.object({ day: z.string().trim().max(40), name: z.string().trim().max(80), time: z.string().trim().max(40), language: z.string().trim().max(40).optional() }))
    .max(20)
    .default([]),
  image: z.string().trim().max(400).default(""),
  phone: z.string().trim().max(60).nullable().optional(),
  email: z.string().trim().max(200).nullable().optional(),
  website: z.string().trim().max(400).nullable().optional(),
  members: z.number().int().min(0).max(1_000_000).nullable().optional(),
  established: z.string().trim().max(40).nullable().optional(),
  description: z.string().max(8000).nullable().optional(),
  ministries: z.array(z.string().trim().min(1).max(120)).max(40).default([]),
  verified: z.boolean().default(false),
  isActive: z.boolean().default(true),
  id: z.string().trim().max(120).optional(),
});

export type ChurchInput = z.output<typeof churchInputSchema>;

/** `location` is the card's subtitle; derive it when the caller omits it. */
function resolveLocation(input: ChurchInput): string {
  if (input.location.trim()) return input.location;
  return [input.city, input.country].filter(Boolean).join(", ");
}

export function createChurch(input: ChurchInput, createdBy: string | null): ChurchDetail {
  const id = input.id ?? newId();
  const slug = slugify(input.name);
  if (!slug) throw unprocessable("The name must contain at least one letter or digit", { field: "name" });
  if (get("SELECT 1 FROM churches WHERE id = ? OR slug = ?", [id, slug])) {
    throw unprocessable("A church with that name or id already exists", { field: "name" });
  }
  run(
    `INSERT INTO churches (id, slug, name, location, address, city, region, country, country_code,
                           conference, latitude, longitude, service, service_times, image, phone, email,
                           website, members, established, description, ministries, verified, is_active, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      slug,
      input.name,
      resolveLocation(input),
      input.address ?? null,
      input.city,
      input.region ?? null,
      input.country,
      input.countryCode ?? null,
      input.conference ?? null,
      input.latitude,
      input.longitude,
      input.service,
      JSON.stringify(input.serviceTimes),
      input.image,
      input.phone ?? null,
      input.email ?? null,
      input.website ?? null,
      input.members ?? null,
      input.established ?? null,
      input.description ?? null,
      JSON.stringify(input.ministries),
      input.verified ? 1 : 0,
      input.isActive ? 1 : 0,
      createdBy,
    ],
  );
  return findChurch(id);
}

export function updateChurch(id: string, input: Partial<ChurchInput>): ChurchDetail {
  findChurch(id);
  const map: Record<string, string> = {
    name: "name",
    location: "location",
    address: "address",
    city: "city",
    region: "region",
    country: "country",
    countryCode: "country_code",
    conference: "conference",
    latitude: "latitude",
    longitude: "longitude",
    service: "service",
    image: "image",
    phone: "phone",
    email: "email",
    website: "website",
    members: "members",
    established: "established",
    description: "description",
    status: "status",
  };
  const booleanMap: Record<string, string> = { verified: "verified", isActive: "is_active", isLive: "is_live" };
  const assignments: string[] = [];
  const params: (string | number | null)[] = [];

  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || key === "id") continue;
    if (key === "serviceTimes") {
      assignments.push("service_times = ?");
      params.push(JSON.stringify(value));
      continue;
    }
    if (key === "ministries") {
      assignments.push("ministries = ?");
      params.push(JSON.stringify(value));
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
  if (input.name !== undefined) {
    assignments.push("slug = ?");
    params.push(slugify(input.name));
  }

  if (assignments.length > 0) {
    params.push(id);
    run(`UPDATE churches SET ${assignments.join(", ")}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`, params);
  }
  return findChurch(id);
}

export function deleteChurch(id: string): void {
  const result = run("UPDATE churches SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND deleted_at IS NULL", [id]);
  if (result.changes === 0) throw notFound("Church");
}

export function restoreChurch(id: string): void {
  const result = run("UPDATE churches SET deleted_at = NULL WHERE id = ?", [id]);
  if (result.changes === 0) throw notFound("Church");
}
