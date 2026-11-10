import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../lib/async.ts";
import { validateParams, param, idSchema } from "../../lib/validate.ts";
import { responseFormat, sendList } from "../../lib/http.ts";
import { findStream, incrementViewers, listStreams, liveNow, streamFacets } from "./service.ts";

export const liveRouter: Router = Router();

/**
 * `GET /api/live` — all streams ordered by lifecycle (live → soon → upcoming →
 * replay). `?live=true` narrows to on-air streams, which the home page badge
 * and the push-notification scheduler both poll.
 */
liveRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { items, meta } = listStreams(req);
    sendList(res, items, meta, responseFormat(req));
  }),
);

/** Registered before `/:id` so "now" is never read as a stream id. */
liveRouter.get(
  "/now",
  asyncHandler(async (req, res) => {
    const requested = Number.parseInt(String(req.query.limit ?? "10"), 10);
    res.json(liveNow(Number.isFinite(requested) ? requested : 10));
  }),
);

liveRouter.get(
  "/facets",
  asyncHandler(async (_req, res) => {
    res.json(streamFacets());
  }),
);

liveRouter.get(
  "/:id",
  validateParams(z.object({ id: idSchema })),
  asyncHandler(async (req, res) => {
    res.json(findStream(param(req, "id")));
  }),
);

liveRouter.post(
  "/:id/viewers",
  validateParams(z.object({ id: idSchema })),
  asyncHandler(async (req, res) => {
    incrementViewers(param(req, "id"));
    res.status(202).json({ recorded: true });
  }),
);
