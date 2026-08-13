// Domain limits and sizing rules. Single source of truth.
export const MIN_PASSWORD_LENGTH = 8;
export const TOKEN_NAME_MAX_LENGTH = 100;
export const DEFAULT_LOG_LIMIT = 200;
export const DEFAULT_HISTORY_LIMIT = 50;

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
