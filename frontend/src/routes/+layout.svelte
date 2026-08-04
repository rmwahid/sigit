<script lang="ts">
  import "../app.css";
  import { onMount } from "svelte";
  import { initTheme } from "$lib/theme";

  let { children }: { children?: import("svelte").Snippet } = $props();

  onMount(() => {
    initTheme();
  });
</script>

{@render children?.()}
