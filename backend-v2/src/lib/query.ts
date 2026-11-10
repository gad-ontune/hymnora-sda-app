import type { Request } from "express";
import type { ListQuery } from "../types/api.ts";
import { paginationSchema, parseWith } from "./validate.ts";
import { badRequest } from "./errors.ts";

/** Normalises pagination/query params from a request into a `ListQuery`. */
export function listQueryFrom(req: Request, defaults: Partial<ListQuery> = {}): ListQuery {
  const parsed = parseWith(paginationSchema, req.query, "query");
  const limit = defaults.limit ?? parsed.limit;
  const requestedPage = parsed.page ?? defaults.page;
  const offset = requestedPage ? (requestedPage - 1) * limit : parsed.offset;
  return {
    limit,
    offset,
    page: requestedPage ?? Math.floor(offset / limit) + 1,
    sort: parsed.sort ?? defaults.sort ?? "created_at",
    order: parsed.order ?? defaults.order ?? "desc",
    q: parsed.q ?? defaults.q,
    language: parsed.language ?? defaults.language,
    includeDrafts: parsed.includeDrafts ?? defaults.includeDrafts ?? false,
  };
}

/** Resolves a `sort` token to a real column, guarding against SQL injection. */
export function sortColumn(requested: string | undefined, allowed: Record<string, string>, fallback: string): string {
  if (!requested) return fallback;
  const key = requested.trim();
  return allowed[key] ?? allowed[key.toLowerCase()] ?? fallback;
}

export function assertSortAllowed(requested: string | undefined, allowed: string[]): void {
  if (!requested) return;
  if (!allowed.includes(requested)) {
    throw badRequest(`Cannot sort by "${requested}". Allowed: ${allowed.join(", ")}`);
  }
}
