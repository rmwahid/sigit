// Guards that the frontend constants stay in sync with the backend (single
// source of truth = backend src/constants/*). The frontend mirrors live in
// frontend/src/lib/constants/*:
//   roles        -> lib/constants/roles.ts
//   permissions  -> lib/constants/permissions.ts
//   scopes       -> lib/constants/scopes.ts
//   limits       -> lib/constants/validation.ts
import { describe, expect, it } from "bun:test";
import { ADMIN_ROLE, DEFAULT_ROLE, ROLES } from "../src/constants/roles";
import { ALL_PROJECT_PERMISSIONS, PROJECT_PERMISSIONS } from "../src/constants/permissions";
import { TOKEN_SCOPES } from "../src/constants/scopes";
import { MIN_PASSWORD_LENGTH } from "../src/constants/limits";
import { TOKEN_MAX_EXPIRY_DAYS } from "../src/modules/auth/tokens";
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
  MIN_PASSWORD_LENGTH as FE_MIN_PASSWORD_LENGTH,
  TOKEN_MAX_EXPIRY_DAYS as FE_TOKEN_MAX_EXPIRY_DAYS,
} from "../../frontend/src/lib/constants/validation";

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
  });
});
