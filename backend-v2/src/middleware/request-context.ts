import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";

/** Tags every request with an id that is echoed in responses and error bodies. */
export const requestContext: RequestHandler = (req, res, next) => {
  const incoming = req.headers["x-request-id"];
  const requestId = typeof incoming === "string" && incoming.length <= 64 ? incoming : randomUUID();
  req.requestId = requestId;
  res.setHeader("X-Request-Id", requestId);
  next();
};

const COLOURS: Record<string, string> = {
  GET: "\u001b[32m",
  POST: "\u001b[36m",
  PUT: "\u001b[33m",
  PATCH: "\u001b[33m",
  DELETE: "\u001b[31m",
};

const RESET = "\u001b[0m";
const DIM = "\u001b[2m";

/** Compact one-line request logger. */
export const requestLogger: RequestHandler = (req, res, next) => {
  const start = process.hrtime.bigint();
  res.on("finish", () => {
    const ms = Number(process.hrtime.bigint() - start) / 1_000_000;
    const colour = COLOURS[req.method] ?? "";
    const status = res.statusCode >= 500 ? "\u001b[31m" : res.statusCode >= 400 ? "\u001b[33m" : "\u001b[32m";
    console.log(
      `${DIM}${new Date().toISOString()}${RESET} ${colour}${req.method.padEnd(6)}${RESET} ${status}${res.statusCode}${RESET} ${req.originalUrl} ${DIM}${ms.toFixed(1)}ms${RESET}`,
    );
  });
  next();
};
