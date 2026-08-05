<script lang="ts">
  import { listProjects } from "$lib/api";
  import { goto } from "$app/navigation";
  import { onMount } from "svelte";

  let loading = $state(true);

  onMount(async () => {
    try {
      const res = await listProjects();
      if (res.data.length > 0) {
        await goto(`/projects/${res.data[0].id}`, { replaceState: true });
      }
    } finally {
      loading = false;
    }
  });
</script>

<div class="flex flex-col items-center justify-center h-full text-center">
  {#if loading}
    <p class="text-muted-foreground">Loading...</p>
  {:else}
    <p class="text-muted-foreground mb-4">No projects yet.</p>
    <a href="/" class="pixel-border px-6 py-3" onclick={(e) => e.preventDefault()}>Create your first project</a>
  {/if}
</div>
