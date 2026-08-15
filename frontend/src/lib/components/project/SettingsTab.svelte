<script lang="ts">
  import { COPY } from "$lib/constants/copy";
  import { APP_ROUTES } from "$lib/constants/paths";
  import { scopeLabel, type TokenScope } from "$lib/constants/scopes";
  import { formatDate } from "$lib/utils";
  import { PERMISSION_GROUPS, permissionName, type ProjectPermission } from "$lib/constants/permissions";
  import type { Connection, ManagedUser, Project } from "$lib/api";
  import type { Collaborator } from "$lib/api/projects";
  import type { GitToken } from "$lib/api/tokens";

  // Settings tab: storage, backup, visibility, collaborators, token access,
  // danger zone. All state and handlers live in the project page.
  let {
    project,
    connections,
    connTab = $bindable(),
    selectedConnId = $bindable(),
    connecting,
    backingUp,
    collaborators,
    allUsers,
    newCollabUserId = $bindable(),
    newCollabPerms = $bindable(),
    editingCollab = $bindable(),
    editingPerms = $bindable(),
    projectTokens,
    hasPerm,
    onConnect,
    onDisconnect,
    onBackup,
    onRestore,
    onTogglePublic,
    openDeleteConfirm,
    onAddCollaborator,
    onSaveCollabPerms,
    onRemoveCollab,
    togglePerm,
  }: {
    project: Project;
    connections: Connection[];
    connTab?: "s3" | "gdrive";
    selectedConnId?: string;
    connecting: boolean;
    backingUp: boolean;
    collaborators: Collaborator[];
    allUsers: ManagedUser[];
    newCollabUserId: string;
    newCollabPerms: ProjectPermission[];
    editingCollab: Collaborator | null;
    editingPerms: ProjectPermission[];
    projectTokens: { token: GitToken; scope: TokenScope }[];
    hasPerm: (perm: ProjectPermission) => boolean;
    onConnect: () => void;
    onDisconnect: () => void;
    onBackup: () => void;
    onRestore: () => void;
    onTogglePublic: () => void;
    openDeleteConfirm: () => void;
    onAddCollaborator: () => void;
    onSaveCollabPerms: () => void;
    onRemoveCollab: (userId: string) => void;
    togglePerm: (list: ProjectPermission[], perm: ProjectPermission) => ProjectPermission[];
  } = $props();
</script>

<div class="flex flex-col gap-4">
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
          <span class="font-medium"> {connections.find((c) => c.id === project.storageConnectionId)?.name ?? "unknown"}</span>
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

  <!-- Visibility -->
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
  {#if hasPerm("view")}
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
</div>
