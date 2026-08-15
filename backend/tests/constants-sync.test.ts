// Guards that the frontend constants stay in sync with the backend (single
// source of truth = backend src/constants/*). The frontend mirrors live in
// frontend/src/lib/constants/*:
//   roles        -> lib/constants/roles.ts
//   permissions  -> lib/constants/permissions.ts
//   scopes       -> lib/constants/scopes.ts
//   limits       -> lib/constants/validation.ts
//   protocol     -> lib/constants/protocol.ts
import { describe, expect, it } from "bun:test";
import { ADMIN_ROLE, DEFAULT_ROLE, ROLES } from "@/constants/roles";
import { ALL_PROJECT_PERMISSIONS, PROJECT_PERMISSIONS } from "@/constants/permissions";
import { TOKEN_SCOPES } from "@/constants/scopes";
import { MAX_FILE_BROWSER_BYTES, MIN_PASSWORD_LENGTH } from "@/constants/limits";
import { ARCHIVE_FORMATS } from "@/constants/protocol";
import { TOKEN_MAX_EXPIRY_DAYS } from "@/modules/auth/tokens";
import {
  ADMIN_ROLE as FE_ADMIN_ROLE,
  DEFAULT_ROLE as FE_DEFAULT_ROLE,
  ROLES as FE_ROLES,
} from "../../frontend/src/lib/constants/roles";
import {
  ALL_PROJECT_PERMISSIONS as FE_ALL_PERMISSIONS,
  PROJECT_PERMISSIONS as FE_PROJECT_PERMISSIONS,
} from "../../frontend/src/lib/constants/permissions";
import { TOKEN_SCOPES as FE_TOKEN_SCOPES } from "../../frontend/src/lib/constants/scopes";
import {
  MAX_FILE_BROWSER_BYTES as FE_MAX_FILE_BROWSER_BYTES,
  MIN_PASSWORD_LENGTH as FE_MIN_PASSWORD_LENGTH,
  TOKEN_MAX_EXPIRY_DAYS as FE_TOKEN_MAX_EXPIRY_DAYS,
} from "../../frontend/src/lib/constants/validation";
import { ARCHIVE_FORMATS as FE_ARCHIVE_FORMATS } from "../../frontend/src/lib/constants/protocol";

describe("frontend/backend constants sync", () => {
  it("roles match exactly (slug + name)", () => {
    expect(FE_ROLES).toEqual(ROLES);
    expect(FE_ADMIN_ROLE).toEqual(ADMIN_ROLE);
    expect(FE_DEFAULT_ROLE).toEqual(DEFAULT_ROLE);
  });

  it("project permissions match exactly (slug + name)", () => {
    expect(FE_PROJECT_PERMISSIONS).toEqual(PROJECT_PERMISSIONS);
    expect(FE_ALL_PERMISSIONS).toEqual(ALL_PROJECT_PERMISSIONS);
  });

  it("token scopes match exactly (slug + name)", () => {
    expect(FE_TOKEN_SCOPES).toEqual(TOKEN_SCOPES);
  });

  it("validation limits match exactly", () => {
    expect(FE_MIN_PASSWORD_LENGTH).toEqual(MIN_PASSWORD_LENGTH);
    expect(FE_TOKEN_MAX_EXPIRY_DAYS).toEqual(TOKEN_MAX_EXPIRY_DAYS);
    expect(FE_MAX_FILE_BROWSER_BYTES).toEqual(MAX_FILE_BROWSER_BYTES);
  });

  it("archive formats match exactly (slug + name)", () => {
    expect(FE_ARCHIVE_FORMATS).toEqual(ARCHIVE_FORMATS);
  });
});
