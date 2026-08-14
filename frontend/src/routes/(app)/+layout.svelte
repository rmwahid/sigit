<script lang="ts">
  import { createProjectWithConnection, getMe, logout, type CurrentUser } from "$lib/api";
  import { ADMIN_ROLE } from "$lib/constants/roles";
  import { APP_ROUTES } from "$lib/constants/paths";
  import { projectsStore } from "$lib/stores/projects.svelte";
  import { goto } from "$app/navigation";
  import { onMount } from "svelte";
  import ThemeToggle from "$lib/ThemeToggle.svelte";

  let { children }: { children?: import("svelte").Snippet } = $props();

  let loading = $state(true);
  let currentUser = $state<CurrentUser | null>(null);
  let error = $state("");
  let showCreate = $state(false);
  let creating = $state(false);
  let connTab = $state<"s3" | "gdrive">("s3");
  let newName = $state("");
  const PROJECT_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*[A-Za-z0-9]$/;
  const nameValid = $derived(newName.length >= 2 && newName.length <= 64 && PROJECT_NAME_RE.test(newName));

  // S3 connection form (create inside project modal)
  let s3Name = $state("");
  let s3Endpoint = $state("https://fsn1.your-objectstorage.com");
  let s3Region = $state("eu-central");
  let s3AccessKeyId = $state("");
  let s3SecretAccessKey = $state("");
  let s3Bucket = $state("");

  let projects = $derived(projectsStore.list);

  const activeId = $derived(
    typeof window !== "undefined"
      ? window.location.pathname.match(/^\/projects\/([^/]+)/)?.[1] ?? null
      : null
  );

  async function load() {
    try {
      await projectsStore.refresh();
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

  function resetForm() {
    showCreate = false;
    creating = false;
    newName = "";
    s3Name = "";
    s3Endpoint = "https://fsn1.your-objectstorage.com";
    s3Region = "eu-central";
    s3AccessKeyId = "";
    s3SecretAccessKey = "";
    s3Bucket = "";
    error = "";
  }

  async function onCreateProject() {
    if (!newName.trim() || connTab !== "s3") return;
    if (!s3Name.trim() || !s3AccessKeyId.trim() || !s3SecretAccessKey.trim() || !s3Bucket.trim()) {
      error = "Fill all storage connection fields";
      return;
    }
    creating = true;
    error = "";
    try {
      const res = await createProjectWithConnection({
        name: newName.trim(),
        connection: {
          name: s3Name.trim(),
          endpoint: s3Endpoint.trim(),
          region: s3Region.trim(),
          accessKeyId: s3AccessKeyId.trim(),
          secretAccessKey: s3SecretAccessKey.trim(),
          bucket: s3Bucket.trim(),
        },
      });
      resetForm();
      await load();
      await goto(`/projects/${res.data.id}`);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      creating = false;
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
        <a href={APP_ROUTES.ROOT} class="text-xl font-bold tracking-widest pixel-border inline-block px-3 py-1 bg-background">SiGit</a>
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
          <a href={APP_ROUTES.ROOT} class="pixel-border-sm px-3 py-1">Projects</a>
          <a href={APP_ROUTES.EXPLORE} class="pixel-border-sm px-3 py-1 bg-card">Explore</a>
          {#if currentUser.role === ADMIN_ROLE}
            <a href={APP_ROUTES.LOGS} class="pixel-border-sm px-3 py-1">Logs</a>
          {/if}
          <a href={APP_ROUTES.SETTINGS} class="pixel-border-sm px-3 py-1">Settings</a>
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
    <div
      class="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
      role="presentation"
      onclick={(e) => { if (!creating && e.target === e.currentTarget) showCreate = false; }}
      onkeydown={(e) => { if (e.key === "Escape" && !creating) showCreate = false; }}
    >
      <div class="w-full max-w-md bg-card p-5 pixel-border">
        <h2 class="text-lg font-bold mb-4">New Project</h2>
        <div class="flex flex-col gap-3">
          <input class="pixel-border-sm bg-background px-3 py-2 text-sm" bind:value={newName} placeholder="Project name (e.g. my-project)" disabled={creating} />
          {#if newName && !nameValid}<p class="text-xs text-destructive">Letters, numbers, dashes, or underscores (no spaces, e.g. my-project or NotesApp)</p>{/if}

          <!-- Provider tabs -->
          <div class="flex gap-1 border-b border-border">
            <button class:bg-muted={connTab === "s3"} class="px-4 py-2 text-sm pixel-border-sm" disabled={creating} onclick={() => (connTab = "s3")}>S3</button>
            <button class:bg-muted={connTab === "gdrive"} class="px-4 py-2 text-sm pixel-border-sm" disabled={creating} onclick={() => (connTab = "gdrive")}>GDrive</button>
          </div>

          {#if connTab === "s3"}
            <div class="flex flex-col gap-2">
              <input class="pixel-border-sm bg-background px-3 py-2 text-sm" bind:value={s3Name} placeholder="Connection name" disabled={creating} />
              <input class="pixel-border-sm bg-background px-3 py-2 text-sm" bind:value={s3Endpoint} placeholder="Endpoint" disabled={creating} />
              <input class="pixel-border-sm bg-background px-3 py-2 text-sm" bind:value={s3Region} placeholder="Region" disabled={creating} />
              <input class="pixel-border-sm bg-background px-3 py-2 text-sm" bind:value={s3AccessKeyId} placeholder="Access Key ID" disabled={creating} />
              <input class="pixel-border-sm bg-background px-3 py-2 text-sm" type="password" bind:value={s3SecretAccessKey} placeholder="Secret Access Key" disabled={creating} />
              <input class="pixel-border-sm bg-background px-3 py-2 text-sm" bind:value={s3Bucket} placeholder="Bucket" disabled={creating} />
            </div>
          {:else}
            <div class="text-sm text-muted-foreground py-2">GDrive integration is next development.</div>
          {/if}

          {#if error}<p class="text-sm text-destructive mt-2">{error}</p>{/if}
          <button
            class="pixel-border px-4 py-2 text-sm mt-4"
            disabled={creating || !nameValid || connTab !== "s3" || !s3Name.trim() || !s3AccessKeyId.trim() || !s3SecretAccessKey.trim() || !s3Bucket.trim()}
            onclick={onCreateProject}
          >
            {creating ? "Creating..." : "Create Project"}
          </button>
        </div>
      </div>
    </div>
  {/if}
{/if}
