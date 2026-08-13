// Protocol-level constants (cookies, prefixes, content types, git plumbing).
// Single source of truth.
export const SESSION_COOKIE = "sigit_session";

export const COOKIE_ATTRIBUTES = {
  PATH: "Path=/",
  HTTP_ONLY: "HttpOnly",
  SAME_SITE_LAX: "SameSite=Lax",
  SECURE: "Secure",
} as const;

export const TOKEN_PREFIX = "sigit_";
export const INVITE_PREFIX = "sigit_invite_";
export const BASIC_AUTH_PREFIX = "Basic ";

export const CONTENT_TYPE_OCTET_STREAM = "application/octet-stream";
export const CONTENT_TYPE_LFS_JSON = "application/vnd.git-lfs+json";

export const GIT_RECEIVE_PACK = "git-receive-pack";
export const GIT_UPLOAD_PACK = "git-upload-pack";
export const GIT_HTTP_BACKEND = "http-backend";
export const GIT_ZERO_HASH = "0000000000000000000000000000000000000000";

export const BACKUP_FILENAME = "backup.bundle";
export const REMOTE_USER = "sigit";

// Wrapping key id default (ENCRYPTION_KEYS map).
export const DEFAULT_ENCRYPTION_KEY_ID = "v1";

// LFS pointer file format (version + oid/size lines).
export const LFS_POINTER_VERSION = "version https://git-lfs.github.com/spec/v1";
export const LFS_OID_LINE_PREFIX = "oid sha256:";
export const LFS_SIZE_LINE_PREFIX = "size ";

// Email delivery.
export const EMAIL_FROM_DEFAULT = "SiGit <onboarding@resend.dev>";
export const EMAIL_INVITE_SUBJECT = "You have been invited to SiGit";
