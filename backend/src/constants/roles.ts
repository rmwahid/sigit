// Role constants - single source of truth (Pralumex style: named entries with slug + name).
// "Admin" = site owner (everything). "Collaborator" = regular user whose access
// comes from project_collaborators rows. The frontend mirrors this file in
// lib/constants/roles.ts and tests/constants-sync.test.ts enforces the match.
export const ROLES = {
  ADMIN: { slug: "admin", name: "Admin" },
  COLLABORATOR: { slug: "collaborator", name: "Collaborator" },
} as const;

export const ROLE_SLUGS = Object.values(ROLES).map((r) => r.slug) as [UserRole, ...UserRole[]];

export const ADMIN_ROLE = ROLES.ADMIN.slug;
export const DEFAULT_ROLE = ROLES.COLLABORATOR.slug;

export type UserRole = (typeof ROLES)[keyof typeof ROLES]["slug"];
