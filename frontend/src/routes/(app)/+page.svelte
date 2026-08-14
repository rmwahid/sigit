<script lang="ts">
  import { projectsStore } from "$lib/stores/projects.svelte";
  import { GitBranch, Landmark } from "lucide-svelte";
  import Squiggle from "$lib/components/decor/Squiggle.svelte";

  let projects = $derived(projectsStore.list);
</script>

<svelte:head>
  <title>Projects - SiGit</title>
</svelte:head>

<div class="max-w-4xl mx-auto py-8 flex flex-col gap-6">
  <div>
    <h1 class="flex items-center gap-2 text-3xl font-extrabold mb-2">
      <span class="nb-mark">Projects</span>
      {#if projects.length > 0}
        <span class="text-sm font-bold text-muted-foreground">({projects.length})</span>
      {/if}
    </h1>
    <Squiggle class="h-2.5 w-36 text-accent" />
  </div>

  {#if projects.length === 0}
    <div class="flex flex-col items-center py-14 text-center">
      <div class="relative">
        <div class="h-3.5 w-44 bg-card nb-checker border-2 border-b-0 border-border absolute -top-3.5 left-1/2 -translate-x-1/2" aria-hidden="true"></div>
        <div class="pixel-border nb-dashed bg-card px-8 py-10 flex flex-col items-center gap-3">
          <Landmark class="size-9 text-primary" />
          <p class="text-lg font-bold">No projects yet</p>
          <p class="text-sm text-muted-foreground max-w-xs">
            Create one to get started: pick a unique name and connect your own storage. Click the
            "New Project" tag above.
          </p>
        </div>
      </div>
    </div>
  {:else}
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {#each projects as p}
        <a
          href={`/projects/${p.id}`}
          class="pixel-border bg-card p-4 flex flex-col gap-2 transition-all hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[6px_6px_0_0_var(--border)]"
        >
          <div class="flex items-center gap-2">
            <GitBranch class="size-4 shrink-0" />
            <span class="font-bold truncate">{p.name}</span>
            {#if p.isPublic}
              <span class="ml-auto text-[10px] uppercase tracking-wider px-2 py-0.5 border border-border rounded-sm bg-accent text-accent-foreground">public</span>
            {:else}
              <span class="ml-auto text-[10px] uppercase tracking-wider px-2 py-0.5 border border-border rounded-sm bg-muted">private</span>
            {/if}
          </div>
          <p class="text-sm text-muted-foreground truncate">{p.description ?? "No description"}</p>
        </a>
      {/each}
    </div>
  {/if}
</div>
