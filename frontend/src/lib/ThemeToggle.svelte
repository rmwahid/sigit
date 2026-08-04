<script lang="ts">
  import { Moon, Sun } from "lucide-svelte";
  import { getTheme, setTheme } from "$lib/theme";

  let theme = $state<"dark" | "light">(getTheme());

  function toggle() {
    theme = theme === "dark" ? "light" : "dark";
    setTheme(theme);
  }
</script>

<button
  class="pixel-border-sm inline-flex h-9 w-9 items-center justify-center bg-card text-foreground transition-colors"
  onclick={toggle}
  aria-label="Toggle theme"
  title={theme === "dark" ? "Switch to light" : "Switch to dark"}
>
  {#if theme === "dark"}
    <Sun class="size-5" />
  {:else}
    <Moon class="size-5" />
  {/if}
</button>
