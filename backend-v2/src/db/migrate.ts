import { env } from "../config/env.ts";
import { all, closeDatabase, exec, get, run, transaction } from "./client.ts";
import { migrations } from "./schema.ts";

const MIGRATIONS_TABLE = `
CREATE TABLE IF NOT EXISTS _migrations (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
`;

export type MigrationResult = {
  id: string;
  name: string;
  status: "applied" | "skipped";
};

export function pendingMigrations(): typeof migrations {
  exec(MIGRATIONS_TABLE);
  const applied = new Set(all<{ id: string }>("SELECT id FROM _migrations").map((row) => row.id));
  return migrations.filter((migration) => !applied.has(migration.id));
}

export function runMigrations(): MigrationResult[] {
  exec(MIGRATIONS_TABLE);
  const results: MigrationResult[] = [];
  for (const migration of pendingMigrations()) {
    transaction(() => {
      exec(migration.sql);
      run("INSERT INTO _migrations (id, name) VALUES (?, ?)", [migration.id, migration.name]);
    });
    results.push({ id: migration.id, name: migration.name, status: "applied" });
  }
  return results;
}

export function migrationStatus(): { applied: number; pending: number; total: number } {
  exec(MIGRATIONS_TABLE);
  const row = get<{ total: number }>("SELECT COUNT(*) AS total FROM _migrations");
  return {
    applied: Number(row?.total ?? 0),
    pending: pendingMigrations().length,
    total: migrations.length,
  };
}

const isDirectRun = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;

if (isDirectRun) {
  const results = runMigrations();
  if (results.length === 0) {
    console.log(`[migrate] database already up to date (${env.databaseFile})`);
  } else {
    for (const result of results) console.log(`[migrate] applied ${result.id}_${result.name}`);
  }
  console.log(`[migrate] done — ${env.databaseFile}`);
  closeDatabase();
}
