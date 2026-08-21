<script lang="ts">
  import { COPY } from "$lib/constants/copy";
  import { APP_ROUTES } from "$lib/constants/paths";
  import { scopeLabel, type TokenScope } from "$lib/constants/scopes";
  import { formatDate } from "$lib/utils";
  import { MAX_PROTECTION_REQUIRED_APPROVALS } from "$lib/constants/validation";
  import { PERMISSION_GROUPS, permissionName, type ProjectPermission } from "$lib/constants/permissions";
  import type { Connection, ManagedUser, Project, ProtectionRule } from "$lib/api";
  import type { Collaborator } from "$lib/api/projects";
  import type { GitToken } from "$lib/api/tokens";

  // Settings tab: storage, backup, visibility, collaborators, token access,
  // branch protection, danger zone. All state and handlers live in the project
  // page controller.
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
    protectionRules,
    protectionLoading,
    protectionError,
    showProtectionModal = $bindable(),
    protectionSaving,
    newProtectionPattern = $bindable(),
    newProtectionRequirePr = $bindable(),
    newProtectionApprovals = $bindable(),
    newProtectionBlockRequest = $bindable(),
    newProtectionBlockForce = $bindable(),
    newProtectionBlockDelete = $bindable(),
    newProtectionRestrictPush = $bindable(),
    newProtectionRestrictPushIds = $bindable(),
    newProtectionRestrictMergeIds = $bindable(),
    newProtectionAllowBypass = $bindable(),
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
    onCreateProtectionRule,
    onUpdateProtectionRule,
    onDeleteProtectionRule,
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
    protectionRules: ProtectionRule[];
    protectionLoading: boolean;
    protectionError: string;
    showProtectionModal?: boolean;
    protectionSaving: boolean;
    newProtectionPattern: string;
    newProtectionRequirePr: boolean;
    newProtectionApprovals: number;
    newProtectionBlockRequest: boolean;
    newProtectionBlockForce: boolean;
    newProtectionBlockDelete: boolean;
    newProtectionRestrictPush: boolean;
    newProtectionRestrictPushIds: string[];
    newProtectionRestrictMergeIds: string[];
    newProtectionAllowBypass: boolean;
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
    onCreateProtectionRule: () => void;
    onUpdateProtectionRule: (rule: ProtectionRule, patch: Partial<import("$lib/api/branch-protection").ProtectionRuleInput>) => void;
    onDeleteProtectionRule: (rule: ProtectionRule) => void;
  } = $props();

  function s(n: number): string {
    return n === 1 ? "" : "s";
  }

  function toggleId(list: string[], id: string, set: (v: string[]) => void): void {
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  }
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

  <!-- Branch protection -->
  {#if hasPerm("push")}
    <section class="pixel-border bg-card p-4">
      <div class="flex items-center justify-between mb-3">
        <h3 class="font-bold">Branch protection</h3>
        <button class="pixel-border-sm px-2 py-1 text-xs" onclick={() => (showProtectionModal = true)}>Add rule</button>
      </div>
      {#if protectionError}
        <p class="text-xs text-destructive mb-2">{protectionError}</p>
      {/if}
      {#if protectionLoading}
        <p class="text-sm text-muted-foreground">Loading...</p>
      {:else if protectionRules.length === 0}
        <p class="text-sm text-muted-foreground">
          No rules yet. Protect a branch from direct pushes, force pushes and deletion.
        </p>
      {:else}
        <ul class="space-y-2">
          {#each protectionRules as rule}
            <li class="border border-border rounded-sm p-2 flex items-start gap-2">
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                  <code class="text-xs font-bold bg-muted px-1.5 py-0.5 rounded-sm">{rule.branchPattern}</code>
                  <label class="text-xs flex items-center gap-1 cursor-pointer">
                    <input type="checkbox" checked={rule.requirePr} onchange={() => onUpdateProtectionRule(rule, { requirePr: !rule.requirePr })} />
                    Require PR
                  </label>
                  <label class="text-xs flex items-center gap-1 cursor-pointer">
                    <input type="checkbox" checked={rule.blockForcePush} onchange={() => onUpdateProtectionRule(rule, { blockForcePush: !rule.blockForcePush })} />
                    Block force push
                  </label>
                  <label class="text-xs flex items-center gap-1 cursor-pointer">
                    <input type="checkbox" checked={rule.blockDeletion} onchange={() => onUpdateProtectionRule(rule, { blockDeletion: !rule.blockDeletion })} />
                    Block deletion
                  </label>
                  <label class="text-xs flex items-center gap-1 cursor-pointer">
                    <input type="checkbox" checked={rule.blockOnRequestChanges} onchange={() => onUpdateProtectionRule(rule, { blockOnRequestChanges: !rule.blockOnRequestChanges })} />
                    Block on request-changes
                  </label>
                </div>
                <div class="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">
                  {rule.requiredApprovals} approval{s(rule.requiredApprovals)}
                  {#if rule.restrictPushUserIds.length > 0}· restricted push{/if}
                  {#if rule.restrictMergeUserIds.length > 0}· restricted merge{/if}
                  {#if rule.allowAdminBypass}· admin bypass{/if}
                </div>
              </div>
              <button class="pixel-border-sm px-2 py-1 text-xs text-destructive shrink-0" onclick={() => onDeleteProtectionRule(rule)}>Delete</button>
            </li>
          {/each}
        </ul>
      {/if}

      <!-- Create/edit modal -->
      {#if showProtectionModal}
        <div class="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" role="presentation">
          <div class="w-full max-w-md bg-card p-5 pixel-border flex flex-col gap-3 max-h-[85vh] overflow-y-auto">
            <div class="flex items-center justify-between">
              <span class="font-bold">Add branch protection rule</span>
              <button class="pixel-border-sm px-2 py-1 text-xs" onclick={() => (showProtectionModal = false)}>Close</button>
            </div>

            <div>
              <span class="text-xs uppercase tracking-wider text-muted-foreground">Branch pattern</span>
              <input
                class="pixel-border-sm w-full bg-background px-3 py-2 text-sm mt-1"
                placeholder="main, release/*, *"
                bind:value={newProtectionPattern}
              />
            </div>

            <div class="flex flex-col gap-1.5 text-sm">
              <label class="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" bind:checked={newProtectionRequirePr} />
                Require pull requests before merging
              </label>
              <label class="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" bind:checked={newProtectionBlockForce} />
                Block force pushes
              </label>
              <label class="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" bind:checked={newProtectionBlockDelete} />
                Block branch deletion
              </label>
              <label class="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" bind:checked={newProtectionBlockRequest} />
                Block merging while changes are requested
              </label>
            </div>

            <div>
              <span class="text-xs uppercase tracking-wider text-muted-foreground">Required approvals (0 = none)</span>
              <input type="number" min="0" max={MAX_PROTECTION_REQUIRED_APPROVALS} bind:value={newProtectionApprovals} class="pixel-border-sm w-full bg-background px-3 py-2 text-sm mt-1" />
            </div>

            <div class="flex flex-col gap-1.5 text-sm">
              <label class="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" bind:checked={newProtectionRestrictPush} />
                Restrict pushes to these users
              </label>
              {#if newProtectionRestrictPush}
                <div class="flex flex-wrap gap-1">
                  {#each allUsers as u}
                    <label class="text-xs flex items-center gap-1 cursor-pointer border border-border rounded-sm px-2 py-1">
                      <input type="checkbox" checked={newProtectionRestrictPushIds.includes(u.id)} onchange={() => toggleId(newProtectionRestrictPushIds, u.id, (v) => (newProtectionRestrictPushIds = v))} />
                      {u.email}
                    </label>
                  {/each}
                </div>
              {/if}

              <span class="text-xs uppercase tracking-wider text-muted-foreground mt-1">Restrict merges to these users</span>
              <div class="flex flex-wrap gap-1">
                {#each allUsers as u}
                  <label class="text-xs flex items-center gap-1 cursor-pointer border border-border rounded-sm px-2 py-1">
                    <input type="checkbox" checked={newProtectionRestrictMergeIds.includes(u.id)} onchange={() => toggleId(newProtectionRestrictMergeIds, u.id, (v) => (newProtectionRestrictMergeIds = v))} />
                    {u.email}
                  </label>
                {/each}
              </div>

              <label class="flex items-center gap-2 cursor-pointer mt-1">
                <input type="checkbox" bind:checked={newProtectionAllowBypass} />
                Allow site admin to bypass merge/push restrictions
              </label>
            </div>

            <div class="flex gap-2 justify-end mt-1">
              <button class="pixel-border-sm px-3 py-2 text-sm" disabled={protectionSaving} onclick={() => void onCreateProtectionRule()}>
                {protectionSaving ? "Saving..." : "Add rule"}
              </button>
            </div>
          </div>
        </div>
      {/if}
    </section>
  {/if}

  <!-- Danger zone -->
  <section class="pixel-border bg-card p-4 border-destructive">
    <h3 class="font-bold mb-3 text-destructive">Danger zone</h3>
    <button class="pixel-border-sm px-3 py-1 text-sm text-destructive" onclick={openDeleteConfirm}>Delete project</button>
  </section>
</div>
