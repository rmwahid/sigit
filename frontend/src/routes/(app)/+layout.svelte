<script lang="ts">
  import { createProjectWithConnection, getMe, logout, type CurrentUser } from "$lib/api";
  import { ADMIN_ROLE } from "$lib/constants/roles";
  import { APP_ROUTES, userProfileHref } from "$lib/constants/paths";
  import { projectsStore } from "$lib/stores/projects.svelte";
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";
  import { onMount } from "svelte";
  import ThemeToggle from "$lib/ThemeToggle.svelte";
  import { createModal } from "$lib/stores/create-modal.svelte";
  import HangingTag from "$lib/components/decor/HangingTag.svelte";
  import Starburst from "$lib/components/decor/Starburst.svelte";
  import Squiggle from "$lib/components/decor/Squiggle.svelte";
  import { Rocket } from "lucide-svelte";

  let { children }: { children?: import("svelte").Snippet } = $props();

  let loading = $state(true);
  let currentUser = $state<CurrentUser | null>(null);
  let error = $state("");
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
      // Anonymous: handled by the $effect below (public project pages only).
    } finally {
      loading = false;
    }
  });

  // Anonymous users may only browse public project pages. Every other route
  // bounces to the public explore page (which offers Sign in). Reactive, so it
  // also covers client-side navigation after the initial mount (not just the
  // first load, like onMount would).
  $effect(() => {
    if (loading || currentUser) return;
    if (/^\/projects\/[^/]+\/?$/.test($page.url.pathname)) return;
    void goto(APP_ROUTES.EXPLORE);
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
    createModal.open = false;
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
  <div class="relative flex min-h-screen bg-background text-foreground flex-col">
    <!-- Topbar -->
    <header class="h-14 border-b-2 border-border flex items-center justify-between px-4 bg-card">
      <div class="flex items-center gap-2 text-sm">
        <a href={APP_ROUTES.ROOT} class="text-xl font-bold tracking-tight pixel-border-sm px-3 py-1 bg-background">
          <span class="nb-mark">SiGit</span>
        </a>
        <a href={APP_ROUTES.ROOT} class="pixel-border-sm px-3 py-1">Projects</a>
        {#if currentUser.role === ADMIN_ROLE}
          <a href={APP_ROUTES.LOGS} class="pixel-border-sm px-3 py-1">Logs</a>
        {/if}
        <a href={APP_ROUTES.SETTINGS} class="pixel-border-sm px-3 py-1">Settings</a>
      </div>
      <div class="flex items-center gap-2">
        <a href={userProfileHref(currentUser.email)} class="text-sm text-muted-foreground pixel-border-sm px-3 py-1 hover:bg-muted">
          {currentUser.email}
        </a>
        <ThemeToggle />
        <button class="pixel-border-sm px-3 py-1 text-sm" onclick={onLogout}>Logout</button>
      </div>
    </header>

    <!-- Hanging create trigger: string starts exactly at the topbar bottom edge -->
    <HangingTag
      text="New Project"
      tilt="-rotate-3"
      class="absolute top-[54px] right-8 hidden md:flex text-border"
      onclick={() => (createModal.open = true)}
    />

    <main class="flex-1 overflow-y-auto p-4">
      {#if error}<div class="mb-3 p-2 border border-destructive text-destructive text-sm">{error}</div>{/if}
      {@render children?.()}
    </main>
  </div>

  {#if createModal.open}    <div
      class="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
      role="presentation"
      onclick={(e) => { if (!creating && e.target === e.currentTarget) createModal.open = false; }}
      onkeydown={(e) => { if (e.key === "Escape" && !creating) createModal.open = false; }}
    >
      <div class="relative w-full max-w-md bg-card p-5 pixel-border">
        <Starburst class="absolute -top-3 -right-3 size-8 text-accent" />
        <div class="mb-4">
          <h2 class="flex items-center gap-2 text-lg font-bold">
            <Rocket class="size-5 text-primary" /> New Project
          </h2>
          <Squiggle class="h-2 w-24 text-accent mt-1" />
        </div>
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
            class="pixel-border px-4 py-2 text-sm mt-4 font-bold bg-primary text-primary-foreground"
            disabled={creating || !nameValid || connTab !== "s3" || !s3Name.trim() || !s3AccessKeyId.trim() || !s3SecretAccessKey.trim() || !s3Bucket.trim()}
            onclick={onCreateProject}
          >
            {creating ? "Creating..." : "Create Project"}
          </button>
        </div>
      </div>
    </div>
  {/if}
{:else}
  <!-- Anonymous shell: only public project pages land here -->
  <div class="relative flex min-h-screen bg-background text-foreground flex-col">
    <header class="h-14 border-b-2 border-border flex items-center justify-between px-4 bg-card">
      <div class="flex items-center gap-2 text-sm">
        <a href={APP_ROUTES.EXPLORE} class="text-xl font-bold tracking-tight pixel-border-sm px-3 py-1 bg-background">
          <span class="nb-mark">SiGit</span>
        </a>
        <a href={APP_ROUTES.EXPLORE} class="pixel-border-sm px-3 py-1 bg-primary text-primary-foreground">Explore</a>
      </div>
      <div class="flex items-center gap-2">
        <ThemeToggle />
        <a href="/login" class="pixel-border-sm px-3 py-1 text-sm">Sign in</a>
      </div>
    </header>

    <main class="flex-1 overflow-y-auto p-4">
      {@render children?.()}
    </main>
  </div>
{/if}
