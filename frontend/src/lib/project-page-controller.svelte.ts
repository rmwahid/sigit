import {
  backupProject,
  deleteProject,
  getAppInfo,
  getProject,
  getProjectDiff,
  listConnections,
  listUsers,
  restoreProject,
  updateProject,
  type Connection,
  type ManagedUser,
  type Project,
} from "./api";
import { listPublicProjects } from "./api/explore";
import { listTokens, type GitToken } from "./api/tokens";
import { scopeLabel, type TokenScope } from "./constants/scopes";
import { COPY_FEEDBACK_MS } from "./constants/validation";
import { DEFAULT_GIT_BASE_URL } from "./constants/paths";
import { DEFAULT_COLLAB_PERMISSIONS, type ProjectPermission } from "./constants/permissions";
import { ADMIN_ROLE } from "./constants/roles";
import {
  addCollaborator,
  listCollaborators,
  removeCollaborator,
  updateCollaborator,
  type Collaborator,
} from "./api/projects";
import {
  getActivity,
  getBlob,
  getHistoryPage,
  getRefs,
  getTree,
  type ActivityItem,
  type CommitInfo,
  type TreeEntry,
} from "./api/browser";
import { lfsCommands, parseLfsPatterns } from "./snippet";
import { renderMarkdown } from "./markdown";
import { projectsStore } from "./stores/projects.svelte";
import {
  defaultRef,
  deriveTabKeys,
  groupActivityByDate,
  hasProjectPerm,
  joinPath,
  splitPath,
  type ProjectTabKey,
} from "./project-page";

// Stateful controller for the project page: owns every tab's state and all
// loaders/handlers so routes/(app)/projects/[id]/+page.svelte stays a thin
// view. The pure logic lives in ./project-page (paired with tests); this
// class only wires it to the API.
export class ProjectPageController {
  project = $state<Project | null>(null);
  isAnon = $state(false);
  tab = $state<ProjectTabKey>("code");
  error = $state("");
  message = $state("");

  // Code tab
  branches = $state<string[]>([]);
  ref = $state("HEAD");
  dirPath = $state("");
  entries = $state<TreeEntry[]>([]);
  treeError = $state("");
  codeLoading = $state(false);
  readme = $state<{ name: string; html: string } | null>(null);
  viewing = $state<{ path: string; content: string; encoding: "text" | "base64"; size: number } | null>(null);
  blobError = $state("");

  // History tab
  history = $state<CommitInfo[]>([]);
  historyOffset = $state(0);
  historyMore = $state(false);
  historyLoading = $state(false);
  diff = $state<{ diff: string; files: { path: string; status: string }[] } | null>(null);

  // Activity tab
  activity = $state<ActivityItem[]>([]);
  activityOffset = $state(0);
  activityMore = $state(false);

  // Setup snippet
  appInfo = $state<{ gitBaseUrl: string } | null>(null);
  copiedClone = $state(false);
  tokens = $state<GitToken[]>([]);
  connections = $state<Connection[]>([]);

  // Settings tab
  connTab = $state<"s3" | "gdrive">("s3");
  selectedConnId = $state("");
  connecting = $state(false);
  backingUp = $state(false);
  showDeleteConfirm = $state(false);
  deleteConfirmName = $state("");
  deleting = $state(false);
  deleteStep = $state("");
  collaborators = $state<Collaborator[]>([]);
  allUsers = $state<ManagedUser[]>([]);
  newCollabUserId = $state("");
  newCollabPerms = $state<ProjectPermission[]>([...DEFAULT_COLLAB_PERMISSIONS]);
  editingCollab = $state<Collaborator | null>(null);
  editingPerms = $state<ProjectPermission[]>([]);

  access = $derived((this.project?.myPermissions as ProjectPermission[] | null) ?? null);
  isAdmin = $derived(this.access === null);
  tabKeys = $derived(deriveTabKeys(this.access, this.isAnon));
  canConfirmDelete = $derived(this.project !== null && this.deleteConfirmName.trim() === this.project.name);
  gitBaseUrl = $derived(this.appInfo?.gitBaseUrl ?? DEFAULT_GIT_BASE_URL);
  cloneUrl = $derived(this.project ? `${this.gitBaseUrl}/projects/${this.project.name}.git` : "");
  lfsPatterns = $derived(this.project ? parseLfsPatterns(this.project.lfsPatterns) : []);
  lfsCommandText = $derived(lfsCommands(this.lfsPatterns));
  lfsThresholdMb = $derived(this.project ? Math.round(this.project.lfsSizeThreshold / (1024 * 1024)) : 0);
  projectTokens = $derived.by(() => {
    const projectId = this.project?.id;
    if (!projectId) return [];
    return this.tokens
      .map((t) => ({ token: t, scope: t.projects.find((p) => p.projectId === projectId)?.scope }))
      .filter((x): x is { token: GitToken; scope: TokenScope } => x.scope !== undefined);
  });
  pathSegments = $derived(splitPath(this.dirPath));
  activityByDate = $derived(groupActivityByDate(this.activity));

  private id: string | null = null;

  hasPerm(perm: ProjectPermission): boolean {
    return hasProjectPerm(this.access, this.isAnon, perm);
  }

  // Called on param change: reset everything and reload.
  async init(id: string) {
    this.id = id;
    this.project = null;
    this.isAnon = false;
    this.tab = "code";
    this.error = "";
    this.message = "";
    this.dirPath = "";
    this.ref = "HEAD";
    this.branches = [];
    this.entries = [];
    this.treeError = "";
    this.readme = null;
    this.viewing = null;
    this.blobError = "";
    this.history = [];
    this.historyOffset = 0;
    this.historyMore = false;
    this.diff = null;
    this.activity = [];
    this.activityOffset = 0;
    this.activityMore = false;
    this.connTab = "s3";
    this.selectedConnId = "";
    this.showDeleteConfirm = false;
    this.deleteConfirmName = "";
    this.collaborators = [];
    this.allUsers = [];
    await this.loadProject();
  }

  private currentId(): string | null {
    return this.id;
  }

  async loadProject() {
    const id = this.currentId();
    if (!id) return;
    this.error = "";
    try {
      const p = await getProject(id);
      if (this.currentId() !== id) return;
      this.project = p.data;
      await Promise.all([this.loadRefs(), this.loadTree(), this.loadHistory(), this.loadActivity()]);
      if (this.isAdmin) {
        void this.loadConnections();
        void this.loadTokens();
        void this.loadCollaborators();
      }
    } catch {
      // No session (or failed): anonymous visitors may still open public projects.
      try {
        const pubs = await listPublicProjects();
        const found = pubs.data.find((x) => x.id === id);
        if (this.currentId() !== id) return;
        if (!found) {
          this.error = "Project not found.";
          return;
        }
        // Anonymous view: public projects only carry id/name/description/isPublic.
        this.project = { ...found, description: found.description ?? undefined, storageConnectionId: null, lfsSizeThreshold: 0 };
        this.isAnon = true;
        await Promise.all([this.loadRefs(), this.loadTree(), this.loadHistory()]);
      } catch (e) {
        if (this.currentId() === id) this.error = e instanceof Error ? e.message : String(e);
      }
    }
  }

  async loadAppInfo() {
    try {
      const res = await getAppInfo();
      this.appInfo = res.data;
    } catch {
      // fall back to the default base url; the clone box still works
    }
  }

  private async loadConnections() {
    try {
      const c = await listConnections();
      this.connections = c.data;
    } catch {
      // storage section only shows what loaded
    }
  }

  private async loadTokens() {
    try {
      const res = await listTokens();
      this.tokens = res.data;
    } catch {
      // the token access section only shows when loaded successfully
    }
  }

  private async loadCollaborators() {
    if (!this.project || !this.isAdmin) return;
    try {
      const [cols, us] = await Promise.all([listCollaborators(this.project.id), listUsers()]);
      this.collaborators = cols.data;
      this.allUsers = us.data.filter((u) => u.role !== ADMIN_ROLE && !cols.data.some((c) => c.userId === u.id));
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    }
  }

  private async loadRefs() {
    if (!this.project) return;
    const id = this.project.id;
    try {
      const res = await getRefs(id);
      if (this.project?.id !== id) return;
      this.branches = res.data.branches;
      // The selector shows branch NAMES (the SHA head would never match).
      if (this.ref === "HEAD") {
        this.ref = defaultRef(res.data.defaultBranch, res.data.branches);
      }
    } catch (e) {
      if (this.project?.id === id) this.error = e instanceof Error ? e.message : String(e);
    }
  }

  private async loadTree() {
    if (!this.project) return;
    const id = this.project.id;
    const atRef = this.ref;
    const atPath = this.dirPath;
    this.codeLoading = true;
    this.treeError = "";
    this.readme = null;
    try {
      const res = await getTree(id, atRef, atPath);
      if (this.project?.id !== id || this.ref !== atRef || this.dirPath !== atPath) return;
      this.entries = res.data.entries;
      if (atPath === "") {
        const readmeEntry = this.entries.find((e) => e.type === "blob" && /^readme(\.md)?$/i.test(e.name));
        if (readmeEntry) {
          try {
            const blob = await getBlob(id, atRef, readmeEntry.name);
            if (blob.data.encoding === "text") {
              this.readme = { name: readmeEntry.name, html: renderMarkdown(blob.data.content) };
            }
          } catch {
            this.readme = null;
          }
        }
      }
    } catch (e) {
      if (this.project?.id !== id) return;
      this.entries = [];
      this.treeError = e instanceof Error ? e.message : String(e);
    } finally {
      this.codeLoading = false;
    }
  }

  async onRefChange() {
    this.dirPath = "";
    this.viewing = null;
    await this.loadTree();
  }

  async openDir(name: string) {
    this.dirPath = joinPath(this.dirPath, name);
    this.viewing = null;
    await this.loadTree();
  }

  async goToDir(index: number) {
    this.dirPath = this.pathSegments.slice(0, index + 1).join("/");
    this.viewing = null;
    await this.loadTree();
  }

  async openFile(name: string) {
    if (!this.project) return;
    const filePath = joinPath(this.dirPath, name);
    this.blobError = "";
    this.viewing = null;
    try {
      const res = await getBlob(this.project.id, this.ref, filePath);
      const { path: _blobPath, ...rest } = res.data;
      this.viewing = { path: filePath, ...rest };
    } catch (e) {
      this.blobError = e instanceof Error ? e.message : String(e);
    }
  }

  async loadHistory(more = false) {
    if (!this.project) return;
    const id = this.project.id;
    this.historyLoading = true;
    try {
      const res = await getHistoryPage(id, 50, more ? this.historyOffset : 0);
      if (this.project?.id !== id) return;
      this.history = more ? [...this.history, ...res.data.commits] : res.data.commits;
      this.historyOffset = this.history.length;
      this.historyMore = res.data.commits.length === 50;
    } catch (e) {
      if (this.project?.id === id) this.error = e instanceof Error ? e.message : String(e);
    } finally {
      this.historyLoading = false;
    }
  }

  async loadActivity(more = false) {
    if (!this.project) return;
    const id = this.project.id;
    try {
      const res = await getActivity(id, 50, more ? this.activityOffset : 0);
      if (this.project?.id !== id) return;
      this.activity = more ? [...this.activity, ...res.data] : res.data;
      this.activityOffset = this.activity.length;
      this.activityMore = res.data.length === 50;
    } catch (e) {
      if (this.project?.id === id) this.error = e instanceof Error ? e.message : String(e);
    }
  }

  async showDiff(hash: string) {
    if (!this.project || this.isAnon) return;
    try {
      const res = await getProjectDiff(this.project.id, hash);
      this.diff = res.data;
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    }
  }

  closeDiff() {
    this.diff = null;
  }

  async copyCloneUrl() {
    try {
      await navigator.clipboard.writeText(this.cloneUrl);
      this.copiedClone = true;
      setTimeout(() => (this.copiedClone = false), COPY_FEEDBACK_MS);
    } catch {
      // clipboard unavailable, user can copy manually
    }
  }

  async onTogglePublic() {
    if (!this.project) return;
    this.error = "";
    try {
      await updateProject(this.project.id, { isPublic: !this.project.isPublic });
      await this.loadProject();
      this.message = this.project.isPublic ? "Project is now public" : "Project is now private";
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    }
  }

  async onConnect() {
    if (!this.project || !this.selectedConnId) return;
    this.connecting = true;
    this.error = "";
    try {
      await updateProject(this.project.id, { storageConnectionId: this.selectedConnId });
      await this.loadProject();
      this.message = "Storage connected";
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    } finally {
      this.connecting = false;
    }
  }

  async onDisconnect() {
    if (!this.project) return;
    try {
      await updateProject(this.project.id, { storageConnectionId: null });
      await this.loadProject();
      this.message = "Storage disconnected";
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    }
  }

  async onBackup() {
    if (!this.project) return;
    this.backingUp = true;
    try {
      const res = await backupProject(this.project.id);
      this.message = `Backup created (${(res.data.size / 1024).toFixed(1)} KB)`;
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    } finally {
      this.backingUp = false;
    }
  }

  async onRestore() {
    if (!this.project) return;
    if (!confirm("Restore project from backup? This overwrites local history.")) return;
    try {
      await restoreProject(this.project.id);
      this.message = "Project restored from backup";
      await this.loadHistory();
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    }
  }

  togglePerm(list: ProjectPermission[], perm: ProjectPermission): ProjectPermission[] {
    return list.includes(perm) ? list.filter((p) => p !== perm) : [...list, perm];
  }

  async onAddCollaborator() {
    if (!this.project || !this.newCollabUserId) return;
    this.error = "";
    try {
      await addCollaborator(this.project.id, this.newCollabUserId, this.newCollabPerms);
      this.newCollabUserId = "";
      this.newCollabPerms = [...DEFAULT_COLLAB_PERMISSIONS];
      await this.loadCollaborators();
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    }
  }

  async onSaveCollabPerms() {
    if (!this.project || !this.editingCollab) return;
    this.error = "";
    try {
      await updateCollaborator(this.project.id, this.editingCollab.userId, this.editingPerms);
      this.editingCollab = null;
      await this.loadCollaborators();
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    }
  }

  async onRemoveCollab(userId: string) {
    if (!this.project) return;
    this.error = "";
    try {
      await removeCollaborator(this.project.id, userId);
      await this.loadCollaborators();
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    }
  }

  openDeleteConfirm() {
    if (!this.project) return;
    this.showDeleteConfirm = true;
    this.deleteConfirmName = "";
    this.error = "";
  }

  async onDelete(): Promise<void> {
    if (!this.project || !this.canConfirmDelete) return;
    this.deleting = true;
    this.deleteStep = "Deleting database record...";
    try {
      const res = await deleteProject(this.project.id);
      const d = res.data;
      this.deleteStep = "Removing local repository...";
      if (d.hadStorage) this.deleteStep = "Removing storage objects (LFS + backup)...";
      projectsStore.remove(this.project.id);
      this.showDeleteConfirm = false;
      const { goto } = await import("$app/navigation");
      await goto("/");
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
      this.showDeleteConfirm = false;
    } finally {
      this.deleting = false;
      this.deleteStep = "";
    }
  }
}
