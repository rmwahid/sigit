// Domain limits and sizing rules. Single source of truth.
export const MIN_PASSWORD_LENGTH = 8;
export const DEFAULT_LOG_LIMIT = 200;
export const DEFAULT_HISTORY_LIMIT = 50;
export const MAX_HISTORY_LIMIT = 100;

// Invitation links stay valid for 24 hours.
export const INVITATION_TTL_HOURS = 24;

// File browser: max bytes served as text via the blob endpoint (1 MB).
export const MAX_FILE_BROWSER_BYTES = 1024 * 1024;

// git http-backend CGI header cap (bytes).
export const MAX_CGI_HEADER_BYTES = 64 * 1024;

// S3 DeleteObjects batch size (S3 API limit).
export const S3_DELETE_BATCH = 1000;

// Password hashing (argon2id).
export const PASSWORD_HASH_MEMORY_COST = 19456;
export const PASSWORD_HASH_TIME_COST = 2;

// Random byte counts.
export const RANDOM_TOKEN_BYTES = 24;
export const RANDOM_KEY_BYTES = 32;

// Token lifetime (days). MIN/MAX bound the create-token route and the FE
// settings input; DEFAULT is the FE default selection.
export const TOKEN_MIN_EXPIRY_DAYS = 1;
export const TOKEN_MAX_EXPIRY_DAYS = 30;
export const TOKEN_DEFAULT_EXPIRY_DAYS = 30;

// Token name cap (create-token route schema).
export const TOKEN_NAME_MAX_LENGTH = 100;

// Default LFS file threshold (10 MB): projects without a custom threshold.
// Lives in constants/limits.ts (not db/schema) because it is a domain rule.
export const DEFAULT_LFS_SIZE_THRESHOLD = 10 * 1024 * 1024;

// LFS object size cap (2 GiB): PUT route rejects larger bodies and the batch
// builder omits the upload action.
export const MAX_LFS_OBJECT_BYTES = 2 * 1024 * 1024 * 1024;

// LFS batch request: max objects per batch (spec-ish sanity cap).
export const MAX_LFS_BATCH_OBJECTS = 1000;

// Branch names (git check-ref-format --branch is the final authority at
// create time; this pre-filter is mirrored by the frontend for parity).
export const BRANCH_NAME_MAX_LENGTH = 200;
export const BRANCH_NAME_PATTERN = "^[A-Za-z0-9][A-Za-z0-9._/-]*$";
