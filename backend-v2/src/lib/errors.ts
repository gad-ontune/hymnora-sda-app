/** Application error with an HTTP status and a stable machine-readable code. */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  readonly expose: boolean;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.expose = status < 500;
  }
}

export const badRequest = (message: string, details?: unknown) => new AppError(400, "bad_request", message, details);
export const validationFailed = (details: unknown) => new AppError(422, "validation_failed", "The request body failed validation", details);
export const unauthorized = (message = "Authentication required") => new AppError(401, "unauthorized", message);
export const forbidden = (message = "You do not have access to this resource") => new AppError(403, "forbidden", message);
export const notFound = (resource = "Resource") => new AppError(404, "not_found", `${resource} not found`);
export const conflict = (message: string, details?: unknown) => new AppError(409, "conflict", message, details);
export const unprocessable = (message: string, details?: unknown) => new AppError(422, "unprocessable", message, details);
export const tooManyRequests = (message = "Too many requests") => new AppError(429, "rate_limited", message);
export const internal = (message = "Something went wrong on our side") => new AppError(500, "internal_error", message);
