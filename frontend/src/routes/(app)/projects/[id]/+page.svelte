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

  // delete confirm
  let showDeleteConfirm = $state(false);
  let deleteConfirmName = $state("");
  let deleting = $state(false);
  let deleteStep = $state("");

  const canConfirmDelete = $derived(project !== null && deleteConfirmName.trim() === project.name);

  const gitBaseUrl = $derived(appInfo?.gitBaseUrl ?? "http://localhost:3000");
  const remoteCommands = $derived(project ? gitRemoteCommands(gitBaseUrl, project.name) : "");
  const lfsPatterns = $derived(project ? parseLfsPatterns(project.lfsPatterns) : []);
  const lfsCommandText = $derived(lfsCommands(lfsPatterns));
  const lfsThresholdMb = $derived(project ? Math.round(project.lfsSizeThreshold / (1024 * 1024)) : 0);

  async function loadProject() {
    const id = $page.params.id;
    if (!id) return;
    error = "";
    try {
      const [p, c] = await Promise.all([getProject(id), listConnections()]);
      if ($page.params.id !== id) return; // sudah pindah ke project lain
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
      // fallback ke base url default; snippet tetap bisa disalin
    }
  }

  async function loadHistory() {
    if (!project) return;
    const projectId = project.id;
    try {
      const res = await getProjectHistory(projectId);
      if (project?.id !== projectId) return; // project sudah berganti
      history = res.data.commits;
    } catch (e) {
      if (project?.id === projectId) error = e instanceof Error ? e.message : String(e);
    }
  }

  // SvelteKit memakai ulang komponen ini antar /projects/[id]; reload data saat params berubah
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
      setTimeout(() => (copied[key] = false), 1500);
    } catch {
      // clipboard tidak tersedia, user bisa salin manual
    }
  }
</script>

{#if !project}
  <p class="text-muted-foreground">Project not found.</p>
{:else}
  <div class="mb-4 flex items-center justify-between">
    <h2 class="text-xl font-bold">{project.name}</h2>
    <button class="pixel-border-sm px-3 py-1 text-sm" onclick={openDeleteConfirm}>Delete</button>
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

  <!-- Setup snippet -->
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
        Username bebas, password = git token. Buat token di
        <a class="underline" href="/settings">Settings → Tokens</a> (token hanya muncul sekali saat dibuat).
      </p>
    </div>

    <div>
      <div class="flex items-center justify-between mb-2">
        <span class="text-sm font-semibold">Git LFS (file besar)</span>
        <button class="pixel-border-sm px-3 py-1 text-xs" onclick={() => copyText(lfsCommandText, "lfs")}>
          {copied.lfs ? "Copied!" : "Copy"}
        </button>
      </div>
      <pre class="pixel-border-sm bg-background p-3 text-xs overflow-x-auto">{lfsCommandText}</pre>
      <p class="text-xs text-muted-foreground mt-2">
        File lebih dari {lfsThresholdMb} MB otomatis ditangani LFS; pola di atas sinkron dengan konfigurasi server.
      </p>
    </div>
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
