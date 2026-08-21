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
import type { TokenScope } from "./constants/scopes";
import { COPY_FEEDBACK_MS, BRANCH_PATTERN_PATTERN } from "./constants/validation";
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
  createProjectBranch,
  deleteProjectBranch,
} from "./api/branches";
import {
  addProjectPullRequestComment,
  createProjectPullRequest,
  deleteProjectPullRequest,
  getProjectPullRequest,
  getProjectPullRequestDiff,
  listProjectPullRequests,
  mergeProjectPullRequest,
  submitProjectPullRequestReview,
  updateProjectPullRequest,
  type PullRequest,
  type PullRequestDetail,
} from "./api/pull-requests";
import {
  createProjectProtectionRule,
  deleteProjectProtectionRule,
  listProjectProtectionRules,
  updateProjectProtectionRule,
  type ProtectionRule,
  type ProtectionRuleInput,
} from "./api/branch-protection";
import type { PrStatus, ReviewState } from "$lib/constants/pull-requests";
import { MERGE_METHODS, PR_STATUSES, REVIEW_STATES } from "$lib/constants/pull-requests";
import {
  defaultRef,
  deriveTabKeys,
  emptyRichText,
  groupActivityByDate,
  hasProjectPerm,
  isPlainPrComment,
  isValidBranchName,
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

  // Lazy tab loading: each tab fetches its data the first time it is opened
  // and keeps it cached afterwards. `loadedTabs` tracks what already fetched
  // (loading indicator = first open, "reload" keeps current data on screen).
  loadedTabs = $state<Partial<Record<ProjectTabKey, boolean>>>({});
  codeLoaded = $derived(Boolean(this.loadedTabs.code));

  // Branch modal (new branch + delete)
  showBranchModal = $state(false);
  newBranchName = $state("");
  newBranchFrom = $state("");
  branchActionError = $state("");
  creatingBranch = $state(false);

  // Pull requests tab
  pullRequests = $state<PullRequest[]>([]);
  prLoading = $state(false);
  prError = $state("");
  prLoaded = $derived(Boolean(this.loadedTabs["pull-requests"]));
  // Status filter for the list ("all" = no filter); the backend query
  // supports the four status slugs directly.
  prFilter = $state<PrStatus | "all">(PR_STATUSES.OPEN.slug);
  activePr = $state<PullRequestDetail | null>(null);
  activePrDiff = $state("");
  prDiffLoading = $state(false);
  prDiffError = $state("");
  showPrModal = $state(false);
  newPrTitle = $state("");
  newPrDescription = $state("");
  newPrBase = $state("");
  newPrHead = $state("");
  mergeMethod = $state<(typeof MERGE_METHODS)[keyof typeof MERGE_METHODS]["slug"]>(MERGE_METHODS.MERGE.slug);
  prActionError = $state("");
  creatingPr = $state(false);
  newCommentBody = $state("");
  reviewState = $state<ReviewState>(REVIEW_STATES.COMMENT.slug);
  reviewSending = $state(false);

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
  activityLoading = $state(false);

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
  settingsLoading = $state(false);
  settingsLoaded = $derived(Boolean(this.loadedTabs.settings));
  collaborators = $state<Collaborator[]>([]);
  allUsers = $state<ManagedUser[]>([]);
  newCollabUserId = $state("");
  newCollabPerms = $state<ProjectPermission[]>([...DEFAULT_COLLAB_PERMISSIONS]);
  editingCollab = $state<Collaborator | null>(null);
  editingPerms = $state<ProjectPermission[]>([]);

  // Branch protection (Settings tab)
  protectionRules = $state<ProtectionRule[]>([]);
  protectionLoading = $state(false);
  protectionError = $state("");
  showProtectionModal = $state(false);
  protectionSaving = $state(false);
  newProtectionPattern = $state("");
  newProtectionRequirePr = $state(false);
  newProtectionApprovals = $state(0);
  newProtectionBlockRequest = $state(false);
  newProtectionBlockForce = $state(true);
  newProtectionBlockDelete = $state(true);
  newProtectionRestrictPush = $state(false);
  newProtectionRestrictPushIds = $state<string[]>([]);
  newProtectionRestrictMergeIds = $state<string[]>([]);
  newProtectionAllowBypass = $state(false);

  // Confirmation modal (replaces native confirm()): the caller sets the
  // pending action, the modal renders it, and confirmConfirm runs it.
  confirmState = $state<{ title: string; message: string; confirmLabel: string; danger: boolean; action: () => void } | null>(null);

  askConfirm(opts: { title: string; message: string; confirmLabel?: string; danger?: boolean; action: () => void }) {
    this.confirmState = {
      title: opts.title,
      message: opts.message,
      confirmLabel: opts.confirmLabel ?? "Confirm",
      danger: opts.danger ?? false,
      action: opts.action,
    };
  }

  cancelConfirm() {
    this.confirmState = null;
  }

  confirmConfirm() {
    const action = this.confirmState?.action;
    this.confirmState = null;
    action?.();
  }

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
    this.loadedTabs = {};
    this.settingsLoading = false;
    this.pullRequests = [];
    this.prFilter = PR_STATUSES.OPEN.slug;
    this.activePr = null;
    this.activePrDiff = "";
    this.prError = "";
    this.prDiffError = "";
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
      // Refs first: loadHistory depends on the resolved default branch name
      // (it fetches without a ref while this.ref is still "HEAD").
      await this.loadRefs();
      await Promise.all([this.loadTree(), this.loadHistory(), this.loadActivity()]);
      // Settings and Pull Requests load lazily on first open (ensureTabLoaded).
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
        await this.loadRefs();
        await Promise.all([this.loadTree(), this.loadHistory()]);
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

  // Lazy tab loader: the first open fetches the tab's data, later opens reuse
  // the cached state (no refetch). Loaders set their own *_loading flag, so
  // this only guards the "first open" fetch.
  ensureTabLoaded(tab: ProjectTabKey) {
    if (this.loadedTabs[tab]) return;
    if (tab === "settings") void this.ensureSettings();
    if (tab === "pull-requests") void this.ensurePullRequests();
    this.loadedTabs[tab] = true;
  }

  private async ensureSettings() {
    if (!this.project || !this.isAdmin) return;
    this.settingsLoading = true;
    try {
      await Promise.all([this.loadConnections(), this.loadTokens(), this.loadCollaborators(), this.loadProtectionRules()]);
    } finally {
      this.settingsLoading = false;
    }
  }

  private async ensurePullRequests() {
    if (!this.project) return;
    await this.loadPullRequests();
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

  private async loadProtectionRules() {
    if (!this.project || !this.isAdmin) return;
    const id = this.project.id;
    this.protectionLoading = true;
    this.protectionError = "";
    try {
      const res = await listProjectProtectionRules(id);
      if (this.project?.id === id) this.protectionRules = res.data;
    } catch (e) {
      if (this.project?.id === id) this.protectionError = e instanceof Error ? e.message : String(e);
    } finally {
      if (this.project?.id === id) this.protectionLoading = false;
    }
  }

  // Settings data (connections/tokens/collaborators/protection) is loaded by
  // ensureSettings on first open; mutations inside the tab reload the pieces
  // they touch, so a project change needs a full reset (init already clears
  // settingsLoading, loadedTabs.settings is unset and the new first open
  // re-fetches everything).
  async loadSettingsIfNeeded() {
    if (!this.project || !this.isAdmin) return;
    if (this.loadedTabs.settings) return;
    await this.ensureSettings();
  }

  private patternValid(pattern: string): boolean {
    return new RegExp(BRANCH_PATTERN_PATTERN).test(pattern) && !pattern.includes("..");
  }

  async onCreateProtectionRule() {
    const id = this.currentId();
    if (!id) return;
    const pattern = this.newProtectionPattern.trim();
    if (!pattern) return;
    if (!this.patternValid(pattern)) {
      this.protectionError = "Invalid branch pattern. Use a name or a prefix wildcard like feature/*";
      return;
    }
    if (this.protectionRules.some((r) => r.branchPattern === pattern)) {
      this.protectionError = `A rule for "${pattern}" already exists`;
      return;
    }
    this.protectionSaving = true;
    this.protectionError = "";
    try {
      await createProjectProtectionRule(id, {
        branchPattern: pattern,
        requirePr: this.newProtectionRequirePr,
        requiredApprovals: this.newProtectionApprovals,
        blockOnRequestChanges: this.newProtectionBlockRequest,
        blockForcePush: this.newProtectionBlockForce,
        blockDeletion: this.newProtectionBlockDelete,
        restrictPushUserIds: this.newProtectionRestrictPush ? this.newProtectionRestrictPushIds : [],
        restrictMergeUserIds: this.newProtectionRestrictMergeIds,
        allowAdminBypass: this.newProtectionAllowBypass,
      });
      this.showProtectionModal = false;
      this.newProtectionPattern = "";
      this.newProtectionRequirePr = false;
      this.newProtectionApprovals = 0;
      this.newProtectionBlockRequest = false;
      this.newProtectionBlockForce = true;
      this.newProtectionBlockDelete = true;
      this.newProtectionRestrictPush = false;
      this.newProtectionRestrictPushIds = [];
      this.newProtectionRestrictMergeIds = [];
      this.newProtectionAllowBypass = false;
      await this.loadProtectionRules();
    } catch (e) {
      this.protectionError = e instanceof Error ? e.message : String(e);
    } finally {
      this.protectionSaving = false;
    }
  }

  async onUpdateProtectionRule(rule: ProtectionRule, patch: Partial<ProtectionRuleInput>) {
    const id = this.currentId();
    if (!id) return;
    this.protectionError = "";
    try {
      await updateProjectProtectionRule(id, rule.id, patch);
      await this.loadProtectionRules();
    } catch (e) {
      this.protectionError = e instanceof Error ? e.message : String(e);
    }
  }

  async onDeleteProtectionRule(rule: ProtectionRule) {
    const id = this.currentId();
    if (!id) return;
    this.askConfirm({
      title: "Delete protection rule",
      message: `Delete protection rule for "${rule.branchPattern}"?`,
      confirmLabel: "Delete",
      danger: true,
      action: async () => {
        this.protectionError = "";
        try {
          await deleteProjectProtectionRule(id, rule.id);
          await this.loadProtectionRules();
        } catch (e) {
          this.protectionError = e instanceof Error ? e.message : String(e);
        }
      },
    });
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
    this.diff = null;
    this.history = [];
    this.historyOffset = 0;
    this.historyMore = false;
    await this.loadTree();
    await this.loadHistory();
  }

  openBranchModal() {
    this.showBranchModal = true;
    this.newBranchName = "";
    this.newBranchFrom = this.branches.includes(this.ref) ? this.ref : "";
    this.branchActionError = "";
  }

  closeBranchModal() {
    if (this.creatingBranch) return;
    this.showBranchModal = false;
    this.branchActionError = "";
  }

  async onCreateBranch() {
    if (!this.project) return;
    const name = this.newBranchName.trim();
    if (!isValidBranchName(name)) {
      this.branchActionError = "Invalid branch name: use letters, numbers, . _ - / (no leading/trailing symbols).";
      return;
    }
    this.creatingBranch = true;
    this.branchActionError = "";
    try {
      await createProjectBranch(this.project.id, name, this.newBranchFrom || undefined);
      this.showBranchModal = false;
      this.ref = name;
      await this.loadRefs();
      await this.onRefChange();
    } catch (e) {
      this.branchActionError = e instanceof Error ? e.message : String(e);
    } finally {
      this.creatingBranch = false;
    }
  }

  async onDeleteBranch(branch: string) {
    if (!this.project) return;
    this.askConfirm({
      title: "Delete branch",
      message: `Delete branch "${branch}"? This cannot be undone.`,
      confirmLabel: "Delete",
      danger: true,
      action: async () => {
        this.branchActionError = "";
        try {
          await deleteProjectBranch(this.project!.id, branch);
          if (this.ref === branch) this.ref = "HEAD";
          await this.loadRefs();
          await this.onRefChange();
        } catch (e) {
          this.branchActionError = e instanceof Error ? e.message : String(e);
        }
      },
    });
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
    const atRef = this.ref;
    const first = !more && !this.loadedTabs.history;
    if (first) this.historyLoading = true;
    try {
      const res = await getHistoryPage(id, 50, more ? this.historyOffset : 0, atRef === "HEAD" ? undefined : atRef);
      if (this.project?.id !== id || this.ref !== atRef) return;
      this.history = more ? [...this.history, ...res.data.commits] : res.data.commits;
      this.historyOffset = this.history.length;
      this.historyMore = res.data.commits.length === 50;
      if (first) this.loadedTabs.history = true;
    } catch (e) {
      if (this.project?.id === id) this.error = e instanceof Error ? e.message : String(e);
    } finally {
      if (this.project?.id === id) this.historyLoading = false;
    }
  }

  async loadActivity(more = false) {
    if (!this.project) return;
    const id = this.project.id;
    const first = !more && !this.loadedTabs.activity;
    if (first) this.activityLoading = true;
    try {
      const res = await getActivity(id, 50, more ? this.activityOffset : 0);
      if (this.project?.id !== id) return;
      this.activity = more ? [...this.activity, ...res.data] : res.data;
      this.activityOffset = this.activity.length;
      this.activityMore = res.data.length === 50;
      if (first) this.loadedTabs.activity = true;
    } catch (e) {
      if (this.project?.id === id) this.error = e instanceof Error ? e.message : String(e);
    } finally {
      if (this.project?.id === id) this.activityLoading = false;
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
    this.askConfirm({
      title: "Restore from backup",
      message: "Restore project from backup? This overwrites local history.",
      confirmLabel: "Restore",
      danger: true,
      action: async () => {
        try {
          await restoreProject(this.project!.id);
          this.message = "Project restored from backup";
          await this.loadHistory();
        } catch (e) {
          this.error = e instanceof Error ? e.message : String(e);
        }
      },
    });
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

  // --- Pull requests tab ---

  async loadPullRequests() {
    const id = this.currentId();
    if (!id) return;
    this.prLoading = true;
    this.prError = "";
    try {
      const res = await listProjectPullRequests(id, this.prFilter === "all" ? undefined : this.prFilter);
      if (this.currentId() !== id) return;
      this.pullRequests = res.data;
      this.loadedTabs["pull-requests"] = true;
    } catch (e) {
      if (this.currentId() === id) this.prError = e instanceof Error ? e.message : String(e);
    } finally {
      if (this.currentId() === id) this.prLoading = false;
    }
  }

  async onPrFilterChange() {
    // Re-fetch when the status filter changes; the current detail stays open
    // until the user navigates back (list state is refetched underneath).
    await this.loadPullRequests();
  }

  async openPullRequest(number: number) {
    const id = this.currentId();
    if (!id) return;
    this.prError = "";
    this.prDiffError = "";
    this.activePrDiff = "";
    try {
      const res = await getProjectPullRequest(id, number);
      if (this.currentId() !== id) return;
      this.activePr = res.data;
      void this.loadPrDiff(number);
    } catch (e) {
      if (this.currentId() === id) this.prError = e instanceof Error ? e.message : String(e);
    }
  }

  closePullRequest() {
    this.activePr = null;
    this.activePrDiff = "";
    this.prDiffError = "";
  }

  async loadPrDiff(number: number) {
    const id = this.currentId();
    if (!id) return;
    this.prDiffLoading = true;
    this.prDiffError = "";
    try {
      const res = await getProjectPullRequestDiff(id, number);
      if (this.currentId() !== id || this.activePr?.number !== number) return;
      this.activePrDiff = res.diff;
    } catch (e) {
      if (this.currentId() === id) this.prDiffError = e instanceof Error ? e.message : String(e);
    } finally {
      if (this.currentId() === id) this.prDiffLoading = false;
    }
  }

  openPrModal() {
    this.showPrModal = true;
    this.newPrTitle = "";
    this.newPrDescription = "";
    this.newPrBase = this.branches.includes(this.ref) ? this.ref : this.branches[0] ?? "";
    this.newPrHead = this.branches.find((b) => b !== this.newPrBase) ?? "";
    this.prActionError = "";
  }

  closePrModal() {
    if (this.creatingPr) return;
    this.showPrModal = false;
    this.prActionError = "";
  }

  async onCreatePr() {
    if (!this.project) return;
    const title = this.newPrTitle.trim();
    if (!title) {
      this.prActionError = "Title is required.";
      return;
    }
    if (!this.newPrBase || !this.newPrHead || this.newPrBase === this.newPrHead) {
      this.prActionError = "Choose two different branches (base and head).";
      return;
    }
    this.creatingPr = true;
    this.prActionError = "";
    try {
      await createProjectPullRequest(this.project.id, {
        title,
        description: emptyRichText(this.newPrDescription) ? undefined : this.newPrDescription,
        baseBranch: this.newPrBase,
        headBranch: this.newPrHead,
      });
      this.showPrModal = false;
      await this.loadPullRequests();
    } catch (e) {
      this.prActionError = e instanceof Error ? e.message : String(e);
    } finally {
      this.creatingPr = false;
    }
  }

  async onUpdatePrStatus(number: number, status: PrStatus) {
    const id = this.currentId();
    if (!id) return;
    this.prError = "";
    try {
      await updateProjectPullRequest(id, number, { status });
      await this.loadPullRequests();
      await this.openPullRequest(number);
    } catch (e) {
      this.prError = e instanceof Error ? e.message : String(e);
    }
  }

  async onMergePr(number: number, method: (typeof MERGE_METHODS)[keyof typeof MERGE_METHODS]["slug"]) {
    const id = this.currentId();
    if (!id) return;
    this.askConfirm({
      title: "Merge pull request",
      message: `Merge pull request #${number} (${method})?`,
      confirmLabel: "Merge",
      danger: true,
      action: async () => {
        this.prError = "";
        try {
          const res = await mergeProjectPullRequest(id, number, method);
          this.activePr = { ...res.data, comments: this.activePr?.comments ?? [], reviews: this.activePr?.reviews ?? [] };
          await this.loadPullRequests();
        } catch (e) {
          this.prError = e instanceof Error ? e.message : String(e);
        }
      },
    });
  }

  async onDeletePr(number: number) {
    const id = this.currentId();
    if (!id) return;
    this.askConfirm({
      title: "Delete pull request",
      message: `Delete pull request #${number}? This cannot be undone.`,
      confirmLabel: "Delete",
      danger: true,
      action: async () => {
        this.prError = "";
        try {
          await deleteProjectPullRequest(id, number);
          this.closePullRequest();
          await this.loadPullRequests();
        } catch (e) {
          this.prError = e instanceof Error ? e.message : String(e);
        }
      },
    });
  }

  async onSubmitReview(number: number) {
    const id = this.currentId();
    if (!id) return;
    const body = this.newCommentBody;
    if (emptyRichText(body)) return;
    this.reviewSending = true;
    this.prError = "";
    try {
      // A plain comment is a new conversation entry (POST /comments always
      // inserts). Approvals and change requests are also append-only reviews
      // (every submission is a new row; there is no edit or undo).
      if (isPlainPrComment(this.reviewState)) {
        const res = await addProjectPullRequestComment(id, number, body);
        this.activePr = { ...this.activePr!, comments: [...(this.activePr?.comments ?? []), res.data] };
      } else {
        const res = await submitProjectPullRequestReview(id, number, this.reviewState, body);
        const reviews = this.activePr!.reviews.filter((r) => r.author.id !== res.data.author.id);
        this.activePr = { ...this.activePr!, reviews: [...reviews, res.data] };
      }
      this.newCommentBody = "";
    } catch (e) {
      this.prError = e instanceof Error ? e.message : String(e);
    } finally {
      this.reviewSending = false;
    }
  }
}
