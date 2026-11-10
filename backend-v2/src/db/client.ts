import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { env } from "../config/env.ts";

export type SqlValue = string | number | bigint | null | Uint8Array;
export type Row = Record<string, SqlValue>;
export type Params = SqlValue[];

let database: DatabaseSync | null = null;

function open(): DatabaseSync {
  if (env.databaseFile !== ":memory:") {
    mkdirSync(dirname(env.databaseFile), { recursive: true });
  }
  const db = new DatabaseSync(env.databaseFile);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  // 16 KB pages rather than SQLite's 4 KB default. The Bible store holds
  // ~1.4 KB chapter blobs, so 4 KB pages waste roughly a quarter of every page
  // to fill; measured across 8,000 real chapters this brings the whole store
  // from 1.37x its payload down to 1.10x. It also means a chapter read pulls
  // four times as much useful data per page touched.
  //
  // Set before the schema runs, so new databases get it. SQLite ignores this on
  // a database that already has pages; an existing one has to drop out of WAL,
  // repeat the pragma and VACUUM to convert.
  db.exec("PRAGMA page_size = 16384");
  if (env.databaseFile !== ":memory:") {
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA synchronous = NORMAL");
  }
  return db;
}

/** Process-wide database handle. */
export function db(): DatabaseSync {
  database ??= open();
  return database;
}

export function closeDatabase(): void {
  database?.close();
  database = null;
}

export function exec(sql: string): void {
  db().exec(sql);
}

export function all<T = Row>(sql: string, params: Params = []): T[] {
  return db().prepare(sql).all(...params) as T[];
}

export function get<T = Row>(sql: string, params: Params = []): T | undefined {
  return db().prepare(sql).get(...params) as T | undefined;
}

export function run(sql: string, params: Params = []): { changes: number; lastInsertRowid: number } {
  const result = db().prepare(sql).run(...params);
  return {
    changes: Number(result.changes),
    lastInsertRowid: Number(result.lastInsertRowid),
  };
}

export function count(sql: string, params: Params = []): number {
  const row = get<{ total: number }>(sql, params);
  return Number(row?.total ?? 0);
}

export function pluck(sql: string, params: Params = []): SqlValue | undefined {
  const row = get<Row>(sql, params);
  if (!row) return undefined;
  const values = Object.values(row);
  return values[0];
}

let transactionDepth = 0;

/** Runs `fn` inside a transaction. Nested calls reuse the outer transaction. */
export function transaction<T>(fn: () => T): T {
  if (transactionDepth > 0) return fn();
  const handle = db();
  handle.exec("BEGIN");
  transactionDepth += 1;
  try {
    const result = fn();
    handle.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      handle.exec("ROLLBACK");
    } catch {
      // The transaction was already aborted by SQLite.
    }
    throw error;
  } finally {
    transactionDepth -= 1;
  }
}

/** Async variant of {@link transaction} for services that await before writing. */
export async function transactionAsync<T>(fn: () => Promise<T>): Promise<T> {
  if (transactionDepth > 0) return fn();
  const handle = db();
  handle.exec("BEGIN");
  transactionDepth += 1;
  try {
    const result = await fn();
    handle.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      handle.exec("ROLLBACK");
    } catch {
      // The transaction was already aborted by SQLite.
    }
    throw error;
  } finally {
    transactionDepth -= 1;
  }
}

/** True when the connected SQLite build supports FTS5 (used by search). */
let ftsSupport: boolean | null = null;
export function hasFts5(): boolean {
  if (ftsSupport !== null) return ftsSupport;
  try {
    const opts = db().prepare("PRAGMA compile_options").all() as { compile_options: string }[];
    ftsSupport = opts.some((o) => o.compile_options.includes("ENABLE_FTS5"));
  } catch {
    ftsSupport = false;
  }
  return ftsSupport;
}

/** Builds `(?, ?, ?)` placeholders for an IN clause. */
export function placeholders(count: number): string {
  return new Array(count).fill("?").join(", ");
}

/** Human-readable database target, safe to expose on the health endpoint. */
export function databaseFileLabel(): string {
  return env.databaseMemory ? ":memory:" : env.databaseFile;
}

export type DatabaseHealth = { ok: boolean; fts5: boolean; latencyMs: number; error?: string };

/** Cheap liveness probe used by `GET /api/health/ready`. */
export function healthSnapshot(): DatabaseHealth {
  const started = process.hrtime.bigint();
  try {
    const row = get<{ ok: number }>("SELECT 1 AS ok");
    const latencyMs = Number(process.hrtime.bigint() - started) / 1_000_000;
    return { ok: Number(row?.ok ?? 0) === 1, fts5: hasFts5(), latencyMs: Number(latencyMs.toFixed(3)) };
  } catch (error) {
    return {
      ok: false,
      fts5: false,
      latencyMs: 0,
      error: error instanceof Error ? error.message : "Unknown database error",
    };
  }
}
