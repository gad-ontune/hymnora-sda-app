import { Router } from "express";
import type { Request } from "express";
import { z } from "zod";
import { asyncHandler } from "../../lib/async.ts";
import { validateBody, validateParams, param, idSchema } from "../../lib/validate.ts";
import { requireEditor } from "../../middleware/auth.ts";
import { writeLimiter } from "../../middleware/rate-limit.ts";

export type CrudOptions<TCreate extends z.ZodType, TUpdate extends z.ZodType> = {
  router: Router;
  /** Collection path the write routes are mounted on, e.g. `/` or `/:churchId/services`. */
  path: string;
  createSchema: TCreate;
  updateSchema: TUpdate;
  create: (input: z.output<TCreate>, req: Request) => unknown;
  update: (id: string, input: z.output<TUpdate>, req: Request) => unknown;
  remove: (id: string) => void;
  restore?: (id: string) => void;
};

/**
 * Attaches the standard editor-only write routes to a router.
 *
 * Read routes are deliberately left to each module: every resource has its own
 * filters, projections and personalisation, while create/update/publish/delete
 * are uniform enough to share.
 */
export function attachCrud<TCreate extends z.ZodType, TUpdate extends z.ZodType>(options: CrudOptions<TCreate, TUpdate>): void {
  const { router, path, createSchema, updateSchema, create, update, remove, restore } = options;
  const paramsSchema = z.object({ id: idSchema });

  router.post(
    path,
    requireEditor,
    writeLimiter,
    validateBody(createSchema),
    asyncHandler(async (req, res) => {
      res.status(201).json(create(req.body, req));
    }),
  );

  router.patch(
    `${path}/:id`,
    requireEditor,
    writeLimiter,
    validateParams(paramsSchema),
    validateBody(updateSchema),
    asyncHandler(async (req, res) => {
      res.json(update(param(req, "id"), req.body, req));
    }),
  );

  router.delete(
    `${path}/:id`,
    requireEditor,
    writeLimiter,
    validateParams(paramsSchema),
    asyncHandler(async (req, res) => {
      remove(param(req, "id"));
      res.status(204).end();
    }),
  );

  if (restore) {
    router.post(
      `${path}/:id/restore`,
      requireEditor,
      writeLimiter,
      validateParams(paramsSchema),
      asyncHandler(async (req, res) => {
        const id = param(req, "id");
        restore(id);
        res.json({ restored: true, id });
      }),
    );
  }
}

/** Convenience: a schema that accepts any subset of a create schema. */
export function partialOf<T extends z.ZodObject<z.ZodRawShape>>(schema: T) {
  return schema.partial().refine((value: object) => Object.keys(value).length > 0, {
    message: "Provide at least one field to update",
  });
}
