import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../lib/async.ts";
import { responseFormat, sendList } from "../../lib/http.ts";
import { booleanQuery, csvQuery, parseWith } from "../../lib/validate.ts";
import { CONTENT_TYPES, type Availability, type ContentType } from "../../types/domain.ts";
import { popularSearches, recordQuery, search, searchFacets } from "./service.ts";

export const searchRouter: Router = Router();

const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(200),
  type: csvQuery.optional(),
  language: z.string().trim().max(40).optional(),
  availability: z.enum(["any", "live", "replay", "download"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  suggest: booleanQuery.optional(),
});

/**
 * `GET /api/search?q=` — the global search palette.
 *
 * Returns a bare `SearchResult[]`, which is what the frontend's `search()` helper
 * already consumes. Unknown `?type=` values are dropped rather than rejected so
 * a stale client link degrades to an unfiltered search instead of a 422.
 */
searchRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const params = parseWith(searchQuerySchema, req.query, "query");
    const types = params.type
      ?.filter((value): value is ContentType => (CONTENT_TYPES as string[]).includes(value))
      .slice(0, 6);

    const { results, total } = search({
      q: params.q,
      types,
      language: params.language,
      availability: params.availability as Availability | undefined,
      limit: params.limit ?? 20,
      offset: params.offset ?? 0,
    });
    recordQuery(params.q, total, req.auth?.id ?? null);
    res.setHeader("X-Total-Count", String(total));
    sendList(res, results, undefined, responseFormat(req));
  }),
);

/** Type tabs with result counts, for the search page's filter row. */
searchRouter.get(
  "/facets",
  asyncHandler(async (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    res.json(searchFacets(q));
  }),
);

/** Most-searched queries; drives the empty-state suggestions. */
searchRouter.get(
  "/popular",
  asyncHandler(async (req, res) => {
    const limit = Number.parseInt(String(req.query.limit ?? "8"), 10);
    res.json(popularSearches(Number.isFinite(limit) ? limit : 8));
  }),
);
