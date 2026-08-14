<script lang="ts">
  import LogViewer from "$lib/LogViewer.svelte";
  import Squiggle from "$lib/components/decor/Squiggle.svelte";
</script>

<div class="max-w-3xl mx-auto py-8 flex flex-col gap-6">
  <div>
    <h1 class="text-3xl font-extrabold mb-2"><span class="nb-mark">Logs</span></h1>
    <Squiggle class="h-2.5 w-24 text-accent" />
  </div>
  <LogViewer />
</div>
