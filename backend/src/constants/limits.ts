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

// Branch protection: pattern that selects the branches a rule applies to.
// Wildcard is a trailing "*" (git refspec-style), e.g. "feature/*" or "*".
export const BRANCH_PATTERN_MAX_LENGTH = 200;
export const BRANCH_PATTERN_PATTERN = "^[A-Za-z0-9._/-]+(\\*)?$";
export const DEFAULT_PROTECTION_RESTRICT_PUSH = false;
export const MAX_PROTECTION_REQUIRED_APPROVALS = 10;

// Rate limiting (lib/rate-limit.ts): fixed window per client identity.
// Window is 15 minutes; each rule sets its own attempt budget.
export const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
// Login attempts per IP per window (argon2id makes each attempt expensive, so
// this is generous enough for a person mistyping and tight enough to stop
// scripted guessing).
export const RATE_LIMIT_LOGIN_MAX = 10;
// Invite acceptance per IP per window (public endpoint that creates an account).
export const RATE_LIMIT_INVITE_ACCEPT_MAX = 10;
// Password-verifying session endpoints (revoke-all, change-password): these
// need a valid session already, so the budget only guards password probing.
export const RATE_LIMIT_PASSWORD_MAX = 10;
// Git/LFS token auth per IP per window: git clients retry, and a legitimate
// clone can issue several requests, so the budget is higher than for login.
export const RATE_LIMIT_GIT_TOKEN_MAX = 100;

// Request-body caps. A body must be bounded BEFORE it is buffered and parsed,
// because the runtime default (~128 MiB) otherwise lets an anonymous caller make
// the shared process allocate a few hundred megabytes per request.
// Auth bodies carry an email, a password and an invite token: a few KB is ample.
export const MAX_AUTH_BODY_BYTES = 16 * 1024;
// LFS JSON bodies (batch / verify): a full batch of 1000 objects is ~110 KB.
export const MAX_LFS_REQUEST_BYTES = 1024 * 1024;
