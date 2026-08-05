<script lang="ts">
  import { listConnections, listProjects, createProject, getMe, logout, type Connection, type Project, type CurrentUser } from "$lib/api";
  import { goto } from "$app/navigation";
  import { onMount } from "svelte";
  import ThemeToggle from "$lib/ThemeToggle.svelte";

  let { children }: { children?: import("svelte").Snippet } = $props();

  let loading = $state(true);
  let currentUser = $state<CurrentUser | null>(null);
  let connections = $state<Connection[]>([]);
  let projects = $state<Project[]>([]);
  let error = $state("");
  let showCreate = $state(false);
  let newName = $state("");
  let newConnId = $state("");

  const activeId = $derived(
    typeof window !== "undefined"
      ? window.location.pathname.match(/^\/projects\/([^/]+)/)?.[1] ?? null
      : null
  );

  async function load() {
    try {
      const [c, p] = await Promise.all([listConnections(), listProjects()]);
      connections = c.data;
      projects = p.data;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  onMount(async () => {
    try {
      const me = await getMe();
      currentUser = me.data;
      await load();
    } catch {
      await goto("/login");
      return;
    } finally {
      loading = false;
    }
  });

  async function onLogout() {
    try {
      await logout();
      await goto("/login");
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  async function onCreateProject() {
    if (!newName.trim()) return;
    error = "";
    try {
      const res = await createProject({ name: newName.trim(), storageConnectionId: newConnId || null });
      showCreate = false;
      newName = "";
      newConnId = "";
      await load();
      await goto(`/projects/${res.data.id}`);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }
</script>

{#if loading}
  <div class="min-h-screen flex items-center justify-center bg-background text-foreground">
    <p class="text-muted-foreground">Loading...</p>
  </div>
{:else if currentUser}
  <div class="flex min-h-screen bg-background text-foreground">
    <!-- Sidebar -->
    <aside class="w-64 shrink-0 border-r border-border flex flex-col bg-card">
      <div class="p-4 border-b border-border">
        <a href="/" class="text-xl font-bold tracking-widest pixel-border inline-block px-3 py-1 bg-background">SiGit</a>
      </div>

      <div class="p-4 text-xs uppercase tracking-wider text-muted-foreground">Projects</div>
      <nav class="flex-1 overflow-y-auto px-2">
        {#if projects.length === 0}
          <div class="p-3 text-sm text-muted-foreground">No projects yet. Create your first project.</div>
        {:else}
          {#each projects as p}
            <a
              href={`/projects/${p.id}`}
              class:bg-muted={activeId === p.id}
              class="block w-full text-left px-3 py-2 rounded-sm mb-1 hover:bg-muted truncate"
            >
              {p.name}
            </a>
          {/each}
        {/if}
      </nav>

      <div class="p-3 border-t border-border">
        <button class="pixel-border-sm w-full px-3 py-2 bg-background text-center" onclick={() => (showCreate = true)}>
          + New Project
        </button>
      </div>
    </aside>

    <!-- Main -->
    <div class="flex-1 flex flex-col min-w-0">
      <!-- Topbar -->
      <header class="h-14 border-b border-border flex items-center justify-between px-4 bg-card">
        <div class="flex items-center gap-2 text-sm">
          <a href="/" class="pixel-border-sm px-3 py-1">Projects</a>
          <a href="/logs" class="pixel-border-sm px-3 py-1">Logs</a>
          <a href="/settings" class="pixel-border-sm px-3 py-1">Settings</a>
        </div>
        <div class="flex items-center gap-2">
          <span class="text-sm text-muted-foreground">{currentUser.email}</span>
          <ThemeToggle />
          <button class="pixel-border-sm px-3 py-1 text-sm" onclick={onLogout}>Logout</button>
        </div>
      </header>

      <main class="flex-1 overflow-y-auto p-4">
        {#if error}<div class="mb-3 p-2 border border-destructive text-destructive text-sm">{error}</div>{/if}
        {@render children?.()}
      </main>
    </div>
  </div>

  {#if showCreate}
    <div class="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onclick={() => (showCreate = false)}>
      <div class="w-full max-w-sm bg-card p-5 pixel-border" onclick={(e) => e.stopPropagation()}>
        <h2 class="text-lg font-bold mb-4">New Project</h2>
        <div class="flex flex-col gap-3">
          <input class="pixel-border-sm bg-background px-3 py-2 text-sm" bind:value={newName} placeholder="Project name" />
          <div>
            <div class="text-xs text-muted-foreground mb-1">Storage connection (optional)</div>
            <select class="pixel-border-sm w-full bg-background px-3 py-2 text-sm" bind:value={newConnId}>
              <option value="">-- none --</option>
              {#each connections as conn}
                <option value={conn.id}>{conn.name} ({conn.bucket})</option>
              {/each}
            </select>
          </div>
          {#if error}<p class="text-sm text-destructive">{error}</p>{/if}
          <button class="pixel-border px-4 py-2 text-sm" disabled={!newName.trim()} onclick={onCreateProject}>Create</button>
        </div>
      </div>
    </div>
  {/if}
{/if}
