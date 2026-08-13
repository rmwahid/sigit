// API route paths (mount points + route definitions). Single source of truth.
export const API_ROUTES = {
  ROOT: "/",
  APP_INFO: "/app-info",
  AUTH: "/auth",
  STORAGE: "/storage",
  PROJECTS: "/projects",
  ADMIN: "/admin",
  TOKENS: "/tokens",
  USERS: "/users",
  INVITATIONS: "/invitations",
  EMAIL_SETTINGS: "/email-settings",
} as const;

// requireAuth middleware scope prefixes.
export const AUTH_SCOPES = {
  STORAGE: "/storage/*",
  PROJECTS: "/projects/*",
  ADMIN: "/admin/*",
  TOKENS: "/tokens/*",
} as const;
