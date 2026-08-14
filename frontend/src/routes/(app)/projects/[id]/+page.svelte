<script lang="ts">
  import {
    listConnections,
    getProject,
    deleteProject,
    updateProject,
    getProjectDiff,
    backupProject,
    restoreProject,
    getAppInfo,
    listUsers,
    type Connection,
    type Project,
    type ManagedUser,
  } from "$lib/api";
  import { listPublicProjects } from "$lib/api/explore";
  import { projectsStore } from "$lib/stores/projects.svelte";
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";
  import DiffViewer from "$lib/DiffViewer.svelte";
  import { onMount } from "svelte";
  import { lfsCommands, parseLfsPatterns } from "$lib/snippet";
  import { listTokens, type GitToken } from "$lib/api/tokens";
  import { scopeLabel, type TokenScope } from "$lib/constants/scopes";
  import { formatDate } from "$lib/utils";
  import { COPY_FEEDBACK_MS, MAX_FILE_BROWSER_BYTES } from "$lib/constants/validation";
  import { APP_ROUTES, DEFAULT_GIT_BASE_URL } from "$lib/constants/paths";
  import { COPY } from "$lib/constants/copy";
  import {
    listCollaborators,
    addCollaborator,
    updateCollaborator,
    removeCollaborator,
    type Collaborator,
  } from "$lib/api/projects";
  import {
    DEFAULT_COLLAB_PERMISSIONS,
    PERMISSION_GROUPS,
    PROJECT_PERMISSIONS,
    permissionName,
    type ProjectPermission,
  } from "$lib/constants/permissions";
  import { ADMIN_ROLE } from "$lib/constants/roles";
  import {
    getRefs,
    getTree,
    getBlob,
    getHistoryPage,
    getActivity,
    archiveUrl,
    type TreeEntry,
    type CommitInfo,
    type ActivityItem,
  } from "$lib/api/browser";
  import { renderMarkdown } from "$lib/markdown";
  import { ARCHIVE_FORMATS } from "$lib/constants/protocol";
  import BranchSelect from "$lib/components/BranchSelect.svelte";
  import {
    Activity as ActivityIcon,
    CornerUpLeft,
    Copy,
    Download,
    FileText,
    Folder,
    FolderOpen,
    GitBranch,
    GitCommitHorizontal,
    History as HistoryIcon,
    Settings as SettingsIcon,
    X,
    Zap,
  } from "lucide-svelte";

  type Tab = "code" | "history" | "activity" | "settings";

  let project = $state<Project | null>(null);
  let isAnon = $state(false);
  let tab = $state<Tab>("code");
  let error = $state("");
  let message = $state("");

  // Code tab
  let branches = $state<string[]>([]);
  let ref = $state("HEAD");
  let dirPath = $state("");
  let entries = $state<TreeEntry[]>([]);
  let treeError = $state("");
  let codeLoading = $state(false);
  let readme = $state<{ name: string; html: string } | null>(null);
  let viewing = $state<{ path: string; content: string; encoding: "text" | "base64"; size: number } | null>(null);
  let blobError = $state("");

  // History tab
  let history = $state<CommitInfo[]>([]);
  let historyOffset = $state(0);
  let historyMore = $state(false);
  let historyLoading = $state(false);
  let diff = $state<{ diff: string; files: { path: string; status: string }[] } | null>(null);

  // Activity tab
  let activity = $state<ActivityItem[]>([]);
  let activityOffset = $state(0);
  let activityMore = $state(false);

  // Setup snippet
  let appInfo = $state<{ gitBaseUrl: string } | null>(null);
  let copiedClone = $state(false);
  let tokens = $state<GitToken[]>([]);
  let connections = $state<Connection[]>([]);

  // Settings tab
  let connTab = $state<"s3" | "gdrive">("s3");
  let selectedConnId = $state("");
  let connecting = $state(false);
  let backingUp = $state(false);
  let showDeleteConfirm = $state(false);
  let deleteConfirmName = $state("");
  let deleting = $state(false);
  let deleteStep = $state("");
  let collaborators = $state<Collaborator[]>([]);
  let allUsers = $state<ManagedUser[]>([]);
  let newCollabUserId = $state("");
  let newCollabPerms = $state<ProjectPermission[]>([...DEFAULT_COLLAB_PERMISSIONS]);
  let editingCollab = $state<Collaborator | null>(null);
  let editingPerms = $state<ProjectPermission[]>([]);

  const canConfirmDelete = $derived(project !== null && deleteConfirmName.trim() === project.name);

  // Access: myPermissions === null means admin (everything). Anonymous public
  // visitors get Code + History only.
  const isAdmin = $derived(project?.myPermissions === null);
  function hasPerm(perm: ProjectPermission): boolean {
    if (isAnon) {
      return perm === PROJECT_PERMISSIONS.VIEW.slug || perm === PROJECT_PERMISSIONS.HISTORY.slug;
    }
    return isAdmin || (project?.myPermissions ?? []).includes(perm);
  }

  const tabs = $derived.by((): { key: Tab; label: string; icon: typeof Folder }[] => {
    const list: { key: Tab; label: string; icon: typeof Folder }[] = [{ key: "code", label: "Code", icon: Folder }];
    if (hasPerm(PROJECT_PERMISSIONS.HISTORY.slug)) {
      list.push({ key: "history", label: "History", icon: HistoryIcon });
    }
    if (hasPerm(PROJECT_PERMISSIONS.HISTORY.slug) && !isAnon) {
      list.push({ key: "activity", label: "Activity", icon: ActivityIcon });
    }
    if (isAdmin) list.push({ key: "settings", label: "Settings", icon: SettingsIcon });
    return list;
  });

  $effect(() => {
    if (!tabs.some((t) => t.key === tab)) tab = "code";
  });

  const gitBaseUrl = $derived(appInfo?.gitBaseUrl ?? DEFAULT_GIT_BASE_URL);
  const cloneUrl = $derived(project ? `${gitBaseUrl}/projects/${project.name}.git` : "");
  const lfsPatterns = $derived(project ? parseLfsPatterns(project.lfsPatterns) : []);
  const lfsCommandText = $derived(lfsCommands(lfsPatterns));
  const lfsThresholdMb = $derived(project ? Math.round(project.lfsSizeThreshold / (1024 * 1024)) : 0);
  const projectId = $derived(project?.id);
  const projectTokens = $derived(
    projectId
      ? tokens
          .map((t) => ({ token: t, scope: t.projects.find((p) => p.projectId === projectId)?.scope }))
          .filter((x): x is { token: GitToken; scope: TokenScope } => x.scope !== undefined)
      : []
  );
  const sortedEntries = $derived(
    [...entries].sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "tree" ? -1 : 1))
  );
  const pathSegments = $derived(dirPath ? dirPath.split("/") : []);
  const activityByDate = $derived.by(() => {
    const map = new Map<string, ActivityItem[]>();
    for (const item of activity) {
      const key = String(item.ts).slice(0, 10);
      const list = map.get(key) ?? [];
      list.push(item);
      map.set(key, list);
    }
    return [...map.entries()];
  });

  function joinPath(name: string): string {
    return dirPath ? `${dirPath}/${name}` : name;
  }

  function currentProject(): string | null {
    return $page.params.id ?? null;
  }

  async function loadProject() {
    const id = currentProject();
    if (!id) return;
    error = "";
    try {
      const p = await getProject(id);
      if (currentProject() !== id) return;
      project = p.data;
      await Promise.all([loadRefs(), loadTree(), loadHistory(), loadActivity()]);
      if (isAdmin) {
        void loadConnections();
        void loadTokens();
        void loadCollaborators();
      }
    } catch {
      // No session (or failed): anonymous visitors may still open public projects.
      try {
        const pubs = await listPublicProjects();
        const found = pubs.data.find((x) => x.id === id);
        if (currentProject() !== id) return;
        if (!found) {
          error = "Project not found.";
          return;
        }
        // Anonymous view: public projects only carry id/name/description/isPublic.
        project = { ...found, description: found.description ?? undefined, storageConnectionId: null, lfsSizeThreshold: 0 };
        isAnon = true;
        await Promise.all([loadRefs(), loadTree(), loadHistory()]);
      } catch (e) {
        if (currentProject() === id) error = e instanceof Error ? e.message : String(e);
      }
    }
  }

  async function loadAppInfo() {
    try {
      const res = await getAppInfo();
      appInfo = res.data;
    } catch {
      // fall back to the default base url; the clone box still works
    }
  }

  async function loadConnections() {
    try {
      const c = await listConnections();
      connections = c.data;
    } catch {
      // storage section only shows what loaded
    }
  }

  async function loadTokens() {
    try {
      const res = await listTokens();
      tokens = res.data;
    } catch {
      // the token access section only shows when loaded successfully
    }
  }

  async function loadCollaborators() {
    if (!project || !isAdmin) return;
    try {
      const [cols, us] = await Promise.all([listCollaborators(project.id), listUsers()]);
      collaborators = cols.data;
      allUsers = us.data.filter((u) => u.role !== ADMIN_ROLE && !cols.data.some((c) => c.userId === u.id));
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  async function loadRefs() {
    if (!project) return;
    const id = project.id;
    try {
      const res = await getRefs(id);
      if (project?.id !== id) return;
      branches = res.data.branches;
      // The selector shows branch NAMES (the SHA head would never match).
      if (ref === "HEAD") {
        ref = res.data.defaultBranch ?? res.data.branches[0] ?? "HEAD";
      }
    } catch (e) {
      if (project?.id === id) error = e instanceof Error ? e.message : String(e);
    }
  }

  async function loadTree() {
    if (!project) return;
    const id = project.id;
    const atRef = ref;
    const atPath = dirPath;
    codeLoading = true;
    treeError = "";
    readme = null;
    try {
      const res = await getTree(id, atRef, atPath);
      if (project?.id !== id || ref !== atRef || dirPath !== atPath) return;
      entries = res.data.entries;
      if (atPath === "") {
        const readmeEntry = entries.find((e) => e.type === "blob" && /^readme(\.md)?$/i.test(e.name));
        if (readmeEntry) {
          try {
            const blob = await getBlob(id, atRef, readmeEntry.name);
            if (blob.data.encoding === "text") {
              readme = { name: readmeEntry.name, html: renderMarkdown(blob.data.content) };
            }
          } catch {
            readme = null;
          }
        }
      }
    } catch (e) {
      if (project?.id !== id) return;
      entries = [];
      treeError = e instanceof Error ? e.message : String(e);
    } finally {
      codeLoading = false;
    }
  }

  async function onRefChange() {
    dirPath = "";
    viewing = null;
    await loadTree();
  }

  async function openDir(name: string) {
    dirPath = joinPath(name);
    viewing = null;
    await loadTree();
  }

  async function goToDir(index: number) {
    dirPath = pathSegments.slice(0, index + 1).join("/");
    viewing = null;
    await loadTree();
  }

  async function openFile(name: string) {
    if (!project) return;
    const filePath = joinPath(name);
    blobError = "";
    viewing = null;
    try {
      const res = await getBlob(project.id, ref, filePath);
      const { path: _blobPath, ...rest } = res.data;
      viewing = { path: filePath, ...rest };
    } catch (e) {
      blobError = e instanceof Error ? e.message : String(e);
    }
  }

  async function loadHistory(more = false) {
    if (!project) return;
    const id = project.id;
    historyLoading = true;
    try {
      const res = await getHistoryPage(id, 50, more ? historyOffset : 0);
      if (project?.id !== id) return;
      history = more ? [...history, ...res.data.commits] : res.data.commits;
      historyOffset = history.length;
      historyMore = res.data.commits.length === 50;
    } catch (e) {
      if (project?.id === id) error = e instanceof Error ? e.message : String(e);
    } finally {
      historyLoading = false;
    }
  }

  async function loadActivity(more = false) {
    if (!project) return;
    const id = project.id;
    try {
      const res = await getActivity(id, 50, more ? activityOffset : 0);
      if (project?.id !== id) return;
      activity = more ? [...activity, ...res.data] : res.data;
      activityOffset = activity.length;
      activityMore = res.data.length === 50;
    } catch (e) {
      if (project?.id === id) error = e instanceof Error ? e.message : String(e);
    }
  }

  async function showDiff(hash: string) {
    if (!project || isAnon) return;
    try {
      const res = await getProjectDiff(project.id, hash);
      diff = res.data;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  async function copyCloneUrl() {
    try {
      await navigator.clipboard.writeText(cloneUrl);
      copiedClone = true;
      setTimeout(() => (copiedClone = false), COPY_FEEDBACK_MS);
    } catch {
      // clipboard unavailable, user can copy manually
    }
  }

  async function onTogglePublic() {
    if (!project) return;
    error = "";
    try {
      await updateProject(project.id, { isPublic: !project.isPublic });
      await loadProject();
      message = project.isPublic ? "Project is now public" : "Project is now private";
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  async function onConnect() {
    if (!project || !selectedConnId) return;
    connecting = true;
    error = "";
    try {
      await updateProject(project.id, { storageConnectionId: selectedConnId });
      await loadProject();
      message = "Storage connected";
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      connecting = false;
    }
  }

  async function onDisconnect() {
    if (!project) return;
    try {
      await updateProject(project.id, { storageConnectionId: null });
      await loadProject();
      message = "Storage disconnected";
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  async function onBackup() {
    if (!project) return;
    backingUp = true;
    try {
      const res = await backupProject(project.id);
      message = `Backup created (${(res.data.size / 1024).toFixed(1)} KB)`;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      backingUp = false;
    }
  }

  async function onRestore() {
    if (!project) return;
    if (!confirm("Restore project from backup? This overwrites local history.")) return;
    try {
      await restoreProject(project.id);
      message = "Project restored from backup";
      await loadHistory();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  function togglePerm(list: ProjectPermission[], perm: ProjectPermission): ProjectPermission[] {
    return list.includes(perm) ? list.filter((p) => p !== perm) : [...list, perm];
  }

  async function onAddCollaborator() {
    if (!project || !newCollabUserId) return;
    error = "";
    try {
      await addCollaborator(project.id, newCollabUserId, newCollabPerms);
      newCollabUserId = "";
      newCollabPerms = [...DEFAULT_COLLAB_PERMISSIONS];
      await loadCollaborators();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  async function onSaveCollabPerms() {
    if (!project || !editingCollab) return;
    error = "";
    try {
      await updateCollaborator(project.id, editingCollab.userId, editingPerms);
      editingCollab = null;
      await loadCollaborators();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  async function onRemoveCollab(userId: string) {
    if (!project) return;
    error = "";
    try {
      await removeCollaborator(project.id, userId);
      await loadCollaborators();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  function openDeleteConfirm() {
    if (!project) return;
    showDeleteConfirm = true;
    deleteConfirmName = "";
    error = "";
  }

  async function onDelete() {
    if (!project || !canConfirmDelete) return;
    deleting = true;
    deleteStep = "Deleting database record...";
    try {
      const res = await deleteProject(project.id);
      const d = res.data;
      deleteStep = "Removing local repository...";
      if (d.hadStorage) deleteStep = "Removing storage objects (LFS + backup)...";
      projectsStore.remove(project.id);
      showDeleteConfirm = false;
      await goto("/");
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      showDeleteConfirm = false;
    } finally {
      deleting = false;
      deleteStep = "";
    }
  }

  // SvelteKit reuses this component across /projects/[id]; reload on param change.
  $effect(() => {
    const id = $page.params.id;
    if (!id) return;
    project = null;
    isAnon = false;
    tab = "code";
    error = "";
    message = "";
    dirPath = "";
    ref = "HEAD";
    branches = [];
    entries = [];
    treeError = "";
    readme = null;
    viewing = null;
    blobError = "";
    history = [];
    historyOffset = 0;
    historyMore = false;
    diff = null;
    activity = [];
    activityOffset = 0;
    activityMore = false;
    connTab = "s3";
    selectedConnId = "";
    showDeleteConfirm = false;
    deleteConfirmName = "";
    collaborators = [];
    allUsers = [];
    void loadProject();
  });

  onMount(loadAppInfo);
</script>

<svelte:head>
  <title>{project?.name ?? "Project"} - SiGit</title>
</svelte:head>

{#if !project}
  <p class="text-muted-foreground">{error || "Loading..."}</p>
{:else}
  <div class="max-w-4xl mx-auto flex flex-col gap-4">
    <!-- Breadcrumb + header -->
    <div class="flex flex-col gap-2">
      <div class="flex items-center gap-1 text-sm text-muted-foreground flex-wrap">
        <a href={APP_ROUTES.ROOT} class="font-bold text-foreground">Projects</a>
        <span>/</span>
        <span class="font-bold text-foreground">{project.name}</span>
        {#if project.isPublic}
          <span class="ml-1 text-[10px] uppercase tracking-wider px-2 py-0.5 border border-border rounded-sm bg-accent text-accent-foreground">public</span>
        {/if}
      </div>
      <h1 class="flex items-center gap-2 text-2xl font-extrabold">
        <GitBranch class="size-6 text-primary" />
        <span class="nb-mark">{project.name}</span>
      </h1>
      {#if project.description}
        <p class="text-sm text-muted-foreground">{project.description}</p>
      {/if}
    </div>

    {#if error}<div class="p-2 border border-destructive text-destructive text-sm">{error}</div>{/if}
    {#if message}<div class="p-2 border border-primary text-sm">{message}</div>{/if}

    <!-- Tab bar -->
    <div class="flex gap-1 border-b-2 border-border">
      {#each tabs as t}
        <button
          class="px-4 py-1.5 text-sm font-bold flex items-center gap-1.5 border-2 border-b-0 border-border rounded-t-sm transition-all {tab === t.key ? "bg-primary text-primary-foreground -mb-0.5" : "bg-card hover:bg-muted"}"
          onclick={() => (tab = t.key)}
        >
          <t.icon class="size-3.5" /> {t.label}
        </button>
      {/each}
    </div>

    {#if tab === "code"}
      <!-- Clone URL + download -->
      <div class="pixel-border bg-card p-4 flex flex-col gap-3">
        <div class="flex gap-2 items-center">
          <input class="pixel-border-sm bg-background px-3 py-1.5 text-sm flex-1 font-mono" readonly value={cloneUrl} />
          <button class="pixel-border-sm px-3 py-1.5 text-sm flex items-center gap-1.5" onclick={copyCloneUrl}>
            <Copy class="size-3.5" /> {copiedClone ? "Copied!" : "Copy"}
          </button>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <BranchSelect items={branches.length ? branches : ["HEAD"]} bind:value={ref} onselect={onRefChange} />
          <a class="pixel-border-sm px-3 py-1.5 text-sm flex items-center gap-1.5 bg-card" href={archiveUrl(project.id, ref, ARCHIVE_FORMATS.ZIP.slug)}>
            <Download class="size-3.5" /> {ARCHIVE_FORMATS.ZIP.name}
          </a>
          <a class="pixel-border-sm px-3 py-1.5 text-sm flex items-center gap-1.5 bg-card" href={archiveUrl(project.id, ref, ARCHIVE_FORMATS.TAR_GZ.slug)}>
            <Download class="size-3.5" /> {ARCHIVE_FORMATS.TAR_GZ.name}
          </a>
          <span class="text-xs text-muted-foreground">username is free-form, password = git token</span>
        </div>
        {#if !isAnon}
          <details class="pixel-border-sm bg-background p-3 text-sm">
            <summary class="cursor-pointer font-bold">Git LFS setup (large files)</summary>
            <pre class="pixel-border-sm bg-card p-3 text-xs overflow-x-auto mt-2">{lfsCommandText}</pre>
            <p class="text-xs text-muted-foreground mt-2">
              Files larger than {lfsThresholdMb} MB go through LFS; patterns above match the server config. Tokens:
              <a class="underline" href={APP_ROUTES.SETTINGS}>{COPY.SETTINGS_TOKENS_LINK}</a>.
            </p>
          </details>
        {/if}
      </div>

      <!-- File browser -->
      <div class="pixel-border bg-card">
        <div class="flex items-center gap-2 px-4 py-2 border-b-2 border-border text-sm">
          {#if dirPath}
            <button class="pixel-border-sm px-2 py-0.5 text-xs flex items-center gap-1" onclick={() => goToDir(pathSegments.length - 2)}>
              <CornerUpLeft class="size-3" /> up
            </button>
            <button class="pixel-border-sm px-2 py-0.5 text-xs" onclick={() => { dirPath = ""; viewing = null; void loadTree(); }}>root</button>
            {#each pathSegments as seg, i}
              <span class="text-muted-foreground">/</span>
              {#if i < pathSegments.length - 1}
                <button class="underline" onclick={() => goToDir(i)}>{seg}</button>
              {:else}
                <span class="font-bold">{seg}</span>
              {/if}
            {/each}
          {:else}
            <span class="font-bold">Files</span>
            <span class="text-xs text-muted-foreground ml-auto">{ref}</span>
          {/if}
        </div>

        {#if codeLoading}
          <div class="p-6 text-sm text-muted-foreground">Loading...</div>
        {:else if entries.length === 0}
          <div class="p-6 text-sm text-muted-foreground">
            {treeError || "This directory is empty."} Push commits via git to see files here.
          </div>
        {:else}
          <ul>
            {#each sortedEntries as entry}
              <li class="border-b border-border last:border-b-0">
                {#if entry.type === "tree"}
                  <button class="w-full flex items-center gap-2 px-4 py-2 text-sm hover:bg-muted text-left" onclick={() => openDir(entry.name)}>
                    <FolderOpen class="size-4 text-primary" />
                    <span class="font-bold">{entry.name}</span>
                    <span class="ml-auto text-[10px] uppercase tracking-wider px-2 py-0.5 border border-border rounded-sm bg-muted">dir</span>
                  </button>
                {:else}
                  <button class="w-full flex items-center gap-2 px-4 py-2 text-sm hover:bg-muted text-left" onclick={() => openFile(entry.name)}>
                    <FileText class="size-4" />
                    <span class="font-medium">{entry.name}</span>
                    <span class="ml-auto text-[10px] uppercase tracking-wider px-2 py-0.5 border border-border rounded-sm bg-muted">file</span>
                  </button>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}
      </div>

      {#if readme}
        <div class="pixel-border bg-card p-5 markdown-body">
          {@html readme.html}
        </div>
      {/if}
    {:else if tab === "history"}
      <div class="pixel-border bg-card flex flex-col">
        {#if history.length === 0}
          <div class="p-6 text-sm text-muted-foreground">
            {historyLoading ? "Loading..." : "No commits yet. Push commits via git to see them here."}
          </div>
        {:else}
          <ul>
            {#each history as commit}
              <li class="border-b border-border last:border-b-0 px-4 py-2 flex items-center gap-3 text-sm">
                <GitCommitHorizontal class="size-4 text-primary shrink-0" />
                <span class="font-bold truncate flex-1">{commit.message}</span>
                <span class="text-xs text-muted-foreground hidden sm:inline">{commit.author}</span>
                <code class="text-xs text-muted-foreground">{commit.hash.slice(0, 7)}</code>
                <span class="text-xs text-muted-foreground hidden md:inline">{formatDate(commit.date)}</span>
                {#if !isAnon}
                  <button class="pixel-border-sm px-2 py-0.5 text-xs" onclick={() => showDiff(commit.hash)}>Diff</button>
                {/if}
              </li>
            {/each}
          </ul>
          {#if historyMore}
            <button class="pixel-border-sm px-3 py-1.5 text-sm m-3 self-start" disabled={historyLoading} onclick={() => loadHistory(true)}>
              {historyLoading ? "Loading..." : "Load more"}
            </button>
          {/if}
        {/if}
      </div>

      {#if diff}
        <div class="pixel-border bg-card p-4">
          <div class="flex items-center justify-between mb-2">
            <h3 class="font-bold">Diff</h3>
            <button class="pixel-border-sm px-2 py-1 text-xs flex items-center gap-1" onclick={() => (diff = null)}>
              <X class="size-3.5" /> Close
            </button>
          </div>
          <DiffViewer diff={diff.diff} />
        </div>
      {/if}
    {:else if tab === "activity"}
      <div class="pixel-border bg-card flex flex-col">
        {#if activity.length === 0}
          <div class="p-6 text-sm text-muted-foreground">No activity yet.</div>
        {:else}
          <div class="flex flex-col divide-y-2 divide-border">
            {#each activityByDate as [date, items]}
              <div class="px-4 py-3">
                <div class="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">{formatDate(date)}</div>
                <ul class="flex flex-col gap-2">
                  {#each items as item}
                    <li class="flex items-center gap-3 text-sm">
                      {#if item.type === "commit"}
                        <GitCommitHorizontal class="size-4 text-primary shrink-0" />
                        <span class="font-bold truncate">{String(item.message ?? "")}</span>
                        <span class="text-xs text-muted-foreground hidden sm:inline">{String(item.author ?? "")}</span>
                        <code class="text-xs text-muted-foreground">{String(item.hash ?? "").slice(0, 7)}</code>
                      {:else}
                        <Zap class="size-4 text-accent shrink-0" />
                        <span class="font-medium truncate">{String(item.event ?? "event")}</span>
                      {/if}
                      <span class="ml-auto text-xs text-muted-foreground hidden md:inline">{String(item.ts ?? "").slice(11, 16)}</span>
                    </li>
                  {/each}
                </ul>
              </div>
            {/each}
          </div>
          {#if activityMore}
            <button class="pixel-border-sm px-3 py-1.5 text-sm m-3 self-start" onclick={() => loadActivity(true)}>
              Load more
            </button>
          {/if}
        {/if}
      </div>
    {:else if tab === "settings"}
      <!-- Storage connection -->
      <section class="pixel-border bg-card p-4">
        <h3 class="font-bold mb-3">Storage connection</h3>
        <div class="flex gap-1 mb-3 border-b border-border">
          <button class:bg-muted={connTab === "s3"} class="px-4 py-2 text-sm pixel-border-sm" onclick={() => (connTab = "s3")}>S3</button>
          <button class:bg-muted={connTab === "gdrive"} class="px-4 py-2 text-sm pixel-border-sm" onclick={() => (connTab = "gdrive")}>GDrive</button>
        </div>

        {#if connTab === "s3"}
          {#if project.storageConnectionId}
            <div class="text-sm">
              <span class="text-muted-foreground">Connected:</span>
              <span class="font-medium"> {connections.find((c) => c.id === project?.storageConnectionId)?.name ?? "unknown"}</span>
              <button class="pixel-border-sm px-2 py-1 text-xs ml-3" onclick={onDisconnect}>Disconnect</button>
            </div>
          {:else}
            <div class="flex gap-2 items-end">
              <div class="flex-1">
                <div class="text-xs text-muted-foreground mb-1">Select storage connection</div>
                <select class="pixel-border-sm w-full bg-background px-3 py-2 text-sm" bind:value={selectedConnId}>
                  <option value="">-- choose --</option>
                  {#each connections as conn}
                    <option value={conn.id}>{conn.name} ({conn.bucket})</option>
                  {/each}
                </select>
              </div>
              <button class="pixel-border-sm px-4 py-2 text-sm" disabled={connecting || !selectedConnId} onclick={onConnect}>
                {connecting ? "Connecting..." : "Connect"}
              </button>
            </div>
            {#if connections.length === 0}
              <p class="text-xs text-muted-foreground mt-2">No storage connections yet.</p>
            {/if}
          {/if}
        {:else}
          <div class="text-sm text-muted-foreground">GDrive integration is next development.</div>
        {/if}
      </section>

      <!-- Backup -->
      <section class="pixel-border bg-card p-4">
        <h3 class="font-bold mb-3">Backup</h3>
        <div class="flex gap-2">
          <button class="pixel-border-sm px-3 py-1 text-sm" disabled={backingUp || !project.storageConnectionId} onclick={onBackup}>
            {backingUp ? "Backing up..." : "Backup"}
          </button>
          <button class="pixel-border-sm px-3 py-1 text-sm" disabled={!project.storageConnectionId} onclick={onRestore}>Restore</button>
        </div>
      </section>

      <!-- Visibility + danger zone -->
      <section class="pixel-border bg-card p-4">
        <h3 class="font-bold mb-3">Visibility</h3>
        <label class="text-sm flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={project.isPublic} onchange={onTogglePublic} />
          Public (anonymous read-only clone + browse)
        </label>
      </section>

      <!-- Collaborators -->
      <section class="pixel-border bg-card p-4">
        <h3 class="font-bold mb-3">Collaborators</h3>
        <div class="flex gap-2 items-end mb-3">
          <div class="flex-1">
            <span class="text-xs uppercase tracking-wider text-muted-foreground">Add user</span>
            <select class="pixel-border-sm w-full bg-background px-2 py-2 text-sm mt-1" bind:value={newCollabUserId}>
              <option value="">-- choose user --</option>
              {#each allUsers as u}
                <option value={u.id}>{u.email}</option>
              {/each}
            </select>
          </div>
          <button class="pixel-border-sm px-3 py-2 text-sm" onclick={onAddCollaborator} disabled={!newCollabUserId}>Add</button>
        </div>
        <div class="flex flex-wrap gap-x-6 gap-y-2">
          {#each PERMISSION_GROUPS as group}
            <div>
              <span class="text-xs uppercase tracking-wider text-muted-foreground">{group.label}</span>
              <div class="flex flex-col gap-1 mt-1">
                {#each group.keys as key}
                  <label class="text-xs flex items-center gap-1 cursor-pointer">
                    <input type="checkbox" checked={newCollabPerms.includes(key)} onchange={() => (newCollabPerms = togglePerm(newCollabPerms, key))} />
                    {permissionName(key)}
                  </label>
                {/each}
              </div>
            </div>
          {/each}
        </div>

        {#if collaborators.length > 0}
          <ul class="mt-3 space-y-1">
            {#each collaborators as col}
              <li class="flex items-center gap-2 text-sm border-b border-border py-1">
                <span class="flex-1 truncate">{col.email}</span>
                {#if editingCollab?.id === col.id}
                  <button class="pixel-border-sm px-2 py-1 text-xs" onclick={onSaveCollabPerms}>Save</button>
                  <button class="pixel-border-sm px-2 py-1 text-xs" onclick={() => (editingCollab = null)}>Cancel</button>
                {:else}
                  <span class="text-[10px] uppercase tracking-wider px-2 py-0.5 border border-border rounded-sm">
                    {col.permissions.length} permission{col.permissions.length === 1 ? "" : "s"}
                  </span>
                  <button class="pixel-border-sm px-2 py-1 text-xs" onclick={() => { editingCollab = col; editingPerms = [...(col.permissions as ProjectPermission[])]; }}>Edit</button>
                  <button class="pixel-border-sm px-2 py-1 text-xs text-destructive" onclick={() => onRemoveCollab(col.userId)}>Remove</button>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}

        {#if editingCollab}
          <div class="pixel-border bg-card p-4 flex flex-col gap-2 mt-3">
            <span class="text-sm font-semibold">Permissions for {editingCollab.email}</span>
            <div class="flex flex-wrap gap-x-6 gap-y-2">
              {#each PERMISSION_GROUPS as group}
                <div>
                  <span class="text-xs uppercase tracking-wider text-muted-foreground">{group.label}</span>
                  <div class="flex flex-col gap-1 mt-1">
                    {#each group.keys as key}
                      <label class="text-xs flex items-center gap-1 cursor-pointer">
                        <input type="checkbox" checked={editingPerms.includes(key)} onchange={() => (editingPerms = togglePerm(editingPerms, key))} />
                        {permissionName(key)}
                      </label>
                    {/each}
                  </div>
                </div>
              {/each}
            </div>
          </div>
        {/if}
      </section>

      <!-- Token access -->
      {#if hasPerm(PROJECT_PERMISSIONS.VIEW.slug)}
        <section class="pixel-border bg-card p-4">
          <h3 class="font-bold mb-3">Token access</h3>
          {#if projectTokens.length === 0}
            <p class="text-sm text-muted-foreground">
              No token can access this project yet. Create a token in
              <a class="underline" href={APP_ROUTES.SETTINGS}>{COPY.SETTINGS_TOKENS_LINK}</a> and select this project.
            </p>
          {:else}
            <ul class="space-y-1">
              {#each projectTokens as { token, scope }}
                <li class="flex items-center gap-2 text-sm border-b border-border py-1">
                  <span class="flex-1 truncate font-medium">{token.name}</span>
                  <span class="text-[10px] uppercase tracking-wider px-2 py-0.5 border border-border rounded-sm">
                    {scopeLabel(scope)}
                  </span>
                  <span class="text-xs text-muted-foreground">expires {formatDate(token.expiresAt)}</span>
                </li>
              {/each}
            </ul>
            <p class="text-xs text-muted-foreground mt-2">
              Manage tokens in <a class="underline" href={APP_ROUTES.SETTINGS}>{COPY.SETTINGS_TOKENS_LINK}</a>.
            </p>
          {/if}
        </section>
      {/if}

      <!-- Danger zone -->
      <section class="pixel-border bg-card p-4 border-destructive">
        <h3 class="font-bold mb-3 text-destructive">Danger zone</h3>
        <button class="pixel-border-sm px-3 py-1 text-sm text-destructive" onclick={openDeleteConfirm}>Delete project</button>
      </section>
    {/if}
  </div>

  {#if viewing}
    <div
      class="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
      role="presentation"
      onclick={(e) => { if (e.target === e.currentTarget) viewing = null; }}
      onkeydown={(e) => { if (e.key === "Escape") viewing = null; }}
    >
      <div class="w-full max-w-3xl bg-card p-5 pixel-border flex flex-col gap-3 max-h-[85vh]">
        <div class="flex items-center gap-2">
          <FileText class="size-4" />
          <span class="font-mono text-sm font-bold truncate flex-1">{viewing.path}</span>
          <span class="text-xs text-muted-foreground">{(viewing.size / 1024).toFixed(1)} KB</span>
          <button class="pixel-border-sm px-2 py-1" onclick={() => (viewing = null)}><X class="size-4" /></button>
        </div>
        {#if blobError}
          <p class="text-sm text-destructive">{blobError}</p>
        {:else if viewing.encoding === "base64"}
          <p class="text-sm text-muted-foreground">
            Binary file: preview is not available (max {MAX_FILE_BROWSER_BYTES / 1024 / 1024} MB text preview).
            Use the ZIP/TAR download to fetch it.
          </p>
        {:else}
          <pre class="bg-background pixel-border-sm p-4 text-xs overflow-auto flex-1">{viewing.content}</pre>
        {/if}
      </div>
    </div>
  {/if}

  {#if showDeleteConfirm}
    <div
      class="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
      role="presentation"
      onclick={(e) => { if (!deleting && e.target === e.currentTarget) showDeleteConfirm = false; }}
      onkeydown={(e) => { if (e.key === "Escape" && !deleting) showDeleteConfirm = false; }}
    >
      <div class="w-full max-w-sm bg-card p-5 pixel-border">
        {#if deleting}
          <h2 class="text-lg font-bold mb-4">Deleting project...</h2>
          <p class="text-sm text-muted-foreground mb-2">{deleteStep}</p>
          <div class="h-2 bg-muted overflow-hidden">
            <div class="h-full bg-primary animate-pulse w-full"></div>
          </div>
        {:else}
          <h2 class="text-lg font-bold mb-2 text-destructive">Delete project</h2>
          <p class="text-sm text-muted-foreground mb-4">
            This permanently deletes <strong class="text-foreground">{project.name}</strong> and all of its data:
            database record, local Git repository, and storage objects (LFS + backup). This cannot be undone.
          </p>
          <p class="text-sm mb-2">Type <strong class="text-foreground">{project.name}</strong> to confirm:</p>
          <input
            class="pixel-border-sm bg-background px-3 py-2 text-sm w-full mb-4"
            bind:value={deleteConfirmName}
            placeholder={project.name}
            disabled={deleting}
          />
          {#if error}<p class="text-sm text-destructive mb-2">{error}</p>{/if}
          <div class="flex gap-2 justify-end">
            <button class="pixel-border-sm px-4 py-2 text-sm" onclick={() => (showDeleteConfirm = false)}>Cancel</button>
            <button class="pixel-border-sm px-4 py-2 text-sm bg-destructive text-destructive-foreground" disabled={!canConfirmDelete} onclick={onDelete}>
              Delete
            </button>
          </div>
        {/if}
      </div>
    </div>
  {/if}
{/if}
