import { describe, expect, it } from "bun:test";
import { env } from "../src/config/env";
import app from "../src/index";

describe("app info endpoint", () => {
  it("serves git base url publicly without auth", async () => {
    const res = await app.fetch(new Request("http://localhost/app-info"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { gitBaseUrl: string } };
    expect(body.data.gitBaseUrl).toBe(env.GIT_BASE_URL);
    expect(body.data.gitBaseUrl.length).toBeGreaterThan(0);
  });
});
