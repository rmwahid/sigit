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

// LFS object size cap. Matches what the server can actually receive: Bun.serve
// refuses a request body above its own default ceiling (128 MiB) before any
// route runs, so the previous 2 GiB advertised a size that could never arrive
// while letting the download path serve an object that costs ~6x its size in
// memory. The PUT route rejects larger bodies, the batch builder omits the
// upload action, and the download route refuses to serve an object above it.
// Raising this value requires raising the runtime body limit AND the container
// memory limit in compose.yaml together.
export const MAX_LFS_OBJECT_BYTES = 128 * 1024 * 1024;

// LFS batch request: max objects per batch (spec-ish sanity cap).
export const MAX_LFS_BATCH_OBJECTS = 1000;

// LFS patterns: comma separated gitattributes-style globs. The value is rendered
// as a `git lfs track "<pattern>"` line in the project page's copy-paste setup
// block (frontend/src/lib/snippet.ts), so only characters that carry no shell
// meaning are accepted here; quoting alone would not contain a closing quote, a
// newline, `;`, `$( )`, a backtick or a history expansion. A pattern starts with
// a non-space character and may contain spaces after it, so a path with a space
// in it still works.
export const LFS_PATTERN_MAX_LENGTH = 200;
export const LFS_PATTERN_ELEMENT = "[A-Za-z0-9*._/-][A-Za-z0-9 *._/-]*";
export const LFS_PATTERN_PATTERN = `^${LFS_PATTERN_ELEMENT}( *, *${LFS_PATTERN_ELEMENT})*$`;

// Branch names (git check-ref-format --branch is the final authority at
// create time; this pre-filter is mirrored by the frontend for parity).
export const BRANCH_NAME_MAX_LENGTH = 200;
export const BRANCH_NAME_PATTERN = "^[A-Za-z0-9][A-Za-z0-9._/-]*$";

// Longest a git http-backend child may live (modules/git/server.ts). It is a
// backstop, not a policy: a legitimate clone of a large repository over a slow
// link is a long transfer, so the value only has to bound a child that would
// otherwise live until the process restarts.
export const GIT_CHILD_MAX_LIFETIME_MS = 30 * 60 * 1000;

// Projects one token may be scoped to. Every item is resolved against the
// database when the token is created, so the array length must not be
// caller-controlled; the UI selects a handful.
export const MAX_TOKEN_PROJECTS = 100;

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

// Read budgets for the unauthenticated browser routes. Each request spawns a git
// process and the archive route also builds and buffers the whole repository
// archive, so neither may be replayed without bound on a public project.
export const RATE_LIMIT_ARCHIVE_MAX = 10;
export const RATE_LIMIT_HISTORY_MAX = 120;
// The public profile activity endpoint spawns one git log per public project on
// every request, so it needs a request budget AND a cap on how many repositories
// a single request may scan (the cost otherwise grows with the whole install).
export const RATE_LIMIT_PUBLIC_ACTIVITY_MAX = 30;
export const MAX_ACTIVITY_PROJECTS = 25;

// Request-body caps. A body must be bounded BEFORE it is buffered and parsed,
// because the runtime default (~128 MiB) otherwise lets an anonymous caller make
// the shared process allocate a few hundred megabytes per request.
// Auth bodies carry an email, a password and an invite token: a few KB is ample.
export const MAX_AUTH_BODY_BYTES = 16 * 1024;
// LFS JSON bodies (batch / verify): a full batch of 1000 objects is ~110 KB.
export const MAX_LFS_REQUEST_BYTES = 1024 * 1024;

// Stored-object read cap for the per-push backup bundle. The bundle holds the
// whole repository history in one object, so it is the largest thing the server
// ever pulls into memory: the read path holds the ciphertext, the decrypted
// plaintext and the decrypt buffer (about three copies), and the write path
// peaks near seven times the bundle size. 256 MiB keeps one restore read around
// 768 MiB and leaves room for concurrent work under the 2g container limit;
// raise this only together with mem_limit in compose.yaml.
export const MAX_BACKUP_BUNDLE_BYTES = 256 * 1024 * 1024;

// Outbound storage request bounds. The storage endpoint is user input (the
// project's connection row), so a slow or hostile destination must not be able
// to hold a request open indefinitely: the deadline converts a stall into a
// failed operation and the socket cap bounds how many run at once.
export const STORAGE_REQUEST_TIMEOUT_MS = 30_000;
export const STORAGE_CONNECTION_TIMEOUT_MS = 5_000;
export const STORAGE_MAX_SOCKETS = 16;

// How many LFS object transfers one backend process may hold at once. Each
// admitted transfer keeps several copies of its payload (the received body, the
// concatenated buffer, and the ciphertext) until its storage request settles, so
// without this bound a handful of concurrent uploads or downloads crosses the
// container memory limit. Downloads count against the same gate as uploads
// because both buffer the object in the shared process.
export const MAX_LFS_CONCURRENT_TRANSFERS = 4;

// Login attempts are bounded twice: per account (whatever address asks) and per
// client address (whatever account is asked). The account budget is the one a
// successful login clears, so a mistyping owner is forgiven while a valid account
// cannot buy guesses against anybody else; the address budget is never cleared
// and only stops one address from spraying many accounts.
export const RATE_LIMIT_LOGIN_ADDRESS_MAX = 50;
// Buckets kept in the in-process rate limiter. Every distinct identity creates
// one entry, so the map needs a ceiling of its own: past it, expired entries are
// swept first and then the entry closest to expiring is dropped.
export const MAX_RATE_LIMIT_BUCKETS = 10000;

// Concurrent archive generations one backend process may run. An archive is
// built and buffered by git (up to execGit's 32 MiB output cap per generation),
// so the request budget alone let several of them run at once and hold their
// archives together in memory.
export const MAX_CONCURRENT_ARCHIVES = 4;
// Largest diff payload a read route will hand to the client. A diff is rendered
// synchronously by the browser, so an unbounded one costs the opening user a
// frozen tab and the server a buffered response; past the cap the diff is
// truncated and marked rather than delivered whole.
export const MAX_DIFF_BYTES = 4 * 1024 * 1024;
