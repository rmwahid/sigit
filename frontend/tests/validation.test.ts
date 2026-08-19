import { describe, expect, it } from "vitest";
import {
  BRANCH_NAME_MAX_LENGTH,
  BRANCH_NAME_PATTERN,
  COPY_FEEDBACK_MS,
  MAX_FILE_BROWSER_BYTES,
  MIN_PASSWORD_LENGTH,
  TOKEN_DEFAULT_EXPIRY_DAYS,
  TOKEN_MAX_EXPIRY_DAYS,
  TOKEN_MIN_EXPIRY_DAYS,
} from "$lib/constants/validation";

// Frontend validation constants: the values the UI enforces before hitting
// the API. Constants-sync (backend) enforces parity for the shared ones.
describe("validation constants", () => {
  it("ships the password and token expiry limits", () => {
    expect(MIN_PASSWORD_LENGTH).toBe(8);
    expect(TOKEN_MIN_EXPIRY_DAYS).toBe(1);
    expect(TOKEN_MAX_EXPIRY_DAYS).toBe(30);
    expect(TOKEN_DEFAULT_EXPIRY_DAYS).toBe(30);
  });

  it("caps the file browser at 1 MiB and feedback at 1.5s", () => {
    expect(MAX_FILE_BROWSER_BYTES).toBe(1024 * 1024);
    expect(COPY_FEEDBACK_MS).toBe(1500);
  });

  it("defines the branch name rules mirrored from the backend", () => {
    expect(BRANCH_NAME_MAX_LENGTH).toBe(200);
    const re = new RegExp(BRANCH_NAME_PATTERN);
    expect(re.test("feature/api")).toBe(true);
    expect(re.test("release-1.2.3")).toBe(true);
    expect(re.test("-leading")).toBe(false);
    expect(re.test("trailing-")).toBe(true);
    // The raw pattern only checks character structure; the `..` rejection
    // lives in isValidBranchName (project-page.ts), tested in project-page.test.ts.
    expect(re.test("a..b")).toBe(true);
    expect(re.test("has space")).toBe(false);
    expect(re.test("")).toBe(false);
  });
});
