import { z } from "zod";
import type { Request } from "express";
import { all, get, run, type Row } from "../../db/client.ts";
import { notFound, unprocessable } from "../../lib/errors.ts";
import { WhereBuilder, orderBy, paginate, selectList } from "../../lib/sql.ts";
import { listQueryFrom, sortColumn } from "../../lib/query.ts";
import { buildMeta, newId, slugify } from "../../lib/http.ts";
import { formatReadTime, formatRelativeDate } from "../../lib/time.ts";
import { parseJson, readingMinutes } from "../../lib/text.ts";
import type { NewsArticle, NewsItem } from "../../types/domain.ts";
import type { ListMeta } from "../../types/api.ts";

type ArticleRow = Row & {
  id: string;
  slug: string;
  title: string;
  category: string;
  region: string | null;
  excerpt: string;
  body: string | null;
  source: string;
  author: string | null;
  image: string;
  tags: string;
  featured: number;
  view_count: number;
  status: string;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

const selectColumns = `
  n.id, n.slug, n.title, n.category, n.region, n.excerpt, n.body, n.source, n.author, n.image,
  n.tags, n.featured, n.view_count, n.status, n.published_at, n.created_at, n.updated_at
`;

const table = "news_articles n";

/** The published date is the list sort key, so fall back to `created_at`. */
function publishedAt(row: ArticleRow): string {
  return row.published_at ?? row.created_at;
}

function toNewsItem(row: ArticleRow): NewsItem {
  return {
    id: row.id,
    category: row.category,
    title: row.title,
    excerpt: row.excerpt,
    source: row.source,
    date: formatRelativeDate(publishedAt(row)),
    image: row.image,
    readTime: formatReadTime(readingMinutes(row.body)),
  };
}

function toArticle(row: ArticleRow): NewsArticle {
  return {
    ...toNewsItem(row),
    slug: row.slug,
    body: row.body,
    region: row.region,
    tags: parseJson<string[]>(row.tags, []),
    author: row.author,
    featured: row.featured === 1,
    publishedAt: publishedAt(row),
    readTimeMinutes: readingMinutes(row.body),
    status: row.status as NewsArticle["status"],
  };
}

function buildWhere(query: ReturnType<typeof listQueryFrom>, req: Request) {
  const where = new WhereBuilder().addPublished("n", query.includeDrafts === true);
  where.addIf(query.language, "1 = 1");
  const category = typeof req.query.category === "string" ? req.query.category : undefined;
  where.addIf(category, "n.category = ?", category);
  const region = typeof req.query.region === "string" ? req.query.region : undefined;
  where.addIf(region, "n.region = ?", region);
  const tag = typeof req.query.tag === "string" ? req.query.tag : undefined;
  where.addIf(tag, "n.tags LIKE ?", `%"${tag}"%`);
  where.addWhen(req.query.featured === "true", "n.featured = 1");
  where.addSearch(["n.title", "n.excerpt", "n.body", "n.category", "n.tags", "n.source"], query.q);
  return where;
}

const sortMap: Record<string, string> = {
  title: "n.title",
  category: "n.category",
  published: "COALESCE(n.published_at, n.created_at)",
  views: "n.view_count",
  created: "n.created_at",
};

/** `GET /api/news` — bare `NewsItem[]` for the frontend news page. */
export function listNews(req: Request): { items: NewsItem[]; meta: ListMeta } {
  const query = listQueryFrom(req);
  const where = buildWhere(query, req);
  const { rows, total } = paginate<ArticleRow>({
    select: selectColumns,
    from: table,
    where,
    orderBy: orderBy(sortColumn(query.sort, sortMap, "COALESCE(n.published_at, n.created_at)"), query.order),
    limit: query.limit,
    offset: query.offset,
  });
  return { items: rows.map(toNewsItem), meta: buildMeta(total, query.limit, query.offset) };
}

export function listArticles(req: Request): { items: NewsArticle[]; meta: ListMeta } {
  const query = listQueryFrom(req);
  const where = buildWhere(query, req);
  const { rows, total } = paginate<ArticleRow>({
    select: selectColumns,
    from: table,
    where,
    orderBy: orderBy(sortColumn(query.sort, sortMap, "COALESCE(n.published_at, n.created_at)"), query.order),
    limit: query.limit,
    offset: query.offset,
  });
  return { items: rows.map(toArticle), meta: buildMeta(total, query.limit, query.offset) };
}

/** Articles resolve by slug first (the frontend links by slug) then by id. */
export function findArticle(idOrSlug: string, includeDrafts = false): NewsArticle {
  const row = get<ArticleRow>(
    `${selectList(selectColumns)} FROM ${table}
     WHERE (n.id = ? OR n.slug = ?) AND n.deleted_at IS NULL ${includeDrafts ? "" : "AND n.status = 'published'"}`,
    [idOrSlug, idOrSlug],
  );
  if (!row) throw notFound("Article");
  return toArticle(row);
}

export function incrementViews(idOrSlug: string): void {
  run("UPDATE news_articles SET view_count = view_count + 1 WHERE id = ? OR slug = ?", [idOrSlug, idOrSlug]);
}

/** Category chips with counts, for the news filter bar. */
export function newsFacets(): { categories: { category: string; count: number }[]; regions: string[] } {
  return {
    categories: all<{ category: string; count: number }>(
      `SELECT category, COUNT(*) AS count FROM news_articles
       WHERE deleted_at IS NULL AND status = 'published'
       GROUP BY category ORDER BY count DESC, category`,
    ),
    regions: all<{ region: string }>(
      `SELECT DISTINCT region FROM news_articles
       WHERE deleted_at IS NULL AND status = 'published' AND region IS NOT NULL AND region != ''
       ORDER BY region`,
    ).map((row) => row.region),
  };
}

// ─── Write operations ────────────────────────────────────────────────────────

export const newsInputSchema = z.object({
  title: z.string().trim().min(1).max(240),
  category: z.string().trim().max(80).default("Community"),
  region: z.string().trim().max(80).nullable().optional(),
  excerpt: z.string().trim().max(600).default(""),
  body: z.string().max(200_000).nullable().optional(),
  source: z.string().trim().max(160).default("Hymnora Editorial"),
  author: z.string().trim().max(160).nullable().optional(),
  image: z.string().trim().max(400).default(""),
  tags: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  featured: z.boolean().default(false),
  publishedAt: z.string().trim().max(40).nullable().optional(),
  status: z.enum(["draft", "published", "archived"]).default("published"),
  id: z.string().trim().max(120).optional(),
});

export type NewsInput = z.output<typeof newsInputSchema>;

function uniqueSlug(title: string, ignoreId?: string): string {
  const slug = slugify(title);
  if (!slug) throw unprocessable("The title must contain at least one letter or digit", { field: "title" });
  const clash = get<{ id: string }>("SELECT id FROM news_articles WHERE slug = ?", [slug]);
  if (!clash || clash.id === ignoreId) return slug;
  // Suffix rather than reject, so two articles with the same headline can coexist.
  let candidate = `${slug}-2`;
  let counter = 3;
  while (get("SELECT 1 FROM news_articles WHERE slug = ?", [candidate])) {
    candidate = `${slug}-${counter}`;
    counter += 1;
  }
  return candidate;
}

export function createArticle(input: NewsInput, createdBy: string | null): NewsArticle {
  const id = input.id ?? newId();
  if (get("SELECT 1 FROM news_articles WHERE id = ?", [id])) {
    throw unprocessable(`An article with the id "${id}" already exists`, { field: "id" });
  }
  const slug = uniqueSlug(input.title);
  const publishedAt = input.publishedAt ?? (input.status === "published" ? new Date().toISOString() : null);
  run(
    `INSERT INTO news_articles (id, slug, title, category, region, excerpt, body, source, author, image,
                                tags, featured, published_at, status, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      slug,
      input.title,
      input.category,
      input.region ?? null,
      input.excerpt,
      input.body ?? null,
      input.source,
      input.author ?? null,
      input.image,
      JSON.stringify(input.tags),
      input.featured ? 1 : 0,
      publishedAt,
      input.status,
      createdBy,
    ],
  );
  return findArticle(id, true);
}

export function updateArticle(id: string, input: Partial<NewsInput>): NewsArticle {
  const existing = findArticle(id, true);
  const map: Record<string, string> = {
    title: "title",
    category: "category",
    region: "region",
    excerpt: "excerpt",
    body: "body",
    source: "source",
    author: "author",
    image: "image",
    publishedAt: "published_at",
    status: "status",
  };
  const assignments: string[] = [];
  const params: (string | number | null)[] = [];

  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || key === "id") continue;
    if (key === "tags") {
      assignments.push("tags = ?");
      params.push(JSON.stringify(value));
      continue;
    }
    if (key === "featured") {
      assignments.push("featured = ?");
      params.push(value ? 1 : 0);
      continue;
    }
    const column = map[key];
    if (!column) continue;
    assignments.push(`${column} = ?`);
    params.push(value as string | null);
  }

  if (input.title !== undefined) {
    assignments.push("slug = ?");
    params.push(uniqueSlug(input.title, existing.id));
  }
  if (input.status === "published" && !existing.publishedAt) {
    assignments.push("published_at = COALESCE(published_at, strftime('%Y-%m-%dT%H:%M:%fZ','now'))");
  }

  if (assignments.length > 0) {
    params.push(id);
    run(`UPDATE news_articles SET ${assignments.join(", ")}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`, params);
  }
  return findArticle(id, true);
}

export function deleteArticle(id: string): void {
  const result = run("UPDATE news_articles SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND deleted_at IS NULL", [id]);
  if (result.changes === 0) throw notFound("Article");
}

export function restoreArticle(id: string): void {
  const result = run("UPDATE news_articles SET deleted_at = NULL WHERE id = ?", [id]);
  if (result.changes === 0) throw notFound("Article");
}
