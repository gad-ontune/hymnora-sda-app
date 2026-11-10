import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../lib/async.ts";
import { validateParams, param, idSchema, slugSchema } from "../../lib/validate.ts";
import { responseFormat, sendList } from "../../lib/http.ts";
import { attachCrud, partialOf } from "../admin/crud.ts";
import { threadSummary } from "../community/comments-service.ts";
import { relatedContent } from "../community/links-service.ts";
import {
  createArticle,
  deleteArticle,
  findArticle,
  incrementViews,
  listArticles,
  listNews,
  newsFacets,
  newsInputSchema,
  restoreArticle,
  updateArticle,
} from "./service.ts";

export const newsRouter: Router = Router();

/**
 * `GET /api/news` — bare `NewsItem[]`, matching the frontend's `getNews()`.
 * `/facets` is registered before `/:idOrSlug` so it is not read as a slug.
 */
newsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { items, meta } = listNews(req);
    sendList(res, items, meta, responseFormat(req));
  }),
);

newsRouter.get(
  "/facets",
  asyncHandler(async (_req, res) => {
    res.json(newsFacets());
  }),
);

newsRouter.get(
  "/detail",
  asyncHandler(async (req, res) => {
    const { items, meta } = listArticles(req);
    sendList(res, items, meta, responseFormat(req));
  }),
);

/**
 * `GET /api/news/:idOrSlug/related` — the article's related rail, resolved.
 *
 * Registered before `/:idOrSlug` so "related" is never read as a slug, and
 * resolving rather than hard-coding: the article page used to show a fixed list
 * of three stories that had nothing to do with whichever article was open.
 */
newsRouter.get(
  "/:idOrSlug/related",
  validateParams(z.object({ idOrSlug: z.union([idSchema, slugSchema]) })),
  asyncHandler(async (req, res) => {
    const idOrSlug = param(req, "idOrSlug");
    const article = findArticle(idOrSlug, true);
    res.json({
      items: relatedContent("article", article.slug, 12),
      comments: threadSummary("article", article.id),
    });
  }),
);

newsRouter.get(
  "/:idOrSlug",
  validateParams(z.object({ idOrSlug: z.union([idSchema, slugSchema]) })),
  asyncHandler(async (req, res) => {
    const role = req.auth?.role;
    res.json(findArticle(param(req, "idOrSlug"), role === "editor" || role === "admin" || role === "moderator"));
  }),
);

newsRouter.post(
  "/:idOrSlug/view",
  validateParams(z.object({ idOrSlug: z.union([idSchema, slugSchema]) })),
  asyncHandler(async (req, res) => {
    incrementViews(param(req, "idOrSlug"));
    res.status(202).json({ recorded: true });
  }),
);

attachCrud({
  router: newsRouter,
  path: "/",
  createSchema: newsInputSchema,
  updateSchema: partialOf(newsInputSchema),
  create: (input, req) => createArticle(input, req.auth?.id ?? null),
  update: (id, input) => updateArticle(id, input),
  remove: deleteArticle,
  restore: restoreArticle,
});
