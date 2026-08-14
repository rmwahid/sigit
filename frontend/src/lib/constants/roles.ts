// Role constants - mirrors backend src/constants/roles.ts (Pralumex style:
// named entries with slug + name). tests/constants-sync.test.ts enforces parity.
export const ROLES = {
  ADMIN: { slug: "admin", name: "Admin" },
  COLLABORATOR: { slug: "collaborator", name: "Collaborator" },
} as const;

export const ADMIN_ROLE = ROLES.ADMIN.slug;
export const DEFAULT_ROLE = ROLES.COLLABORATOR.slug;

export type UserRole = (typeof ROLES)[keyof typeof ROLES]["slug"];

export function roleName(role: string): string {
  const found = Object.values(ROLES).find((r) => r.slug === role);
  return found?.name ?? role;
}
