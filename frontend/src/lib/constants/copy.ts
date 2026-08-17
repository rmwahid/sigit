// User-facing copy and placeholders - single source of truth for repeated UI text.
import { MIN_PASSWORD_LENGTH, TOKEN_MAX_EXPIRY_DAYS } from "./validation";

export const COPY = {
  SETTINGS_TOKENS_LINK: "Settings → Tokens",
  TOKEN_SHOWN_ONCE: "the token is only shown once when created",
  TOKEN_PASSWORD_HINT: "Username is free-form, password = git token",
  LFS_THRESHOLD_HINT: "Files larger than {size} MB are automatically handled by LFS; the patterns above match the server configuration.",
  NO_TOKEN_ACCESS: "No token can access this project yet",
  NO_ACCESS_BADGE: "no access",
  DAYS_MAX_LABEL: `days (max ${TOKEN_MAX_EXPIRY_DAYS})`,
  PASSWORD_MIN_ERROR: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
  INVITE_LINK_COPIED: "Invite link copied",
  EMAIL_NOT_CONFIGURED: "Email is not configured - share this invite link manually:",
  ACTIVITY_SUMMARY: "{count} commits in {year}",
  ACTIVITY_COMMITS_ON_DAY: "{count} commits on {date}",
  ACTIVITY_NO_COMMITS: "No commits on {date}",
  ACTIVITY_LESS: "Less",
  ACTIVITY_MORE: "More",
} as const;

export const PLACEHOLDERS = {
  TOKEN_NAME: "Token name (e.g. laptop-kerja)",
  INVITE_EMAIL: "teammate@example.com",
  RESEND_API_KEY: "re_...",
  EMAIL_FROM: "SiGit <no-reply@example.com>",
  TEMP_PASSWORD: `New temporary password (min ${MIN_PASSWORD_LENGTH})`,
} as const;
