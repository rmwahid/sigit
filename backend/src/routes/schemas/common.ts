import { z } from "@hono/zod-openapi";

export const idParamSchema = z
  .object({ id: z.string().uuid().openapi({ example: "d096dd70-97bb-439e-b04b-646d958185dc" }) });

export const errorSchema = z
  .object({ error: z.string() })
  .openapi("Error");

export const messageSchema = z
  .object({ message: z.string() })
  .openapi("Message");

export const idResponseSchema = z
  .object({ id: z.string() })
  .openapi("IdResponse");

export const idResponse = z.object({ data: idResponseSchema });
