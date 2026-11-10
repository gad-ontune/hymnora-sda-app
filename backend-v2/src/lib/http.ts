import { randomUUID, createHash } from "node:crypto";
import type { Request, Response } from "express";
import type { ListMeta } from "../types/api.ts";

/** Public-facing resource identifier. */
export function newId(): string {
  return randomUUID();
}

/** Deterministic id derived from a natural key — used by the seeder. */
export function stableId(...parts: (string | number)[]): string {
  return createHash("sha1").update(parts.join("::")).digest("hex").slice(0, 24);
}

export function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}

/**
 * The frontend consumes bare JSON arrays from list endpoints (see `lib/api.ts`),
 * so lists are returned as arrays and totals travel in headers. Callers that
 * want `{ data, meta }` can opt in per request with `?format=envelope`.
 */
export function sendList(res: Response, items: unknown[], meta?: ListMeta, format?: string): void {
  if (meta) {
    res.setHeader("X-Total-Count", String(meta.total));
    res.setHeader("X-Total-Pages", String(meta.pageCount));
    res.setHeader("X-Page", String(meta.page));
    res.setHeader("X-Limit", String(meta.limit));
    res.setHeader("X-Has-More", String(meta.hasMore));
  }
  if (format === "envelope") {
    res.json({ data: items, meta });
    return;
  }
  res.json(items);
}

export function buildMeta(total: number, limit: number, offset: number): ListMeta {
  const pageCount = limit > 0 ? Math.ceil(total / limit) : 0;
  return {
    total,
    limit,
    offset,
    page: limit > 0 ? Math.floor(offset / limit) + 1 : 1,
    pageCount,
    hasMore: offset + limit < total,
  };
}

/** Reads the requested response shape from the query string. */
export function responseFormat(req: Request): string | undefined {
  const value = req.query.format;
  return typeof value === "string" ? value : undefined;
}
