import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../lib/async.ts";
import { validateBody, validateParams, param, idSchema, slugSchema } from "../../lib/validate.ts";
import { responseFormat, sendList } from "../../lib/http.ts";
import { requireAuth } from "../../middleware/auth.ts";
import { writeLimiter } from "../../middleware/rate-limit.ts";
import { attachCrud } from "../admin/crud.ts";
import {
  createEvent,
  deleteEvent,
  eventFacets,
  eventInputSchema,
  eventPatchSchema,
  findEvent,
  incrementAttending,
  listEvents,
  listSavedEvents,
  restoreEvent,
  saveEvent,
  unsaveEvent,
  updateEvent,
} from "./service.ts";

export const eventsRouter: Router = Router();

/**
 * `GET /api/events` — bare `EventItem[]`, matching the frontend's `getEvents()`.
 * Upcoming events sort ascending; `?upcoming=false` includes past ones.
 */
eventsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { items, meta } = listEvents(req);
    sendList(res, items, meta, responseFormat(req));
  }),
);

eventsRouter.get(
  "/facets",
  asyncHandler(async (_req, res) => {
    res.json(eventFacets());
  }),
);

eventsRouter.get(
  "/saved",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(listSavedEvents(req.auth!.id));
  }),
);

eventsRouter.post(
  "/:idOrSlug/save",
  requireAuth,
  writeLimiter,
  validateParams(z.object({ idOrSlug: z.union([idSchema, slugSchema]) })),
  validateBody(z.object({ remindBeforeMinutes: z.number().int().min(0).max(10_080).default(60) })),
  asyncHandler(async (req, res) => {
    res.json(saveEvent(req.auth!.id, param(req, "idOrSlug"), req.body.remindBeforeMinutes));
  }),
);

eventsRouter.delete(
  "/:idOrSlug/save",
  requireAuth,
  writeLimiter,
  validateParams(z.object({ idOrSlug: z.union([idSchema, slugSchema]) })),
  asyncHandler(async (req, res) => {
    res.json(unsaveEvent(req.auth!.id, param(req, "idOrSlug")));
  }),
);

eventsRouter.post(
  "/:idOrSlug/attend",
  validateParams(z.object({ idOrSlug: z.union([idSchema, slugSchema]) })),
  asyncHandler(async (req, res) => {
    res.json(incrementAttending(param(req, "idOrSlug")));
  }),
);

eventsRouter.get(
  "/:idOrSlug",
  validateParams(z.object({ idOrSlug: z.union([idSchema, slugSchema]) })),
  asyncHandler(async (req, res) => {
    res.json(findEvent(param(req, "idOrSlug"), req.auth?.id ?? null));
  }),
);

attachCrud({
  router: eventsRouter,
  path: "/",
  createSchema: eventInputSchema,
  updateSchema: eventPatchSchema,
  create: (input, req) => createEvent(input, req.auth?.id ?? null),
  update: (id, input) => updateEvent(id, input),
  remove: deleteEvent,
  restore: restoreEvent,
});
