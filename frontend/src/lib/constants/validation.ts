// Validation and timing constants (mirrors backend limits + token expiry).
// tests/constants-sync.test.ts enforces parity for MIN_PASSWORD_LENGTH and
// TOKEN_MAX_EXPIRY_DAYS.
export const MIN_PASSWORD_LENGTH = 8;

// File browser cap: mirrors backend MAX_FILE_BROWSER_BYTES (blob endpoint).
export const MAX_FILE_BROWSER_BYTES = 1024 * 1024;

export const TOKEN_MIN_EXPIRY_DAYS = 1;
export const TOKEN_MAX_EXPIRY_DAYS = 30;
export const TOKEN_DEFAULT_EXPIRY_DAYS = 30;

// Copy button feedback timeout (ms).
export const COPY_FEEDBACK_MS = 1500;

// Branch names (mirrors backend limits.ts; routes/branches.ts enforces them,
// git check-ref-format remains the final authority at create time).
export const BRANCH_NAME_MAX_LENGTH = 200;
export const BRANCH_NAME_PATTERN = "^[A-Za-z0-9][A-Za-z0-9._/-]*$";

// Branch protection (mirrors backend limits.ts; constants-sync.test.ts).
export const BRANCH_PATTERN_MAX_LENGTH = 200;
export const BRANCH_PATTERN_PATTERN = "^[A-Za-z0-9._/-]+(\\*)?$";
export const MAX_PROTECTION_REQUIRED_APPROVALS = 10;
export const DEFAULT_PROTECTION_RESTRICT_PUSH = false;
