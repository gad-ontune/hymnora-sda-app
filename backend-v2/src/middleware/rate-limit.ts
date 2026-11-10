import rateLimit, { ipKeyGenerator, type Options } from "express-rate-limit";
import type { Request, Response } from "express";
import { env } from "../config/env.ts";

function respond(_req: Request, res: Response): void {
  res.status(429).json({
    error: {
      code: "rate_limited",
      message: "Too many requests — please slow down and try again shortly",
    },
  });
}

const shared: Partial<Options> = {
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: respond,
};

/** Broad limiter applied to the whole API surface. */
export const apiLimiter = rateLimit({
  ...shared,
  windowMs: env.rateLimitWindowMs,
  limit: env.rateLimitMax,
});

/** Tighter limiter for credential endpoints, keyed by IP + submitted email. */
export const authLimiter = rateLimit({
  ...shared,
  windowMs: env.rateLimitWindowMs,
  limit: env.authRateLimitMax,
  skipSuccessfulRequests: true,
  keyGenerator: (req: Request) => {
    const email = typeof req.body?.email === "string" ? req.body.email.toLowerCase().trim() : "";
    return `${ipKeyGenerator(req.ip ?? "unknown")}:${email}`;
  },
});

/** Write limiter for authenticated mutations. */
export const writeLimiter = rateLimit({
  ...shared,
  windowMs: 60_000,
  limit: 60,
  keyGenerator: (req: Request) => req.auth?.id ?? ipKeyGenerator(req.ip ?? "unknown"),
});
