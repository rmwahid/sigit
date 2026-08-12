<script lang="ts">
  import { projectsStore } from "$lib/stores/projects.svelte";

  let projectCount = $derived(projectsStore.list.length);
</script>

<div class="max-w-3xl mx-auto py-10 flex flex-col gap-8">
  <!-- Hero card -->
  <div class="pixel-border bg-card p-8">
    <h1 class="text-3xl font-bold tracking-widest mb-2">SiGit</h1>
    <p class="text-muted-foreground mb-4">Storage Integration for Git</p>
    <p class="text-base leading-relaxed">
      A self-hosted Git-based project management platform. Manage your source code and commit
      history in Git, while large assets live in your own storage. Your project, your storage,
      your history.
    </p>
  </div>

  <!-- Feature cards -->
  <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
    <div class="pixel-border-sm bg-card p-5">
      <h3 class="font-bold mb-1">Git-native</h3>
      <p class="text-sm text-muted-foreground">Commit, branch, history, and diff handled by real Git on your server.</p>
    </div>
    <div class="pixel-border-sm bg-card p-5">
      <h3 class="font-bold mb-1">Your storage</h3>
      <p class="text-sm text-muted-foreground">Large files go to S3-compatible storage or GDrive. You own the data.</p>
    </div>
    <div class="pixel-border-sm bg-card p-5">
      <h3 class="font-bold mb-1">Project timeline</h3>
      <p class="text-sm text-muted-foreground">Every push records a commit. Compare changes line by line with the diff viewer.</p>
    </div>
    <div class="pixel-border-sm bg-card p-5">
      <h3 class="font-bold mb-1">Self-hosted</h3>
      <p class="text-sm text-muted-foreground">Run it on your own VPS. No lock-in, full control over your infrastructure.</p>
    </div>
  </div>

  <!-- Getting started -->
  <div class="pixel-border bg-card p-6">
    <h2 class="font-bold mb-2">Getting started</h2>
    {#if projectCount === 0}
      <p class="text-sm text-muted-foreground mb-3">
        You have no projects yet. Create your first project from the sidebar to get started.
      </p>
    {:else}
      <p class="text-sm text-muted-foreground mb-3">
        You have {projectCount} project{projectCount > 1 ? "s" : ""}. Select one from the sidebar to open it.
      </p>
    {/if}
    <p class="text-xs text-muted-foreground">Tip: click the SiGit logo anytime to return here.</p>
  </div>
</div>
