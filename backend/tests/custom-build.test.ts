import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  BUNDLE_TARGETS,
  buildMinimalPackageJson,
} from "@/cli/custom-build";

const backendRoot = path.resolve(import.meta.dir, "..");

describe("custom-build", () => {
  it("writes a minimal package.json without dependencies", () => {
    const json = JSON.parse(
      buildMinimalPackageJson({ name: "sigit-backend", version: "0.1.0" })
    );
    expect(json.scripts.start).toBe("bun dist/index.js");
    expect(json.scripts["db:migrate"]).toBe("bun dist/migrate.js");
    expect(json.scripts["db:create-admin"]).toBe("bun dist/create-admin.js");
    expect(json.scripts["db:reset-password"]).toBe("bun dist/reset-password.js");
    expect(json.scripts["db:reencrypt"]).toBe("bun dist/reencrypt-secrets.js");
    expect(json.dependencies).toBeUndefined();
    expect(json.devDependencies).toBeUndefined();
  });

  it("points at entry files that exist and are unique", () => {
    const outFiles = BUNDLE_TARGETS.map((t) => t.outFile);
    expect(new Set(outFiles).size).toBe(outFiles.length);
    for (const target of BUNDLE_TARGETS) {
      expect(existsSync(path.join(backendRoot, target.entry))).toBe(true);
    }
  });
});
