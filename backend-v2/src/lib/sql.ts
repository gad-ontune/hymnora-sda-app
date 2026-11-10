import type { Params, Row, SqlValue } from "../db/client.ts";
import { all, get } from "../db/client.ts";
import { likePattern } from "./validate.ts";

/** Accumulates `WHERE` fragments and their bind parameters safely. */
export class WhereBuilder {
  private readonly clauses: string[] = [];
  private readonly params: Params = [];

  add(fragment: string, ...params: Params): this {
    this.clauses.push(fragment);
    this.params.push(...params);
    return this;
  }

  /**
   * Adds a fragment only when `value` is neither undefined nor null.
   *
   * `params` is typed as `[T]` rather than `Params` so the value being tested
   * and the value being bound stay in lockstep — `where.addIf(filters.genre,
   * "t.genre = ?", filters.genre)` typechecks, while binding an unrelated
   * `undefined` is still rejected.
   */
  addIf<T extends SqlValue | undefined>(value: T, fragment: string, ...params: [T?]): this {
    if (value === undefined || value === null || value === "") return this;
    return this.add(fragment, ...(params as Params));
  }

  /**
   * Adds a fragment when a boolean condition holds, for filters where the
   * stored representation differs from the query value (e.g. `is_live = 1`).
   */
  addWhen(condition: boolean, fragment: string, ...params: Params): this {
    if (!condition) return this;
    return this.add(fragment, ...params);
  }

  /** Adds a `column IN (...)` filter, skipping empty lists. */
  addIn(column: string, values: readonly (string | number)[], placeholders: string): this {
    if (values.length === 0) {
      return this.add("1 = 0");
    }
    return this.add(`${column} IN (${placeholders})`, ...values);
  }

  /** Adds a case-insensitive `LIKE` filter across several columns. */
  addSearch(columns: string[], value: string | undefined): this {
    const term = value?.trim();
    if (!term) return this;
    const pattern = likePattern(term);
    this.clauses.push(`(${columns.map((column) => `${column} LIKE ? ESCAPE '\\'`).join(" OR ")})`);
    this.params.push(...columns.map(() => pattern));
    return this;
  }

  /** Standard soft-delete + publish-state filter. */
  addPublished(table: string, includeDrafts: boolean, statusColumn = "status"): this {
    this.clauses.push(`${table}.deleted_at IS NULL`);
    this.clauses.push(includeDrafts ? `1 = 1` : `${table}.${statusColumn} = 'published'`);
    return this;
  }

  /** Soft-delete + active-flag filter for tables (like `churches`) that use `is_active` instead of `status`. */
  addActive(table: string, includeDrafts: boolean): this {
    this.clauses.push(`${table}.deleted_at IS NULL`);
    this.clauses.push(includeDrafts ? `1 = 1` : `${table}.is_active = 1`);
    return this;
  }

  get sql(): string {
    return this.clauses.length > 0 ? this.clauses.join(" AND ") : "1 = 1";
  }

  get values(): Params {
    return this.params;
  }
}

export type Page<T> = { rows: T[]; total: number };

/**
 * Joins a column list into a `SELECT` prefix, tolerating a multi-line literal.
 *
 * Module services keep their column lists as readable template literals, which
 * start with a newline and trailing spaces. Interpolating one straight after
 * `SELECT` is fine, but omitting the keyword yields `"\n t.id, ..."` and SQLite
 * rejects it with a baffling `near "t": syntax error`. Centralising the
 * assembly here keeps that mistake impossible in new modules.
 */
export function selectList(columns: string): string {
  const list = splitTopLevel(
    columns
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .join(" "),
  )
    .map((part) => part.trim())
    .filter(Boolean)
    .join(", ");
  return `SELECT ${list}`;
}

/**
 * Splits on commas that are not inside parentheses or quotes.
 *
 * A plain `split(",")` mangles any computed column, because a distance
 * expression is full of its own commas: `pow(x, 2)`, `asin(sqrt(...))`. Those
 * get torn apart at every inner comma and SQLite then rejects the statement
 * with `near ","` — an error that points at the caller's SQL when the fault is
 * really in the helper every service shares. Splitting only at bracket depth
 * zero keeps a nested expression whole.
 */
function splitTopLevel(sql: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = "";
  for (const char of sql) {
    if (quote) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      current += char;
      continue;
    }
    if (char === "(") depth += 1;
    else if (char === ")") depth = Math.max(0, depth - 1);
    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts;
}

/** Runs a paginated `SELECT` and a matching `COUNT` with the same filter. */
export function paginate<T = Row>(options: {
  select: string;
  from: string;
  where: WhereBuilder;
  orderBy: string;
  limit: number;
  offset: number;
  countExpression?: string;
}): Page<T> {
  const { select, from, where, orderBy, limit, offset } = options;
  // Accept either a bare column list or a full `SELECT ...` and normalise both.
  const statement = select.trimStart().toLowerCase().startsWith("select") ? select.trim() : selectList(select);
  // The count reuses the same FROM/WHERE but scans as little as possible.
  // `countExpression` is a projection (`"1"`, `"DISTINCT x"`), not a statement.
  const projection = (options.countExpression ?? "1").trim().replace(/^select\s+/i, "");
  const totalRow = get<{ total: number }>(`SELECT COUNT(*) AS total FROM (SELECT ${projection} FROM ${from} WHERE ${where.sql})`, where.values);
  const total = Number(totalRow?.total ?? 0);
  const rows = all<T>(`${statement} FROM ${from} WHERE ${where.sql} ORDER BY ${orderBy} LIMIT ? OFFSET ?`, [
    ...where.values,
    limit,
    offset,
  ]);
  return { rows, total };
}

/** `ORDER BY` fragment with a whitelisted direction. */
export function orderBy(column: string, direction: "asc" | "desc" = "desc"): string {
  // A compound expression (multiple columns, or a `CASE`) already carries its own
  // per-column directions; appending a global one would be a syntax error.
  if (column.includes(",") || /\b(ASC|DESC)\b/i.test(column)) return column;
  return `${column} ${direction.toUpperCase()}`;
}

/** `CASE WHEN` priority list, used for pinning featured/hero content first. */
export function caseRank(column: string, rankedValues: string[], fallback = 0): string {
  const parts = rankedValues.map((value, index) => `WHEN '${value.replace(/'/g, "''")}' THEN ${index}`);
  return `CASE ${column} ${parts.join(" ")} ELSE ${fallback} END`;
}

/** Builds a `COALESCE`-safe projection list from a mapping. */
export function columns(map: Record<string, string>): string {
  return Object.entries(map)
    .map(([alias, expression]) => `${expression} AS ${alias}`)
    .join(", ");
}
