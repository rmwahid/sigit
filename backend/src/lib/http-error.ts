import type { Context } from "hono";

export class HttpError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}

export function badRequest(message: string, code = "BAD_REQUEST"): HttpError {
  return new HttpError(400, code, message);
}

export function unauthorized(message = "Unauthorized", code = "UNAUTHORIZED"): HttpError {
  return new HttpError(401, code, message);
}

export function notFound(message = "Not found", code = "NOT_FOUND"): HttpError {
  return new HttpError(404, code, message);
}

export function internalError(message = "Internal server error", code = "INTERNAL_ERROR"): HttpError {
  return new HttpError(500, code, message);
}

export function errorResponse(c: Context, err: Error): Response {
  if (err instanceof HttpError) {
    return c.json({ error: { code: err.code, message: err.message } }, err.status);
  }
  const msg = process.env.NODE_ENV === "production" ? "Internal server error" : err.message;
  return c.json({ error: { code: "INTERNAL_ERROR", message: msg } }, 500);
}
