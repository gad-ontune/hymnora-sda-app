import { env } from "./config/env.ts";
import { closeDatabase } from "./db/client.ts";
import { runMigrations } from "./db/migrate.ts";
import { createApp } from "./app.ts";

/**
 * Applies pending migrations, boots the HTTP server, and shuts down cleanly.
 *
 * Running migrations here means `npm run dev` works against an empty checkout
 * without a separate setup step, while still honouring the versioned runner.
 */
function main(): void {
  const results = runMigrations();
  if (results.length > 0) {
    console.log(`[boot] applied ${results.length} migration(s): ${results.map((r) => r.id).join(", ")}`);
  }

  const app = createApp();
  const server = app.listen(env.port, env.host, () => {
    console.log(`[boot] hymnora-api listening on http://${env.host}:${env.port} (${env.nodeEnv})`);
    console.log(`[boot] database ${env.databaseFile}`);
    console.log(`[boot] cors ${env.corsOrigins.join(", ")}`);
  });

  const shutdown = (signal: string) => {
    console.log(`[shutdown] ${signal} received, closing server`);
    server.close(() => {
      closeDatabase();
      process.exit(0);
    });
    // Do not hang forever on lingering keep-alive sockets.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main();
