import { Router } from "express";
import { asyncHandler } from "../../lib/async.ts";
import { buildHomeDashboard, heroTrack } from "./service.ts";

export const homeRouter: Router = Router();

/**
 * `GET /api/home` — the whole home screen in one payload.
 *
 * Optional auth only: guests get a fully rendered page with default rails, and
 * signed-in members additionally get `continueListening` and a located greeting.
 */
homeRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    res.json(buildHomeDashboard(req.auth));
  }),
);

homeRouter.get(
  "/home",
  asyncHandler(async (req, res) => {
    res.json(buildHomeDashboard(req.auth));
  }),
);

/**
 * `GET /api/hero-track` — the single hero track for the landing banner.
 *
 * Kept as its own endpoint because the frontend's `getHeroTrack()` helper calls
 * it directly, and a page that only needs the banner should not pay for the
 * full dashboard assembly.
 */
homeRouter.get(
  "/hero-track",
  asyncHandler(async (_req, res) => {
    res.json(heroTrack());
  }),
);
