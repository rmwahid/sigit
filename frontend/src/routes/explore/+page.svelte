<script lang="ts">
  import { listPublicProjects, type PublicProject } from "$lib/api/explore";
  import { GitBranch, Landmark } from "lucide-svelte";
  import PublicShell from "$lib/components/PublicShell.svelte";
  import Squiggle from "$lib/components/decor/Squiggle.svelte";

  let projects = $state<PublicProject[]>([]);
  let loaded = $state(false);

  async function init() {
    try {
      const res = await listPublicProjects();
      projects = res.data;
    } catch {
      // empty explore on failure
    }
    loaded = true;
  }

  init();
</script>

<svelte:head>
  <title>Explore - SiGit</title>
</svelte:head>

<PublicShell>
  <h1 class="flex items-center gap-2 text-3xl font-extrabold mb-2">
    <Landmark class="size-7 text-primary" aria-hidden="true" />
    <span><span class="nb-mark">Explore</span> public projects</span>
  </h1>
  <Squiggle class="h-2.5 w-40 mb-6 text-accent" />
  {#if !loaded}
    <p class="text-muted-foreground">Loading...</p>
  {:else if projects.length === 0}
    <div class="pixel-border nb-dashed bg-card p-8 text-center text-muted-foreground">
      <p class="text-lg font-bold">No public projects yet</p>
      <p class="text-sm mt-1">Projects marked as public appear here for everyone to browse and clone.</p>
    </div>
  {:else}
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {#each projects as p}
        <a
          href={`/projects/${p.id}`}
          class="pixel-border bg-card p-4 flex flex-col gap-2 transition-all hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[6px_6px_0_0_var(--border)]"
        >
          <div class="flex items-center gap-2">
            <GitBranch class="size-4" />
            <span class="font-bold">{p.name}</span>
            <span class="text-[10px] uppercase tracking-wider px-2 py-0.5 border border-border rounded-sm bg-accent text-accent-foreground">public</span>
          </div>
          <p class="text-sm text-muted-foreground truncate">{p.description ?? "No description"}</p>
        </a>
      {/each}
    </div>
  {/if}
</PublicShell>
