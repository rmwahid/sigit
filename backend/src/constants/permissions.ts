// Project collaborator permissions - single source of truth (Pralumex style).
// Each permission is a named entry with slug + name; ALL_PROJECT_PERMISSIONS is
// derived. Backup, restore, settings, collaborators, public toggle and delete
// are ADMIN ONLY - they are not permissions. The frontend mirrors this file in
// lib/constants/permissions.ts and tests/constants-sync.test.ts enforces parity.
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

// Invariants: some permissions imply others.
export const IMPLIED_PERMISSIONS: Partial<Record<ProjectPermission, ProjectPermission[]>> = {
  [PROJECT_PERMISSIONS.PUSH.slug]: [PROJECT_PERMISSIONS.CLONE.slug],
  [PROJECT_PERMISSIONS.LFS_UPLOAD.slug]: [PROJECT_PERMISSIONS.LFS_DOWNLOAD.slug],
};

// Groups for the permission picker UI (subset of ALL_PROJECT_PERMISSIONS).
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

// Maps a classified git/LFS action to the collaborator permission it requires.
// Used by the git auth middleware (replaces a literal switch).
export const GIT_ACTIONS = {
  CLONE: "clone",
  PUSH: "push",
  LFS_DOWNLOAD: "lfsDownload",
  LFS_UPLOAD: "lfsUpload",
  LFS_BATCH: "lfsBatch",
} as const;

export type GitAction = (typeof GIT_ACTIONS)[keyof typeof GIT_ACTIONS];

export const ACTION_PERMISSION: Record<GitAction, ProjectPermission> = {
  [GIT_ACTIONS.CLONE]: PROJECT_PERMISSIONS.CLONE.slug,
  [GIT_ACTIONS.PUSH]: PROJECT_PERMISSIONS.PUSH.slug,
  [GIT_ACTIONS.LFS_DOWNLOAD]: PROJECT_PERMISSIONS.LFS_DOWNLOAD.slug,
  [GIT_ACTIONS.LFS_UPLOAD]: PROJECT_PERMISSIONS.LFS_UPLOAD.slug,
  [GIT_ACTIONS.LFS_BATCH]: PROJECT_PERMISSIONS.LFS_DOWNLOAD.slug,
};
