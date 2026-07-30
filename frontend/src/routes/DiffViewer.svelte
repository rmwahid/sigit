<script lang="ts">
  import { onMount } from "svelte";
  import * as Diff2Html from "diff2html";
  import "diff2html/bundles/css/diff2html.min.css";

  let { diff }: { diff: string } = $props();
  let container: HTMLDivElement | undefined = $state();

  let html = $derived(
    Diff2Html.html(diff, {
      drawFileList: true,
      matching: "lines",
      outputFormat: "side-by-side",
    })
  );
</script>

<div bind:this={container} class="diff2html">
  {@html html}
</div>

<style>
  .diff2html {
    overflow-x: auto;
    border: 1px solid #ddd;
    border-radius: 0.5rem;
    padding: 0.5rem;
  }
</style>
