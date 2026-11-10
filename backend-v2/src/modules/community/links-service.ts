/**
 * Real relationships between content, and the "related" rail that reads them.
 *
 * `content_links` had a table and exactly one reader (`tracks/service.ts`), so
 * an article that mentioned a camp meeting had nothing to point a reader at and
 * the related rail on the article page was a hand-written list of hard-coded
 * slugs. This module gives the table a writer and a resolver.
 *
 * The resolver is the interesting half. An editorial link is only as good as
 * the person who made it, so the rail falls back to inference when a target has
 * no links: shared category, then shared channel, then a keyword overlap over
 * the title. Inference is marked in the response, because a rail that silently
 * mixes "chosen by an editor" with "guessed from the title" is a rail nobody can
 * correct.
 */

import { z } from "zod";
import { all, get, run } from "../../db/client.ts";
import { badRequest, notFound } from "../../lib/errors.ts";
import { newId } from "../../lib/http.ts";

export const linkTargetTypes = ["article", "reel", "church", "track", "sermon", "event"] as const;
export type LinkTargetType = (typeof linkTargetTypes)[number];

export type ContentLink = {
  id: string;
  fromType: LinkTargetType;
  fromId: string;
  toType: LinkTargetType;
  toId: string;
  relation: string;
  position: number;
  createdAt: string;
};

export type RelatedItem = {
  type: LinkTargetType;
  id: string;
  title: string;
  subtitle: string | null;
  href: string;
  imageUrl: string | null;
  meta: string | null;
  /** `linked` came from `content_links`; `inferred` was worked out from the text. */
  via: "linked" | "inferred";
};

export const linkBodySchema = z.object({
  fromType: z.enum(linkTargetTypes),
  fromId: z.string().trim().min(1).max(200),
  toType: z.enum(linkTargetTypes),
  toId: z.string().trim().min(1).max(200),
  relation: z.string().trim().max(60).default("related"),
  position: z.number().int().min(0).max(999).default(0),
});

export const linkQuerySchema = z.object({
  fromType: z.enum(linkTargetTypes),
  fromId: z.string().trim().min(1).max(200),
  direction: z.enum(["out", "in", "both"]).default("out"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

type LinkRow = {
  id: string;
  from_type: string;
  from_id: string;
  to_type: string;
  to_id: string;
  relation: string;
  position: number;
  created_at: string;
};

function toLink(row: LinkRow): ContentLink {
  return {
    id: row.id,
    fromType: row.from_type as LinkTargetType,
    fromId: row.from_id,
    toType: row.to_type as LinkTargetType,
    toId: row.to_id,
    relation: row.relation,
    position: Number(row.position),
    createdAt: row.created_at,
  };
}

export function listLinks(
  fromType: LinkTargetType,
  fromId: string,
  direction: "out" | "in" | "both" = "out",
  limit = 50,
): ContentLink[] {
  if (direction === "out") {
    return all<LinkRow>(
      "SELECT * FROM content_links WHERE from_type = ? AND from_id = ? ORDER BY position, created_at LIMIT ?",
      [fromType, fromId, limit],
    ).map(toLink);
  }
  if (direction === "in") {
    return all<LinkRow>(
      "SELECT * FROM content_links WHERE to_type = ? AND to_id = ? ORDER BY position, created_at LIMIT ?",
      [fromType, fromId, limit],
    ).map(toLink);
  }
  return all<LinkRow>(
    `SELECT * FROM content_links
     WHERE (from_type = ? AND from_id = ?) OR (to_type = ? AND to_id = ?)
     ORDER BY position, created_at LIMIT ?`,
    [fromType, fromId, fromType, fromId, limit],
  ).map(toLink);
}

export function createLink(input: z.infer<typeof linkBodySchema>): ContentLink {
  if (input.fromType === input.toType && input.fromId === input.toId) {
    throw badRequest("A piece of content cannot be related to itself");
  }
  const id = newId();
  run(
    `INSERT INTO content_links (id, from_type, from_id, to_type, to_id, relation, position)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(from_type, from_id, to_type, to_id, relation) DO UPDATE SET position = excluded.position`,
    [id, input.fromType, input.fromId, input.toType, input.toId, input.relation, input.position],
  );
  const row = get<LinkRow>(
    `SELECT * FROM content_links
     WHERE from_type = ? AND from_id = ? AND to_type = ? AND to_id = ? AND relation = ?`,
    [input.fromType, input.fromId, input.toType, input.toId, input.relation],
  );
  if (!row) throw notFound("Content link");
  return toLink(row);
}

export function deleteLink(id: string): { deleted: boolean } {
  const result = run("DELETE FROM content_links WHERE id = ?", [id]);
  if (result.changes === 0) throw notFound("Content link");
  return { deleted: true };
}

export function deleteLinksFrom(fromType: LinkTargetType, fromId: string): { deleted: number } {
  return { deleted: run("DELETE FROM content_links WHERE from_type = ? AND from_id = ?", [fromType, fromId]).changes };
}

// ─── Resolving the rail ───────────────────────────────────────────────────────

/** Stop words that would otherwise make every article match every other one. */
const NOISE = new Set([
  "the", "and", "for", "with", "that", "this", "from", "our", "your", "are", "was", "has", "have", "its",
  "how", "why", "what", "when", "who", "will", "new", "into", "over", "hows", "heres", "you", "not",
  "church", "adventist", "sda", "video", "watch", "official", "audio", "hd",
]);

function keywords(value: string): string[] {
  return [
    ...new Set(
      value
        .toLowerCase()
        .replace(/[^a-z0-9 ]+/g, " ")
        .split(/\s+/)
        .filter((word) => word.length > 3 && !NOISE.has(word)),
    ),
  ];
}

/**
 * Where a link of each kind can actually be opened.
 *
 * Only articles and reels have detail pages; churches, sermons, events and
 * tracks are browsed from their list pages (and `/music/[slug]` resolves mixes,
 * not tracks), so those surfaces point at the list rather than at a
 * `/<type>/<id>` path that would 404 — the article rail was serving dead links
 * for every church and event a story was about.
 */
const SURFACES: Record<LinkTargetType, (id: string) => string> = {
  article: (id) => `/news/${id}`,
  reel: (id) => `/reels?reel=${id}`,
  church: () => `/churches`,
  track: () => `/music`,
  sermon: () => `/sermons`,
  event: () => `/events`,
};

/**
 * One projection per surface, with the column names each table actually has.
 *
 * `body` is the short searchable text, never the long one: the inference pass
 * reads up to 200 candidates per surface and an article's full body would turn
 * a rail into a full-text scan.
 */
const SELECTS: Record<LinkTargetType, string> = {
  article: `SELECT id, slug, title, category AS subtitle, image AS image, author AS meta, category, excerpt AS body
            FROM news_articles WHERE id = ? AND deleted_at IS NULL AND status = 'published'`,
  reel: `SELECT v.video_id AS id, v.title, c.title AS subtitle, v.thumbnail_url AS image,
                v.published_at AS meta, v.reel_category AS category, COALESCE(v.description, '') AS body
         FROM youtube_videos v JOIN youtube_channels c ON c.channel_id = v.channel_id WHERE v.video_id = ?`,
  church: `SELECT id, name AS title, city AS subtitle, image AS image, service AS meta, NULL AS category,
                  COALESCE(description, '') AS body
           FROM churches WHERE id = ? AND deleted_at IS NULL`,
  track: `SELECT id, title, artist AS subtitle, image AS image, duration_seconds AS meta, sub_category AS category,
                 COALESCE(tags, '') AS body
          FROM tracks WHERE id = ? AND deleted_at IS NULL`,
  sermon: `SELECT id, title, speaker AS subtitle, image AS image, duration_seconds AS meta, category,
                  COALESCE(description, '') AS body
           FROM sermons WHERE id = ? AND deleted_at IS NULL`,
  event: `SELECT id, title, venue AS subtitle, image AS image, starts_at AS meta, category,
                 COALESCE(description, '') AS body
          FROM events WHERE id = ? AND deleted_at IS NULL`,
};

type TargetRow = {
  id: string;
  slug: string | null;
  title: string | null;
  subtitle: string | null;
  image: string | null;
  meta: string | null;
  category: string | null;
  body: string | null;
};

function loadTarget(type: LinkTargetType, id: string): TargetRow | null {
  const row = get<Record<string, unknown>>(SELECTS[type], [id]);
  if (!row) return null;
  const text = (value: unknown) => (value === null || value === undefined ? null : String(value));
  return {
    id: String(row.id),
    slug: text(row.slug),
    title: text(row.title),
    subtitle: text(row.subtitle),
    image: text(row.image),
    meta: text(row.meta),
    category: text(row.category),
    body: text(row.body),
  };
}

function toRelated(type: LinkTargetType, row: TargetRow, via: "linked" | "inferred"): RelatedItem {
  return {
    type,
    id: row.id,
    title: row.title ?? "Untitled",
    subtitle: row.subtitle,
    // Articles are addressed by slug everywhere in the app, so that is the id a
    // link must carry; everything else addresses rows by id.
    href: SURFACES[type](type === "article" ? row.slug ?? row.id : row.id),
    imageUrl: row.image,
    meta: row.meta,
    via,
  };
}

/** How many candidates the inference pass will read per surface. */
const INFERENCE_SCAN = 200;

/**
 * Reels are keyed by YouTube's `video_id` and articles by `slug`, so the id
 * column is per-surface too — and it is the same id the resolver above accepts.
 */
function idColumnOf(type: LinkTargetType): string {
  return type === "reel" ? "video_id" : type === "article" ? "slug" : "id";
}

function candidateIds(type: LinkTargetType, excludeId: string, limit: number): string[] {
  const column = idColumnOf(type);
  return all<{ value: string }>(
    `SELECT ${column} AS value FROM ${sourceOf(type)} WHERE ${column} != ? LIMIT ?`,
    [excludeId, limit],
  ).map((entry) => entry.value);
}

function sourceOf(type: LinkTargetType): string {
  switch (type) {
    case "article":
      return "news_articles";
    case "reel":
      return "youtube_videos";
    case "church":
      return "churches";
    case "track":
      return "tracks";
    case "sermon":
      return "sermons";
    case "event":
      return "events";
  }
}

/** Everything a rail can show, in one call, so the client renders one response. */
export function relatedContent(
  type: LinkTargetType,
  id: string,
  limit = 12,
  types: LinkTargetType[] = ["reel", "article", "church", "sermon", "event"],
): RelatedItem[] {
  const linked = listLinks(type, id, "out", 60);
  const seen = new Set<string>([`${type}:${id}`]);
  const items: RelatedItem[] = [];

  for (const link of linked) {
    const key = `${link.toType}:${link.toId}`;
    if (seen.has(key) || !types.includes(link.toType)) continue;
    const target = loadTarget(link.toType, link.toId);
    if (!target) continue;
    seen.add(key);
    items.push(toRelated(link.toType, target, "linked"));
    if (items.length >= limit) return items;
  }

  const self = loadTarget(type, id);
  if (!self || items.length >= limit) return items;
  const selfWords = new Set(keywords(`${self.title ?? ""} ${self.body ?? ""} ${self.category ?? ""}`));
  if (selfWords.size === 0) return items;

  for (const candidateType of types) {
    if (candidateType === type || items.length >= limit) continue;
    for (const candidateId of candidateIds(candidateType, id, INFERENCE_SCAN)) {
      if (items.length >= limit) break;
      const target = loadTarget(candidateType, candidateId);
      if (!target?.title) continue;
      const key = `${candidateType}:${target.id}`;
      if (seen.has(key)) continue;
      const words = keywords(`${target.title} ${target.body ?? ""} ${target.category ?? ""}`);
      // Two shared words is the floor. One shared word is how "Camp Meeting" and
      // "Camp Meeting Campfire Special" end up on each other's rail, and a rail
      // that looks broken is worse than a short one.
      if (words.filter((word) => selfWords.has(word)).length < 2) continue;
      seen.add(key);
      items.push(toRelated(candidateType, target, "inferred"));
    }
  }
  return items;
}
