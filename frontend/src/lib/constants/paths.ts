// API endpoint paths + app route paths + git snippet constants.
// Single source of truth for the frontend - api clients and page links use these.
export const API_BASE = "/api";

export const API_PATHS = {
  AUTH_BOOTSTRAP: "/auth/bootstrap",
  AUTH_ME: "/auth/me",
  AUTH_LOGIN: "/auth/login",
  AUTH_LOGOUT: "/auth/logout",
  AUTH_REVOKE_ALL: "/auth/revoke-all",
  AUTH_CHANGE_PASSWORD: "/auth/change-password",
  AUTH_INVITE: "/auth/invite",
  AUTH_INVITE_ACCEPT: "/auth/invite/accept",
  USERS: "/users",
  INVITATIONS: "/invitations",
  EMAIL_SETTINGS: "/email-settings",
  EMAIL_TEST: "/email-settings/test",
  PROJECTS: "/projects",
  PROJECTS_WITH_CONNECTION: "/projects/with-connection",
  TOKENS: "/tokens",
  STORAGE_CONNECTIONS: "/storage/connections",
  APP_INFO: "/app-info",
  ADMIN_LOGS: "/admin/logs",
  ADMIN_LOGS_STREAM: "/admin/logs/stream",
  EXPLORE: "/explore",
} as const;

export const APP_ROUTES = {
  ROOT: "/",
  LOGS: "/logs",
  SETTINGS: "/settings",
  INVITE: "/invite",
  EXPLORE: "/explore",
} as const;

// Public profile page URL (email is the route param).
export function userProfileHref(email: string): string {
  return `/users/${encodeURIComponent(email)}`;
}

// Git snippet constants.
export const GIT_REMOTE_NAME = "sigit";
export const DEFAULT_BRANCH = "main";
export const DEFAULT_GIT_BASE_URL = "http://localhost:3000";

// Theme localStorage key.
export const THEME_STORAGE_KEY = "sigit-theme";
