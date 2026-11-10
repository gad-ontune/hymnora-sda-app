import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../lib/async.ts";
import { validateBody, validateParams, param, idSchema, booleanQuery } from "../../lib/validate.ts";
import { requireAuth } from "../../middleware/auth.ts";
import { writeLimiter } from "../../middleware/rate-limit.ts";
import { badRequest } from "../../lib/errors.ts";
import {
  bookmarkInputSchema,
  createBookmark,
  deleteBookmark,
  findBook,
  findPassage,
  findVersion,
  bibleOverview,
  listBookmarks,
  listBooks,
  listChapter,
  listChapterNumbers,
  listCompleteVersions,
  listVersions,
  spotlightVerses,
  searchVerses,
  updateBookmark,
  versionOrDefault,
  versionsForBook,
} from "./service.ts";
import {
  fetchTranslations,
  fetchBooks,
  fetchChapter,
  fetchCommentaries,
  fetchCommentaryBooks,
  fetchCommentaryChapter,
  fetchDatasets,
  fetchDatasetBooks,
  fetchDatasetChapter,
} from "./external.ts";

export const bibleRouter: Router = Router();

/** `?version=KJV` — defaults to KJV when absent or unrecognised. */
function versionParam(req: { query: Record<string, unknown> }) {
  const raw = req.query.version;
  return versionOrDefault(typeof raw === "string" ? raw : undefined);
}

// ─── Versions ────────────────────────────────────────────────────────────────

bibleRouter.get(
  "/versions",
  asyncHandler(async (_req, res) => {
    res.json(listVersions());
  }),
);

bibleRouter.get(
  "/versions/:id",
  validateParams(z.object({ id: idSchema })),
  asyncHandler(async (req, res) => {
    res.json(findVersion(param(req, "id")));
  }),
);

// ─── Complete versions & overview ─────────────────────────────────────────────

/**
 * The versions the reader may offer. Every entry here has been verified to hold
 * all 66 books and 1,189 chapters locally, so nothing incomplete is exposed to
 * the picker.
 */
bibleRouter.get(
  "/complete-versions",
  asyncHandler(async (_req, res) => {
    res.json(listCompleteVersions());
  }),
);

/** Totals for the home-page card: how many Bibles, in how many languages. */
bibleRouter.get(
  "/overview",
  asyncHandler(async (_req, res) => {
    res.json(bibleOverview());
  }),
);

/** A handful of well-known passages, for the rotating card on the home page. */
bibleRouter.get(
  "/spotlight",
  asyncHandler(async (req, res) => {
    const raw = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const limit = Number.parseInt(String(req.query.limit ?? "6"), 10);
    res.json(spotlightVerses(raw || undefined, Number.isFinite(limit) ? limit : 6));
  }),
);

// ─── Search ──────────────────────────────────────────────────────────────────

bibleRouter.get(
  "/search",
  asyncHandler(async (req, res) => {
    const term = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (!term) throw badRequest("Provide a search term with ?q=");
    const limit = Number.parseInt(String(req.query.limit ?? "50"), 10);
    const version = versionParam(req);
    res.json(searchVerses(version.id, term, Number.isFinite(limit) ? limit : 50));
  }),
);

// ─── Books ───────────────────────────────────────────────────────────────────

bibleRouter.get(
  "/books",
  asyncHandler(async (req, res) => {
    const version = versionParam(req);
    const testament = typeof req.query.testament === "string" ? req.query.testament : undefined;
    res.json(listBooks(version.id, testament));
  }),
);

bibleRouter.get(
  "/books/:book",
  validateParams(z.object({ book: idSchema })),
  asyncHandler(async (req, res) => {
    const version = versionParam(req);
    res.json(findBook(version.id, param(req, "book")));
  }),
);

// ─── Chapters & verses ───────────────────────────────────────────────────────

bibleRouter.get(
  "/chapters",
  asyncHandler(async (req, res) => {
    const book = typeof req.query.book === "string" ? req.query.book : undefined;
    if (!book) throw badRequest("Provide a book with ?book=");
    const version = versionParam(req);
    res.json(listChapterNumbers(version.id, book));
  }),
);

bibleRouter.get(
  "/chapters/:chapter",
  validateParams(z.object({ chapter: z.coerce.number().int().min(1).max(200) })),
  asyncHandler(async (req, res) => {
    const book = typeof req.query.book === "string" ? req.query.book : undefined;
    if (!book) throw badRequest("Provide a book with ?book=");
    const version = versionParam(req);
    res.json(listChapter(version.id, book, Number(req.params.chapter)));
  }),
);

bibleRouter.get(
  "/verses",
  asyncHandler(async (req, res) => {
    const reference = typeof req.query.reference === "string" ? req.query.reference : undefined;
    if (!reference) throw badRequest("Provide a reference with ?reference=John 3:16");
    const version = versionParam(req);
    res.json(findPassage(version.id, reference));
  }),
);

bibleRouter.get(
  "/passage/:reference",
  validateParams(z.object({ reference: z.string().trim().min(1).max(120) })),
  asyncHandler(async (req, res) => {
    const version = versionParam(req);
    res.json(findPassage(version.id, param(req, "reference")));
  }),
);

bibleRouter.get(
  "/versions-for/:book",
  validateParams(z.object({ book: idSchema })),
  asyncHandler(async (req, res) => {
    res.json(versionsForBook(param(req, "book")));
  }),
);

// ─── Bookmarks ───────────────────────────────────────────────────────────────

bibleRouter.get(
  "/bookmarks",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(listBookmarks(req.auth!.id));
  }),
);

bibleRouter.post(
  "/bookmarks",
  requireAuth,
  writeLimiter,
  validateBody(bookmarkInputSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(createBookmark(req.auth!.id, req.body));
  }),
);

bibleRouter.patch(
  "/bookmarks/:id",
  requireAuth,
  writeLimiter,
  validateParams(z.object({ id: idSchema })),
  validateBody(bookmarkInputSchema.partial().refine((value: object) => Object.keys(value).length > 0, { message: "Provide at least one field to update" })),
  asyncHandler(async (req, res) => {
    res.json(updateBookmark(req.auth!.id, param(req, "id"), req.body));
  }),
);

bibleRouter.delete(
  "/bookmarks/:id",
  requireAuth,
  writeLimiter,
  validateParams(z.object({ id: idSchema })),
  asyncHandler(async (req, res) => {
    deleteBookmark(req.auth!.id, param(req, "id"));
    res.status(204).end();
  }),
);


bibleRouter.get("/helloao/translations", asyncHandler(async (_req, res) => {
  res.json({ translations: await fetchTranslations() });
}));

bibleRouter.get("/helloao/books/:translation", asyncHandler(async (req, res) => {
  const { translation } = req.params;
  res.json(await fetchBooks(translation as string));
}));

bibleRouter.get("/helloao/chapter/:translation/:book/:chapter", asyncHandler(async (req, res) => {
  const { translation, book, chapter } = req.params;
  res.json(await fetchChapter(translation as string, book as string, Number(req.params.chapter as string)));
}));

bibleRouter.get("/helloao/commentaries", asyncHandler(async (_req, res) => {
  res.json(await fetchCommentaries());
}));

bibleRouter.get("/helloao/commentary/:commentary/books", asyncHandler(async (req, res) => {
  res.json(await fetchCommentaryBooks(req.params.commentary as string));
}));

bibleRouter.get("/helloao/commentary/:commentary/:book/:chapter", asyncHandler(async (req, res) => {
  const { commentary, book, chapter } = req.params;
  res.json(await fetchCommentaryChapter(commentary as string, book as string, Number(req.params.chapter as string)));
}));

bibleRouter.get("/helloao/datasets", asyncHandler(async (_req, res) => {
  res.json(await fetchDatasets());
}));

bibleRouter.get("/helloao/dataset/:dataset/books", asyncHandler(async (req, res) => {
  res.json(await fetchDatasetBooks(req.params.dataset as string));
}));

bibleRouter.get("/helloao/dataset/:dataset/:book/:chapter", asyncHandler(async (req, res) => {
  const { dataset, book, chapter } = req.params;
  res.json(await fetchDatasetChapter(dataset as string, book as string, Number(req.params.chapter as string)));
}));
