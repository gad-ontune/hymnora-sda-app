import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { env } from "../../config/env.ts";
import { asyncHandler } from "../../lib/async.ts";
import { validateBody } from "../../lib/validate.ts";
import { unauthorized, unprocessable } from "../../lib/errors.ts";
import { requireAuth } from "../../middleware/auth.ts";
import { authLimiter } from "../../middleware/rate-limit.ts";
import {
  authenticate,
  changePassword,
  getPreferences,
  listActiveSessions,
  preferencesSchema,
  registerSchema,
  registerUser,
  requestPasswordReset,
  resendVerification,
  resetPassword,
  revokeAllRefreshTokens,
  revokeRefreshToken,
  rotateRefreshToken,
  toUser,
  updatePreferences,
  userById,
  verifyEmail,
} from "./service.ts";

export const authRouter: Router = Router();

const REFRESH_COOKIE = "hymnora_refresh";
const ACCESS_COOKIE = "hymnora_token";

function requestMeta(req: Request): { userAgent?: string; ip?: string } {
  return { userAgent: req.headers["user-agent"], ip: req.ip };
}

function setAuthCookies(res: Response, tokens: { accessToken: string; refreshToken: string; accessTokenExpiresAt: string; refreshTokenExpiresAt: string }): void {
  const shared = { httpOnly: true, sameSite: "lax" as const, secure: env.cookieSecure, path: "/" };
  res.cookie(ACCESS_COOKIE, tokens.accessToken, { ...shared, maxAge: new Date(tokens.accessTokenExpiresAt).getTime() - Date.now() });
  res.cookie(REFRESH_COOKIE, tokens.refreshToken, { ...shared, maxAge: new Date(tokens.refreshTokenExpiresAt).getTime() - Date.now() });
}

function clearAuthCookies(res: Response): void {
  res.clearCookie(ACCESS_COOKIE, { path: "/" });
  res.clearCookie(REFRESH_COOKIE, { path: "/" });
}

authRouter.post(
  "/register",
  authLimiter,
  validateBody(registerSchema),
  asyncHandler(async (req, res) => {
    const result = await registerUser(req.body, requestMeta(req));
    setAuthCookies(res, result.tokens);
    res.status(201).json({
      user: result.user,
      tokens: result.tokens,
      // Returned only so local development can complete verification without a
      // mail transport. Strip this block before deploying.
      ...(env.isProduction ? {} : { verificationToken: result.verificationToken }),
    });
  }),
);

authRouter.post(
  "/login",
  authLimiter,
  validateBody(z.object({ email: z.email().max(180), password: z.string().min(1).max(200) })),
  asyncHandler(async (req, res) => {
    const result = await authenticate(req.body.email, req.body.password, requestMeta(req));
    setAuthCookies(res, result.tokens);
    res.json(result);
  }),
);

authRouter.post(
  "/refresh",
  asyncHandler(async (req, res) => {
    const token = req.body?.refreshToken ?? (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
    if (!token) throw unprocessable("No refresh token supplied");
    const result = rotateRefreshToken(String(token), requestMeta(req));
    setAuthCookies(res, result.tokens);
    res.json(result);
  }),
);

authRouter.post(
  "/logout",
  asyncHandler(async (req, res) => {
    const token = req.body?.refreshToken ?? (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
    if (token) revokeRefreshToken(String(token));
    clearAuthCookies(res);
    res.status(204).end();
  }),
);

authRouter.post(
  "/logout-all",
  requireAuth,
  asyncHandler(async (req, res) => {
    revokeAllRefreshTokens(req.auth!.id);
    clearAuthCookies(res);
    res.status(204).end();
  }),
);

authRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = userById(req.auth!.id);
    if (!user) throw unauthorized("Account no longer exists");
    res.json({ user: toUser(user), preferences: getPreferences(req.auth!.id), sessions: listActiveSessions(req.auth!.id) });
  }),
);

authRouter.post(
  "/verify-email",
  validateBody(z.object({ token: z.string().min(10).max(400) })),
  asyncHandler(async (req, res) => {
    res.json({ user: verifyEmail(req.body.token) });
  }),
);

authRouter.post(
  "/resend-verification",
  authLimiter,
  requireAuth,
  asyncHandler(async (req, res) => {
    const result = resendVerification(req.auth!.id);
    res.json({
      sent: result.sent,
      ...(result.reason ? { reason: result.reason } : {}),
      ...(result.token && !env.isProduction ? { verificationToken: result.token } : {}),
    });
  }),
);

authRouter.post(
  "/forgot-password",
  authLimiter,
  validateBody(z.object({ email: z.email().max(180) })),
  asyncHandler(async (req, res) => {
    const result = requestPasswordReset(req.body.email);
    res.json({
      // Always the same response so the endpoint cannot enumerate accounts.
      sent: true,
      ...(env.isProduction || !result.token ? {} : { resetToken: result.token }),
    });
  }),
);

authRouter.post(
  "/reset-password",
  authLimiter,
  validateBody(z.object({ token: z.string().min(10).max(400), password: z.string().min(8).max(200) })),
  asyncHandler(async (req, res) => {
    await resetPassword(req.body.token, req.body.password);
    clearAuthCookies(res);
    res.json({ reset: true });
  }),
);

authRouter.post(
  "/change-password",
  requireAuth,
  authLimiter,
  validateBody(z.object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().min(8).max(200) })),
  asyncHandler(async (req, res) => {
    await changePassword(req.auth!.id, req.body.currentPassword, req.body.newPassword);
    res.json({ changed: true });
  }),
);

authRouter.get(
  "/sessions",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(listActiveSessions(req.auth!.id));
  }),
);

authRouter.delete(
  "/sessions",
  requireAuth,
  asyncHandler(async (req, res) => {
    revokeAllRefreshTokens(req.auth!.id);
    clearAuthCookies(res);
    res.status(204).end();
  }),
);

authRouter.patch(
  "/preferences",
  requireAuth,
  validateBody(preferencesSchema),
  asyncHandler(async (req, res) => {
    res.json(updatePreferences(req.auth!.id, req.body));
  }),
);
