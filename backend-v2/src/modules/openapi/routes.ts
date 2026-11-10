import { Router } from "express";
import { buildOpenApiDocument, operationCount } from "./document.ts";

export const openApiRouter: Router = Router();

/**
 * `GET /api/openapi.json` and `GET /api/openapi` — the machine-readable surface.
 *
 * Mounted at `/api/openapi` in `app.ts`, so the bare `/` here answers
 * `/api/openapi`; the `.json` variant lives under the same router because the
 * document advertises `/api/openapi.json` as one of its own paths.
 */
openApiRouter.get("/", (_req, res) => {
  const document = buildOpenApiDocument();
  res.set("Cache-Control", "public, max-age=300");
  res.json(document);
});

/** `GET /api/openapi.json` — the same document at the canonical `.json` URL. */
openApiRouter.get("/.json", (_req, res) => {
  const document = buildOpenApiDocument();
  res.set("Content-Type", "application/json");
  res.set("Cache-Control", "public, max-age=300");
  res.json(document);
});

openApiRouter.get("/document", (_req, res) => {
  res.set("Cache-Control", "public, max-age=300");
  res.json(buildOpenApiDocument());
});

/** Operation count, handy for smoke tests asserting the doc stays in step with the routers. */
openApiRouter.get("/count", (_req, res) => {
  res.json({ operations: operationCount });
});
