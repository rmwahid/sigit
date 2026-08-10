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

export function errorResponse(c: Context, err: Error): Response {
  if (err instanceof HttpError) {
    return c.json({ error: { code: err.code, message: err.message } }, err.status);
  }
  const msg = process.env.NODE_ENV === "production" ? "Internal server error" : err.message;
  return c.json({ error: { code: "INTERNAL_ERROR", message: msg } }, 500);
}
