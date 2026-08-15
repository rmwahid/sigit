import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/config/db";
import { projectCollaborators, users } from "@/db/schema/auth";
import { ADMIN_ROLE } from "@/constants/roles";
import { TOKEN_SCOPES } from "@/constants/scopes";
import { projects, type Project } from "@/db/schema/projects";
// Project access rules (multi-user). Admin (site owner) bypasses everything;
// regular users get access through project_collaborators with a granular
// permission set. Permission DATA lives in constants/permissions.ts.
import {
  ALL_PROJECT_PERMISSIONS,
  IMPLIED_PERMISSIONS,
  PROJECT_PERMISSIONS,
  type ProjectPermission,
} from "@/constants/permissions";

export { ALL_PROJECT_PERMISSIONS, type ProjectPermission };

export function normalizePermissions(list: string[]): ProjectPermission[] {
  const set = new Set<ProjectPermission>();
  for (const p of list) {
    if (!ALL_PROJECT_PERMISSIONS.includes(p as ProjectPermission)) continue;
    set.add(p as ProjectPermission);
    for (const imp of IMPLIED_PERMISSIONS[p as ProjectPermission] ?? []) set.add(imp);
  }
  return [...set];
}

export function isSiteAdmin(user: { role: string }): boolean {
  return user.role === ADMIN_ROLE;
}

// Access for a user on a project: null = admin (all permissions), array =
// granted permissions, empty array = no access.
export async function getProjectAccess(
  userId: string,
  projectId: string
): Promise<ProjectPermission[] | null> {
  const user = await db.query.users.findFirst({ where: eq(users.id, userId), columns: { role: true } });
  if (user?.role === ADMIN_ROLE) return null;
  const row = await db.query.projectCollaborators.findFirst({
    where: and(eq(projectCollaborators.projectId, projectId), eq(projectCollaborators.userId, userId)),
    columns: { permissions: true },
  });
  return row ? normalizePermissions(row.permissions) : [];
}

// null access = admin: everything is allowed.
export function hasPermission(access: ProjectPermission[] | null, perm: ProjectPermission): boolean {
  return access === null || access.includes(perm);
}

export async function userCan(userId: string, projectId: string, perm: ProjectPermission): Promise<boolean> {
  return hasPermission(await getProjectAccess(userId, projectId), perm);
}

// Whether the user may create a token with the given scope on the project.
// Token permissions are DERIVED: they can never exceed the owner's access
// (read needs clone, write needs push).
export function tokenScopeForUser(
  access: ProjectPermission[] | null,
  scope: (typeof TOKEN_SCOPES)[keyof typeof TOKEN_SCOPES]["slug"]
): boolean {
  if (access === null) return true;
  return scope === TOKEN_SCOPES.READ.slug
    ? access.includes(PROJECT_PERMISSIONS.CLONE.slug)
    : access.includes(PROJECT_PERMISSIONS.PUSH.slug);
}

export async function listAccessibleProjects(userId: string): Promise<Project[]> {
  const user = await db.query.users.findFirst({ where: eq(users.id, userId), columns: { role: true } });
  if (user?.role === ADMIN_ROLE) return db.select().from(projects);
  const rows = await db
    .select({ projectId: projectCollaborators.projectId })
    .from(projectCollaborators)
    .where(eq(projectCollaborators.userId, userId));
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.projectId);
  return db.select().from(projects).where(inArray(projects.id, ids));
}

export async function listAccessibleProjectIds(userId: string): Promise<string[]> {
  const user = await db.query.users.findFirst({ where: eq(users.id, userId), columns: { role: true } });
  if (user?.role === ADMIN_ROLE) {
    const all = await db.select({ id: projects.id }).from(projects);
    return all.map((p) => p.id);
  }
  const rows = await db
    .select({ projectId: projectCollaborators.projectId })
    .from(projectCollaborators)
    .where(eq(projectCollaborators.userId, userId));
  return rows.map((r) => r.projectId);
}

// Public projects for the explore page (no auth needed).
export async function listPublicProjects(): Promise<Project[]> {
  return db.select().from(projects).where(eq(projects.isPublic, true));
}
