import type { ErrorRequestHandler, RequestHandler } from "express";
import { AppError, notFound } from "../lib/errors.ts";
import { env } from "../config/env.ts";
import type { ApiErrorBody } from "../types/api.ts";

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(notFound(`Route ${req.method} ${req.path}`));
};

export const errorHandler: ErrorRequestHandler = (error, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  const requestId = req.requestId;
  const respond = (status: number, body: ApiErrorBody) => {
    res.status(status).json(body);
  };

  if (error instanceof AppError) {
    if (error.status >= 500) {
      console.error(`[${requestId ?? "-"}] ${req.method} ${req.originalUrl} -> ${error.status}`, error);
    }
    respond(error.status, {
      error: {
        code: error.code,
        message: error.message,
        ...(error.details === undefined ? {} : { details: error.details }),
        ...(requestId ? { requestId } : {}),
      },
    });
    return;
  }

  if (error instanceof SyntaxError && "body" in error) {
    respond(400, { error: { code: "invalid_json", message: "Request body is not valid JSON", requestId } });
    return;
  }

  if (error instanceof Error && "type" in error && error.type === "entity.too.large") {
    respond(413, { error: { code: "payload_too_large", message: "Request body is too large", requestId } });
    return;
  }

  console.error(`[${requestId ?? "-"}] ${req.method} ${req.originalUrl} -> 500`, error);

  if (!env.isProduction && error instanceof Error) {
    respond(500, {
      error: { code: "internal_error", message: error.message, details: error.stack, requestId },
    });
    return;
  }

  respond(500, { error: { code: "internal_error", message: "Something went wrong on our side", requestId } });
};
