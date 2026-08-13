import { ERROR_CODES } from "../constants/errors";
import { env } from "../config/env";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export class HttpError extends Error {
  status: ContentfulStatusCode;
  code: string;

  constructor(status: ContentfulStatusCode, code: string, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}

export function errorResponse(c: Context, err: Error): Response {
  if (err instanceof HttpError) {
    return c.json({ error: { code: err.code, message: err.message } }, err.status);
  }
  const msg = env.NODE_ENV === "production" ? "Internal server error" : err.message;
  return c.json({ error: { code: ERROR_CODES.INTERNAL_ERROR, message: msg } }, 500);
}
