// Authorization for the storage connection a project is bound to. The binding
// is not just a data field: a connection row carries bucket-wide credentials
// and one raw key namespace, which is why every /storage/connections handler is
// admin only. Without a check here, any invited collaborator could create a
// project bound to the operator's connection and then write LFS objects and
// per-push backup bundles into the operator's bucket through the operator's
// decrypted credentials.
//
// storage_connections has no owner or creator column, so the strongest rule the
// model can express is: an admin may bind any connection, and a regular user
// may bind only a connection that already backs a project they can reach.
// POST /projects/with-connection creates the caller's own connection inline, so
// it needs no check. An unknown id fails closed rather than persisting a
// dangling reference.
import { eq } from "drizzle-orm";
import { db } from "@/config/db";
import { projects } from "@/db/schema/projects";
import { ERROR_CODES } from "@/constants/errors";
import { HttpError } from "@/lib/http-error";
import { isSiteAdmin, normalizePermissions } from "@/modules/auth/access";
import { projectCollaborators } from "@/db/schema/auth";
import { getConnection } from "@/modules/storage/connections";

const REFUSED = "You cannot bind a project to this storage connection";

export async function assertConnectionBindable(
  actor: { id: string; role: string },
  connectionId: string
): Promise<void> {
  const connection = await getConnection(connectionId);
  if (!connection) {
    throw new HttpError(400, ERROR_CODES.BAD_REQUEST, "Storage connection not found");
  }
  if (isSiteAdmin(actor)) return;

  const bound = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.storageConnectionId, connectionId));
  if (bound.length === 0) {
    // A connection nobody uses is not reachable through any project, so a
    // regular user has no claim on it.
    throw new HttpError(403, ERROR_CODES.FORBIDDEN, REFUSED);
  }
  const reachable = await reachableProjectIds(actor.id);
  if (!bound.some((p) => reachable.has(p.id))) {
    throw new HttpError(403, ERROR_CODES.FORBIDDEN, REFUSED);
  }
}

// Projects the actor can actually reach: a collaborator row whose permission set
// normalizes to nothing grants nothing, so row presence alone is not access.
// (listAccessibleProjectIds counts rows; that is the right question for a list
// of projects to show, and the wrong one for an authorization decision.)
async function reachableProjectIds(userId: string): Promise<Set<string>> {
  const rows = await db
    .select({ projectId: projectCollaborators.projectId, permissions: projectCollaborators.permissions })
    .from(projectCollaborators)
    .where(eq(projectCollaborators.userId, userId));
  return new Set(
    rows.filter((row) => normalizePermissions(row.permissions ?? []).length > 0).map((row) => row.projectId)
  );
}
