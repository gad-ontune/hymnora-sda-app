import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import cookieParser from "cookie-parser";
import { existsSync } from "node:fs";
import { env } from "./config/env.ts";
import { requestContext, requestLogger } from "./middleware/request-context.ts";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.ts";
import { apiLimiter } from "./middleware/rate-limit.ts";
import { optionalAuth } from "./middleware/auth.ts";
import { healthRouter } from "./modules/health/routes.ts";
import { authRouter } from "./modules/auth/routes.ts";
import { usersRouter } from "./modules/users/routes.ts";
import { tracksRouter } from "./modules/tracks/routes.ts";
import { musicRouter } from "./modules/music/routes.ts";
import { videoPageRouter } from "./modules/video/routes.ts";
import { albumsRouter, collectionsRouter, videosRouter } from "./modules/media/routes.ts";
import { hymnsRouter, hymnEditionsRouter } from "./modules/hymns/routes.ts";
import { bibleRouter } from "./modules/bible/routes.ts";
import { sermonsRouter, sermonSeriesRouter } from "./modules/sermons/routes.ts";
import { newsRouter } from "./modules/news/routes.ts";
import { churchesRouter } from "./modules/churches/routes.ts";
import { communityRouter } from "./modules/community/routes.ts";
import { reelsRouter } from "./modules/reels/routes.ts";
import { eventsRouter } from "./modules/events/routes.ts";
import { liveRouter } from "./modules/live/routes.ts";
import { searchRouter } from "./modules/search/routes.ts";
import { homeRouter } from "./modules/home/routes.ts";
import { libraryRouter } from "./modules/library/routes.ts";
import { adminRouter, newsletterRouter, preferencesRouter, uploadsRouter } from "./modules/admin/routes.ts";
import { pushRouter } from "./modules/push/routes.ts";
import { readingRouter } from "./modules/push/reading-routes.ts";
import { openApiRouter } from "./modules/openapi/routes.ts";

export function createApp() {
  const app = express();

  app.set("trust proxy", env.trustProxy);
  app.disable("x-powered-by");

  app.use(requestContext);
  if (!env.isTest) app.use(requestLogger);
  app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
  // A CORS rejection is invisible from the server: the response is a normal 200
  // that simply omits `Access-Control-Allow-Origin`, the browser throws it away,
  // and the symptom shows up in the frontend as data that "disappeared" — the
  // server-rendered HTML still worked, so it looked like a component bug rather
  // than a config one. This costs nothing and names the origin and the path.
  app.use((req, _res, next) => {
    const origin = req.headers.origin;
    if (origin && !env.corsOrigins.includes(origin)) {
      console.warn(
        `[cors] blocked ${req.method} ${req.path} from ${origin} — not in CORS_ORIGINS. ` +
          "Add it if the frontend is being served from there.",
      );
    }
    next();
  });
  app.use(cors({ origin: env.corsOrigins, credentials: true }));
  app.use(compression());
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true, limit: "1mb" }));
  app.use(cookieParser());

  // Uploaded media is served straight off disk. Registered before the API rate
  // limiter so fetching an image never consumes a request budget.
  if (existsSync(env.uploadDir)) {
    app.use("/uploads", express.static(env.uploadDir, { maxAge: "7d", fallthrough: true }));
  }

  app.use("/api", apiLimiter);

  app.use("/api/health", healthRouter);

  // `optionalAuth` runs once here so every route can read `req.auth` without
  // repeating the middleware, while individual routers still opt into stricter
  // guards via `requireAuth` / `requireEditor`.
  app.use("/api", optionalAuth);

  // Search and home are mounted first: they aggregate across every content
  // table, so they must not be shadowed by a `/api/<singular>` resource route.
  app.use("/api/search", searchRouter);
  app.use("/api", homeRouter);
  app.use("/api/openapi", openApiRouter);

  // Core media
  app.use("/api/tracks", tracksRouter);
  // The Spotify-shaped music page. Separate from `/api/tracks` because it
  // resolves bubbles, rows and the hero exclusion server-side — see
  // `modules/music/service.ts` for why the frontend cannot do it.
  app.use("/api/music", musicRouter);
  // The video page, which spans songs, sermons and live broadcasts. Mounted on
  // its own path because `/api/videos` is the legacy `kind = 'video'` view.
  app.use("/api/video", videoPageRouter);
  app.use("/api/albums", albumsRouter);
  app.use("/api/collections", collectionsRouter);
  app.use("/api/videos", videosRouter);

  // Scripture, worship and preaching
  app.use("/api/hymns", hymnsRouter);
  app.use("/api/hymn-editions", hymnEditionsRouter);
  app.use("/api/bible", bibleRouter);
  app.use("/api/sermons", sermonsRouter);
  app.use("/api/sermon-series", sermonSeriesRouter);

  // Community
  app.use("/api/news", newsRouter);
  app.use("/api/churches", churchesRouter);
  // The feed, and the follows/comments/links it reads. Mounted without a blanket
  // `requireAuth`: a reel is watched, and read, before anyone signs in.
  app.use("/api/reels", reelsRouter);
  app.use("/api", communityRouter);
  app.use("/api/events", eventsRouter);
  app.use("/api/live", liveRouter);

  // Account
  app.use("/api/auth", authRouter);
  app.use("/api/users", usersRouter);
  app.use("/api/library", libraryRouter);
  app.use("/api/preferences", preferencesRouter);
  app.use("/api/newsletter", newsletterRouter);
  app.use("/api/uploads", uploadsRouter);

  // Device-level reminders. `pushRouter` is mounted without a blanket
  // `requireAuth` because `/config` has to answer before sign-in — the Reminders
  // modal reports "not available on this device" rather than waiting on a
  // session it may not have.
  app.use("/api/push", pushRouter);
  app.use("/api/reading", readingRouter);
  app.use("/api/admin", adminRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
