<script lang="ts">
  import {
    listConnections,
    getProject,
    deleteProject,
    updateProject,
    getProjectHistory,
    getProjectDiff,
    backupProject,
    restoreProject,
    getAppInfo,
    type Connection,
    type Project,
  } from "$lib/api";
  import { projectsStore } from "$lib/stores/projects.svelte";
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";
  import DiffViewer from "$lib/DiffViewer.svelte";
  import { onMount } from "svelte";
  import { gitRemoteCommands, lfsCommands, parseLfsPatterns } from "$lib/snippet";
  import { listTokens, type GitToken } from "$lib/api/tokens";
  import { scopeLabel, type TokenScope } from "$lib/constants/scopes";
  import { formatDate } from "$lib/utils";
  import { COPY_FEEDBACK_MS } from "$lib/constants/validation";
  import { APP_ROUTES, DEFAULT_GIT_BASE_URL } from "$lib/constants/paths";
  import { COPY } from "$lib/constants/copy";
  import {
    listCollaborators,
    addCollaborator,
    updateCollaborator,
    removeCollaborator,
    type Collaborator,
  } from "$lib/api/projects";
  import { listUsers, type ManagedUser } from "$lib/api";
  import { DEFAULT_COLLAB_PERMISSIONS, PERMISSION_GROUPS, PROJECT_PERMISSIONS, permissionName, type ProjectPermission } from "$lib/constants/permissions";
  import { ADMIN_ROLE } from "$lib/constants/roles";

  let project = $state<Project | null>(null);
  let connections = $state<Connection[]>([]);
  let history = $state<{ hash: string; date: string; message: string; author: string }[]>([]);
  let diff = $state<{ diff: string; files: { path: string; status: string }[] } | null>(null);
  let error = $state("");
  let message = $state("");

  let connTab = $state<"s3" | "gdrive">("s3");
  let selectedConnId = $state("");
  let connecting = $state(false);

  let backingUp = $state(false);

  // setup snippet
  let appInfo = $state<{ gitBaseUrl: string } | null>(null);
  let copied = $state({ remote: false, lfs: false });
  let tokens = $state<GitToken[]>([]);

  // delete confirm
  let showDeleteConfirm = $state(false);
  let deleteConfirmName = $state("");
  let deleting = $state(false);
  let deleteStep = $state("");

  const canConfirmDelete = $derived(project !== null && deleteConfirmName.trim() === project.name);

  // Access: myPermissions === null means admin (everything); otherwise the set.
  const isAdmin = $derived(project?.myPermissions === null);
  function hasPerm(perm: ProjectPermission): boolean {
    return isAdmin || (project?.myPermissions ?? []).includes(perm);
  }

  // Collaborators (admin only)
  let collaborators = $state<Collaborator[]>([]);
  let allUsers = $state<ManagedUser[]>([]);
  let newCollabUserId = $state("");
  let newCollabPerms = $state<ProjectPermission[]>([...DEFAULT_COLLAB_PERMISSIONS]);
  let editingCollab = $state<Collaborator | null>(null);
  let editingPerms = $state<ProjectPermission[]>([]);

  function togglePerm(list: ProjectPermission[], perm: ProjectPermission): ProjectPermission[] {
    return list.includes(perm) ? list.filter((p) => p !== perm) : [...list, perm];
  }

  const gitBaseUrl = $derived(appInfo?.gitBaseUrl ?? DEFAULT_GIT_BASE_URL);
  const remoteCommands = $derived(project ? gitRemoteCommands(gitBaseUrl, project.name) : "");
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

  async function loadProject() {
    const id = $page.params.id;
    if (!id) return;
    error = "";
    try {
      const [p, c] = await Promise.all([getProject(id), listConnections()]);
      if ($page.params.id !== id) return; // already switched to another project
      project = p.data;
      connections = c.data;
      await loadHistory();
    } catch (e) {
      if ($page.params.id === id) error = e instanceof Error ? e.message : String(e);
    }
  }

  async function loadAppInfo() {
    try {
      const res = await getAppInfo();
      appInfo = res.data;
    } catch {
      // fall back to the default base url; the snippet can still be copied
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

  async function loadHistory() {
    if (!project) return;
    const projectId = project.id;
    try {
      const res = await getProjectHistory(projectId);
      if (project?.id !== projectId) return; // project has changed
      history = res.data.commits;
    } catch (e) {
      if (project?.id === projectId) error = e instanceof Error ? e.message : String(e);
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

  // SvelteKit reuses this component across /projects/[id]; reload data when params change
  $effect(() => {
    const id = $page.params.id;
    if (!id) return;
    diff = null;
    history = [];
    error = "";
    message = "";
    selectedConnId = "";
    connTab = "s3";
    showDeleteConfirm = false;
    deleteConfirmName = "";
    void loadProject();
    void loadTokens();
    void loadCollaborators();
  });

  onMount(loadAppInfo);

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
      // progress summary from backend
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

  async function showDiff(hash: string) {
    if (!project) return;
    try {
      const res = await getProjectDiff(project.id, hash);
      diff = res.data;
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

  async function copyText(text: string, key: "remote" | "lfs") {
    try {
      await navigator.clipboard.writeText(text);
      copied[key] = true;
      setTimeout(() => (copied[key] = false), COPY_FEEDBACK_MS);
    } catch {
      // clipboard unavailable, user can copy manually
    }
  }
</script>

{#if !project}
  <p class="text-muted-foreground">Project not found.</p>
{:else}
  <div class="mb-4 flex items-center justify-between">
    <h2 class="text-xl font-bold">{project.name}</h2>
    {#if isAdmin}
      <div class="flex items-center gap-3">
        <label class="text-xs flex items-center gap-1 cursor-pointer">
          <input type="checkbox" checked={project.isPublic} onchange={onTogglePublic} />
          Public (anonymous read-only clone)
        </label>
        <button class="pixel-border-sm px-3 py-1 text-sm" onclick={openDeleteConfirm}>Delete</button>
      </div>
    {/if}
  </div>

  {#if error}<div class="mb-3 p-2 border border-destructive text-destructive text-sm">{error}</div>{/if}
  {#if message}<div class="mb-3 p-2 border border-primary text-primary text-sm">{message}</div>{/if}

  <!-- Connection tabs (admin: storage management) -->
  {#if isAdmin}
    <section class="mb-6">
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
    <section class="mb-6 flex gap-2">
      <button class="pixel-border-sm px-3 py-1 text-sm" disabled={backingUp || !project.storageConnectionId} onclick={onBackup}>
        {backingUp ? "Backing up..." : "Backup"}
      </button>
      <button class="pixel-border-sm px-3 py-1 text-sm" disabled={!project.storageConnectionId} onclick={onRestore}>Restore</button>
    </section>
  {/if}

  <!-- Setup snippet (view permission) -->
  {#if hasPerm(PROJECT_PERMISSIONS.VIEW.slug)}
    <section class="mb-6">
      <h3 class="text-base font-semibold mb-2">Setup</h3>

      <div class="mb-4">
        <div class="flex items-center justify-between mb-2">
          <span class="text-sm font-semibold">Git remote</span>
          <button class="pixel-border-sm px-3 py-1 text-xs" onclick={() => copyText(remoteCommands, "remote")}>
            {copied.remote ? "Copied!" : "Copy"}
          </button>
        </div>
        <pre class="pixel-border-sm bg-background p-3 text-xs overflow-x-auto">{remoteCommands}</pre>
        <p class="text-xs text-muted-foreground mt-2">
          Username is free-form, password = git token. Create a token in
          <a class="underline" href={APP_ROUTES.SETTINGS}>{COPY.SETTINGS_TOKENS_LINK}</a> (the token is only shown once when created).
        </p>
      </div>

      <div>
        <div class="flex items-center justify-between mb-2">
          <span class="text-sm font-semibold">Git LFS (large files)</span>
          <button class="pixel-border-sm px-3 py-1 text-xs" onclick={() => copyText(lfsCommandText, "lfs")}>
            {copied.lfs ? "Copied!" : "Copy"}
          </button>
        </div>
        <pre class="pixel-border-sm bg-background p-3 text-xs overflow-x-auto">{lfsCommandText}</pre>
        <p class="text-xs text-muted-foreground mt-2">
          Files larger than {lfsThresholdMb} MB are automatically handled by LFS; the patterns above match the server configuration.
        </p>
      </div>
    </section>
  {/if}

  <!-- Token access (view permission) -->
  {#if hasPerm(PROJECT_PERMISSIONS.VIEW.slug)}
    <section class="mb-6">
      <h3 class="text-base font-semibold mb-2">Token access</h3>
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

  <!-- Collaborators (admin only) -->
  {#if isAdmin}
    <section class="mb-6">
      <h3 class="text-base font-semibold mb-2">Collaborators</h3>
      <div class="pixel-border bg-card p-4 flex flex-col gap-3 mb-3">
        <div class="flex gap-2 items-end">
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
      </div>

      {#if collaborators.length === 0}
        <p class="text-sm text-muted-foreground">No collaborators yet.</p>
      {:else}
        <ul class="space-y-1">
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
  {/if}

  <!-- History + Diff (history permission) -->
  {#if hasPerm(PROJECT_PERMISSIONS.HISTORY.slug)}
    <section>
      <h3 class="text-base font-semibold mb-2">History</h3>
      {#if history.length === 0}
        <p class="text-sm text-muted-foreground">No commits yet.</p>
      {:else}
        <ul class="space-y-1">
          {#each history as commit}
            <li class="flex items-center gap-2 text-sm border-b border-border py-1">
              <code class="text-xs text-muted-foreground">{commit.hash.slice(0, 7)}</code>
              <span class="flex-1 truncate">{commit.message}</span>
              <span class="text-xs text-muted-foreground">{commit.date}</span>
              <button class="pixel-border-sm px-2 py-0.5 text-xs" onclick={() => showDiff(commit.hash)}>Diff</button>
            </li>
          {/each}
        </ul>
      {/if}

      {#if diff}
        <div class="mt-4">
          <h3 class="text-base font-semibold mb-2">Diff</h3>
          <DiffViewer diff={diff.diff} />
        </div>
      {/if}
    </section>
  {/if}
{/if}

{#if showDeleteConfirm && project}
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
