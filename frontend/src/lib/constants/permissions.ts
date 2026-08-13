// Project collaborator permissions - mirrors backend src/constants/permissions.ts
// (Pralumex style: named entries with slug + name). tests/constants-sync.test.ts
// enforces parity. Backup, restore, settings, collaborators, public toggle and
// delete are ADMIN ONLY - they are not permissions.
export const PROJECT_PERMISSIONS = {
  CLONE: { slug: "clone", name: "Clone / pull" },
  PUSH: { slug: "push", name: "Push (implies clone)" },
  LFS_DOWNLOAD: { slug: "lfsDownload", name: "LFS download" },
  LFS_UPLOAD: { slug: "lfsUpload", name: "LFS upload (implies download)" },
  VIEW: { slug: "view", name: "View project" },
  HISTORY: { slug: "history", name: "Commit history" },
  DIFF: { slug: "diff", name: "Diff viewer" },
} as const;

export type ProjectPermission = (typeof PROJECT_PERMISSIONS)[keyof typeof PROJECT_PERMISSIONS]["slug"];

export const ALL_PROJECT_PERMISSIONS = Object.values(PROJECT_PERMISSIONS).map((p) => p.slug);

// Groups for the permission picker UI.
export const PERMISSION_GROUPS: { label: string; keys: ProjectPermission[] }[] = [
  {
    label: "Git access",
    keys: [
      PROJECT_PERMISSIONS.CLONE.slug,
      PROJECT_PERMISSIONS.PUSH.slug,
      PROJECT_PERMISSIONS.LFS_DOWNLOAD.slug,
      PROJECT_PERMISSIONS.LFS_UPLOAD.slug,
    ],
  },
  {
    label: "Project page",
    keys: [
      PROJECT_PERMISSIONS.VIEW.slug,
      PROJECT_PERMISSIONS.HISTORY.slug,
      PROJECT_PERMISSIONS.DIFF.slug,
    ],
  },
];

// Default permission set offered when adding a collaborator.
export const DEFAULT_COLLAB_PERMISSIONS: ProjectPermission[] = [
  PROJECT_PERMISSIONS.CLONE.slug,
  PROJECT_PERMISSIONS.VIEW.slug,
];

export function permissionName(slug: string): string {
  const found = Object.values(PROJECT_PERMISSIONS).find((p) => p.slug === slug);
  return found?.name ?? slug;
}
