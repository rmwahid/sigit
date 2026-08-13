// Validation and timing constants (mirrors backend limits + token expiry).
// tests/constants-sync.test.ts enforces parity for MIN_PASSWORD_LENGTH and
// TOKEN_MAX_EXPIRY_DAYS.
export const MIN_PASSWORD_LENGTH = 8;

export const TOKEN_MIN_EXPIRY_DAYS = 1;
export const TOKEN_MAX_EXPIRY_DAYS = 30;
export const TOKEN_DEFAULT_EXPIRY_DAYS = 30;

// Copy button feedback timeout (ms).
export const COPY_FEEDBACK_MS = 1500;
