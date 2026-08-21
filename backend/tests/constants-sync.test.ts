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
import { MAX_FILE_BROWSER_BYTES, MIN_PASSWORD_LENGTH, BRANCH_NAME_MAX_LENGTH, BRANCH_NAME_PATTERN, BRANCH_PATTERN_MAX_LENGTH, BRANCH_PATTERN_PATTERN, MAX_PROTECTION_REQUIRED_APPROVALS, DEFAULT_PROTECTION_RESTRICT_PUSH } from "@/constants/limits";
import { ARCHIVE_FORMATS } from "@/constants/protocol";
import { TOKEN_MAX_EXPIRY_DAYS } from "@/modules/auth/tokens";
import { PR_STATUSES, MERGE_METHODS, REVIEW_STATES, PR_TERMINAL_STATUSES, PR_MERGEABLE_STATUSES, PR_STATUS_BY_SLUG, PR_MERGEABLE_STATUS_BY_SLUG } from "@/constants/pull-requests";
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
  BRANCH_NAME_MAX_LENGTH as FE_BRANCH_NAME_MAX_LENGTH,
  BRANCH_NAME_PATTERN as FE_BRANCH_NAME_PATTERN,
  BRANCH_PATTERN_MAX_LENGTH as FE_BRANCH_PATTERN_MAX_LENGTH,
  BRANCH_PATTERN_PATTERN as FE_BRANCH_PATTERN_PATTERN,
  MAX_PROTECTION_REQUIRED_APPROVALS as FE_MAX_PROTECTION_REQUIRED_APPROVALS,
  DEFAULT_PROTECTION_RESTRICT_PUSH as FE_DEFAULT_PROTECTION_RESTRICT_PUSH,
} from "../../frontend/src/lib/constants/validation";
import { ARCHIVE_FORMATS as FE_ARCHIVE_FORMATS } from "../../frontend/src/lib/constants/protocol";
import {
  PR_STATUSES as FE_PR_STATUSES,
  MERGE_METHODS as FE_MERGE_METHODS,
  REVIEW_STATES as FE_REVIEW_STATES,
  PR_TERMINAL_STATUSES as FE_PR_TERMINAL_STATUSES,
  PR_MERGEABLE_STATUSES as FE_PR_MERGEABLE_STATUSES,
  PR_STATUS_BY_SLUG as FE_PR_STATUS_BY_SLUG,
  PR_MERGEABLE_STATUS_BY_SLUG as FE_PR_MERGEABLE_STATUS_BY_SLUG,
} from "../../frontend/src/lib/constants/pull-requests";
import { AUDIT_EVENTS as FE_AUDIT_EVENTS } from "../../frontend/src/lib/constants/audit-events";
import { AUDIT_EVENTS } from "@/constants/audit-events";

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
    expect(FE_BRANCH_NAME_MAX_LENGTH).toEqual(BRANCH_NAME_MAX_LENGTH);
    expect(FE_BRANCH_NAME_PATTERN).toEqual(BRANCH_NAME_PATTERN);
    expect(FE_BRANCH_PATTERN_MAX_LENGTH).toEqual(BRANCH_PATTERN_MAX_LENGTH);
    expect(FE_BRANCH_PATTERN_PATTERN).toEqual(BRANCH_PATTERN_PATTERN);
    expect(FE_MAX_PROTECTION_REQUIRED_APPROVALS).toEqual(MAX_PROTECTION_REQUIRED_APPROVALS);
    expect(FE_DEFAULT_PROTECTION_RESTRICT_PUSH).toEqual(DEFAULT_PROTECTION_RESTRICT_PUSH);
  });

  it("archive formats match exactly (slug + name)", () => {
    expect(FE_ARCHIVE_FORMATS).toEqual(ARCHIVE_FORMATS);
  });

  it("pull request constants match exactly (slug + name)", () => {
    expect(FE_PR_STATUSES).toEqual(PR_STATUSES);
    expect(FE_PR_TERMINAL_STATUSES).toEqual(PR_TERMINAL_STATUSES);
    expect(FE_MERGE_METHODS).toEqual(MERGE_METHODS);
    expect(FE_REVIEW_STATES).toEqual(REVIEW_STATES);
    expect(FE_PR_MERGEABLE_STATUSES).toEqual(PR_MERGEABLE_STATUSES);
    expect(FE_PR_STATUS_BY_SLUG).toEqual(PR_STATUS_BY_SLUG);
    expect(FE_PR_MERGEABLE_STATUS_BY_SLUG).toEqual(PR_MERGEABLE_STATUS_BY_SLUG);
  });

  it("audit events match exactly", () => {
    expect(FE_AUDIT_EVENTS).toEqual(AUDIT_EVENTS);
  });
});
