import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";

// Contract guard for the JSON request bodies declared in src/routes.
// @hono/zod-openapi installs the json validator only when request.body.required
// is set. Without the flag it installs a wrapper that hands the handler
// c.req.valid("json") === {} whenever the Content-Type is absent or is not JSON,
// so the schema (required fields, min lengths, enums, patterns) never runs and
// the handler executes on undefined values. The flag is what makes the declared
// contract binding, so every JSON body spec has to carry it.
const routesDir = path.join(import.meta.dir, "..", "src", "routes");

// Matches a body spec whose content is declared as JSON, with or without the
// required flag in between.
const JSON_BODY = /body:\s*\{[\s\S]{0,80}?content:\s*\{\s*"application\/json"/g;
// The same spec with nothing between the braces but whitespace, i.e. no flag.
const MISSING_REQUIRED = /body:\s*\{\s*content:/g;

function routeSources(): { name: string; source: string }[] {
  return fs
    .readdirSync(routesDir)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => ({ name, source: fs.readFileSync(path.join(routesDir, name), "utf8") }));
}

describe("JSON request bodies", () => {
  it("declares every JSON body as required", () => {
    const offenders: string[] = [];
    let specs = 0;
    for (const { name, source } of routeSources()) {
      specs += (source.match(JSON_BODY) ?? []).length;
      for (const match of source.matchAll(MISSING_REQUIRED)) {
        const line = source.slice(0, match.index).split("\n").length;
        offenders.push(`${name}:${line}`);
      }
    }
    expect(offenders).toEqual([]);
    // Floor so a rename that stops the patterns matching cannot pass silently.
    expect(specs).toBeGreaterThanOrEqual(20);
  });
});
