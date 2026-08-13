// Token scopes - mirrors backend src/constants/scopes.ts (Pralumex style).
// tests/constants-sync.test.ts enforces parity.
export const TOKEN_SCOPES = {
  READ: { slug: "read", name: "Read" },
  WRITE: { slug: "write", name: "Read + Write" },
} as const;

export type TokenScope = (typeof TOKEN_SCOPES)[keyof typeof TOKEN_SCOPES]["slug"];

export const DEFAULT_TOKEN_SCOPE: TokenScope = TOKEN_SCOPES.READ.slug;

// Scope options for the select: value = API value, label = user-facing name.
export const TOKEN_SCOPE_OPTIONS = Object.values(TOKEN_SCOPES).map((s) => ({
  value: s.slug,
  label: s.name,
}));

export function scopeLabel(scope: TokenScope): string {
  return TOKEN_SCOPES[scope.toUpperCase() as keyof typeof TOKEN_SCOPES]?.name ?? scope;
}
