import { Router } from "express";
import { env } from "../../config/env.ts";
import { migrationStatus } from "../../db/migrate.ts";
import { databaseFileLabel, healthSnapshot } from "../../db/client.ts";

export const healthRouter: Router = Router();

/** Liveness probe — never touches the database. */
healthRouter.get("/live", (_req, res) => {
  res.json({ status: "ok", service: "hymnora-api", version: env.nodeEnv });
});

/** Readiness probe — verifies the database answers and migrations are applied. */
healthRouter.get("/ready", (_req, res) => {
  try {
    const snapshot = healthSnapshot();
    const migrations = migrationStatus();
    const ready = snapshot.ok && migrations.pending === 0;
    res.status(ready ? 200 : 503).json({
      status: ready ? "ok" : "degraded",
      database: { ...snapshot, file: databaseFileLabel() },
      migrations,
    });
  } catch (error) {
    res.status(503).json({
      status: "degraded",
      error: error instanceof Error ? error.message : "Database check failed",
    });
  }
});

healthRouter.get("/", (_req, res) => {
  res.json({
    status: "ok",
    service: "hymnora-api",
    database: databaseFileLabel(),
  });
});
