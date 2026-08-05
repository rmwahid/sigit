<script lang="ts">
  import {
    listConnections,
    getProject,
    deleteProject,
    updateProject,
    pushProject,
    getProjectHistory,
    getProjectDiff,
    backupProject,
    restoreProject,
    type Connection,
    type Project,
  } from "$lib/api";
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";
  import DiffViewer from "$lib/DiffViewer.svelte";
  import { onMount } from "svelte";

  let project = $state<Project | null>(null);
  let connections = $state<Connection[]>([]);
  let history = $state<{ hash: string; date: string; message: string; author: string }[]>([]);
  let diff = $state<{ diff: string; files: { path: string; status: string }[] } | null>(null);
  let error = $state("");
  let message = $state("");

  let connTab = $state<"s3" | "gdrive">("s3");
  let selectedConnId = $state("");
  let connecting = $state(false);

  let pushMessage = $state("");
  let pushPassphrase = $state("");
  let selectedFiles = $state<FileList | null>(null);

  let backingUp = $state(false);

  async function loadProject() {
    const id = $page.params.id;
    if (!id) return;
    error = "";
    try {
      const [p, c] = await Promise.all([getProject(id), listConnections()]);
      project = p.data;
      connections = c.data;
      await loadHistory();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  async function loadHistory() {
    if (!project) return;
    try {
      const res = await getProjectHistory(project.id);
      history = res.data.commits;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  onMount(loadProject);

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

  async function onDelete() {
    if (!project) return;
    if (!confirm(`Delete project "${project.name}"?`)) return;
    try {
      await deleteProject(project.id);
      await goto("/");
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  async function onPush(e: SubmitEvent) {
    e.preventDefault();
    if (!project || !selectedFiles || selectedFiles.length === 0) return;
    if (!project.storageConnectionId) {
      error = "Connect storage first before pushing";
      return;
    }
    try {
      const result = await pushProject(project.id, selectedFiles, pushMessage, pushPassphrase || undefined);
      message = `Pushed ${result.data.files.length} files, commit ${result.data.commitHash.slice(0, 7)}`;
      await loadHistory();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
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
</script>

{#if !project}
  <p class="text-muted-foreground">Project not found.</p>
{:else}
  <div class="mb-4 flex items-center justify-between">
    <h2 class="text-xl font-bold">{project.name}</h2>
    <button class="pixel-border-sm px-3 py-1 text-sm" onclick={onDelete}>Delete</button>
  </div>

  {#if error}<div class="mb-3 p-2 border border-destructive text-destructive text-sm">{error}</div>{/if}
  {#if message}<div class="mb-3 p-2 border border-primary text-primary text-sm">{message}</div>{/if}

  <!-- Connection tabs -->
  <section class="mb-6">
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
  <section class="mb-6 flex gap-2">
    <button class="pixel-border-sm px-3 py-1 text-sm" disabled={backingUp || !project.storageConnectionId} onclick={onBackup}>
      {backingUp ? "Backing up..." : "Backup"}
    </button>
    <button class="pixel-border-sm px-3 py-1 text-sm" disabled={!project.storageConnectionId} onclick={onRestore}>Restore</button>
  </section>

  <!-- Push -->
  <section class="mb-6">
    <h3 class="text-base font-semibold mb-2">Push Files</h3>
    <form onsubmit={onPush} class="flex flex-col gap-2">
      <input class="pixel-border-sm bg-background px-3 py-2 text-sm" bind:value={pushMessage} placeholder="Commit message" required />
      <input class="text-sm" type="file" multiple bind:files={selectedFiles} required />
      {#if project.useEncryption}
        <input class="pixel-border-sm bg-background px-3 py-2 text-sm" type="password" bind:value={pushPassphrase} placeholder="Passphrase" required />
      {/if}
      <button type="submit" class="pixel-border-sm px-4 py-2 text-sm self-start" disabled={!project.storageConnectionId}>Push</button>
    </form>
  </section>

  <!-- History + Diff -->
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
