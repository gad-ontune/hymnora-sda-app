import { z } from "zod";
import type { NextFunction, Request, Response } from "express";
import { validationFailed, badRequest } from "./errors.ts";

export type Source = "body" | "query" | "params";

/** Flattens a Zod issue list into `{ "path.to.field": "message" }`. */
export function formatIssues(error: z.ZodError): Record<string, string> {
  const details: Record<string, string> = {};
  for (const issue of error.issues) {
    const path = issue.path.length > 0 ? issue.path.join(".") : "_";
    if (!(path in details)) details[path] = issue.message;
  }
  return details;
}

export function parseWith<T extends z.ZodType>(schema: T, value: unknown, source: Source = "body"): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw validationFailed({ source, issues: formatIssues(result.error) });
  }
  return result.data;
}

/**
 * Validates `req.body` and replaces it with the parsed (coerced, stripped) value.
 *
 * These return Express middleware: the parse runs, then `next()` continues the
 * chain. A validation failure throws synchronously, which Express 5 forwards to
 * the error handler. Forgetting `next()` would leave the request hanging.
 */
export function validateBody<T extends z.ZodType>(schema: T) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    req.body = parseWith(schema, req.body, "body");
    next();
  };
}

export function validateQuery<T extends z.ZodType>(schema: T) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    parseWith(schema, req.query, "query");
    next();
  };
}

export function validateParams<T extends z.ZodType>(schema: T) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    parseWith(schema, req.params, "params");
    next();
  };
}

/**
 * Reads a single route param as a string.
 *
 * Express 5 types `req.params[k]` as `string | string[]` because repeatable
 * params (`:name+`) are allowed, but every param in this API is a single
 * segment that has already passed `idSchema`/`slugSchema`. Narrowing here keeps
 * handlers free of casts and turns a malformed repeat into a 400 rather than a
 * silent `[... ]` leaking into SQL.
 */
export function param(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  throw badRequest(`Route parameter "${name}" is required`);
}

// ─── Reusable schema fragments ───────────────────────────────────────────────

export const idSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9._:-]+$/, "Only letters, numbers, dot, underscore, colon and dash are allowed");

export const slugSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Must be a lowercase slug");

export const booleanQuery = z
  .union([z.boolean(), z.string()])
  .transform((value) => (typeof value === "boolean" ? value : ["1", "true", "yes", "on"].includes(value.toLowerCase())));

export const optionalBooleanQuery = booleanQuery.optional();

export const csvQuery = z
  .union([z.string(), z.array(z.string())])
  .transform((value) => (Array.isArray(value) ? value : value.split(",")))
  .transform((items) => items.map((item) => item.trim()).filter(Boolean));

export const isoDateQuery = z
  .union([z.string(), z.date()])
  .transform((value) => (typeof value === "string" ? new Date(value) : value))
  .refine((value) => !Number.isNaN(value.getTime()), "Must be a valid ISO-8601 date");

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  page: z.coerce.number().int().min(1).optional(),
  sort: z.string().max(60).optional(),
  order: z.enum(["asc", "desc"]).default("desc"),
  q: z.string().trim().max(200).optional(),
  language: z.string().trim().max(40).optional(),
  format: z.string().trim().max(20).optional(),
  includeDrafts: optionalBooleanQuery,
});

/** Escapes a user supplied value for safe interpolation into a LIKE pattern. */
export function likePattern(value: string): string {
  return `%${value.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
}

/** Escapes a value for FTS5 MATCH (treats user input as a phrase-ish prefix query). */
export function ftsQuery(value: string): string {
  const tokens = value
    .replace(/["*(){}:^~[\]-]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .slice(0, 12);
  if (tokens.length === 0) return '""';
  return tokens.map((token) => `"${token}"*`).join(" ");
}
