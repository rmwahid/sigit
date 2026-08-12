// Single source of truth for git token config in the UI.
// All scope/expiry rendering (Settings, project page) uses the constants and
// helpers here - do not write "read"/"write" strings, "read+write" labels, or
// expiry numbers manually. The backend mirrors TOKEN_MAX_EXPIRY_DAYS in
// modules/auth/tokens.ts (separate packages, cannot share imports).
import type { TokenScope } from "./api/tokens";

// Default scope when the user checks a new project in the token form.
export const DEFAULT_TOKEN_SCOPE: TokenScope = "read";

// Default & max lifetime in days, in sync with the backend (1-30).
export const DEFAULT_TOKEN_EXPIRY_DAYS = 30;
export const TOKEN_MAX_EXPIRY_DAYS = 30;

// "write" automatically includes "read" (push = clone/pull) - UI label is read+write.
export function scopeLabel(scope: TokenScope): string {
  return scope === "write" ? "read+write" : "read";
}

// Scope options for the select: value = API value, label = user-facing text.
export const TOKEN_SCOPE_OPTIONS: { value: TokenScope; label: string }[] = (
  ["read", "write"] as TokenScope[]
).map((value) => ({ value, label: scopeLabel(value) }));
