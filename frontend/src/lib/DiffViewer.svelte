<script lang="ts">
  import { Diff2HtmlUI } from "diff2html/lib/ui/js/diff2html-ui.js";
  import "diff2html/bundles/css/diff2html.min.css";

  let { diff }: { diff: string } = $props();
  let container: HTMLDivElement | undefined = $state();

  // Gitea-style per-file collapse: clicking the file name header toggles that
  // file's diff. diff2html's own "Viewed" toggle is disabled (fileListToggle
  // false); we wire our own chevron + handler after each draw instead.
  function wireCollapse() {
    container?.querySelectorAll(".d2h-file-wrapper").forEach((wrapper) => {
      const nameWrap = wrapper.querySelector(".d2h-file-name-wrapper");
      if (!nameWrap || nameWrap.querySelector(".d2h-chevron")) return;
      const chevron = document.createElement("span");
      chevron.className = "d2h-chevron";
      chevron.setAttribute("aria-hidden", "true");
      nameWrap.appendChild(chevron);
      nameWrap.classList.add("d2h-file-name-toggle");
      nameWrap.addEventListener("click", () => {
        wrapper.classList.toggle("d2h-collapsed");
        wrapper.querySelector(".d2h-file-diff")?.classList.toggle("d2h-d-none");
        wrapper.querySelector(".d2h-files-diff")?.classList.toggle("d2h-d-none");
      });
    });
  }

  function draw() {
    if (!container || !diff) return;
    // Redraw from scratch: the UI class keeps its own state.
    container.innerHTML = "";
    const ui = new Diff2HtmlUI(container, diff, {
      outputFormat: "side-by-side",
      // No separate file summary on top: each file header is followed by its
      // own changes (file 1, changes 1, file 2, changes 2, ...).
      drawFileList: false,
      matching: "lines",
      fileListToggle: false,
    });
    ui.draw();
    wireCollapse();
  }

  // Runs after mount and whenever a different diff arrives (component reuse).
  $effect(() => {
    diff;
    draw();
  });
</script>

<div bind:this={container} class="diff2html"></div>

<style>
  .diff2html {
    overflow-x: auto;
    border: 2px solid var(--border);
    border-radius: var(--radius);
    padding: 0.5rem;
    background: var(--card);
  }

  :global(.d2h-file-name-toggle) {
    cursor: pointer;
    user-select: none;
  }

  /* diff2html always renders the "Viewed" label in file headers; our chevron
     replaces it, so hide the label entirely. */
  :global(.d2h-file-collapse) {
    display: none !important;
  }

  :global(.d2h-chevron) {
    display: inline-block;
    width: 0;
    height: 0;
    margin-left: 0.4rem;
    border-left: 5px solid transparent;
    border-right: 5px solid transparent;
    border-top: 6px solid var(--foreground);
    transition: transform 0.15s ease;
  }

  :global(.d2h-collapsed .d2h-chevron) {
    transform: rotate(-90deg);
  }
</style>
