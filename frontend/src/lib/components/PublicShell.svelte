<script lang="ts">
  import ThemeToggle from "$lib/ThemeToggle.svelte";
  import { APP_ROUTES } from "$lib/constants/paths";
  import { GitBranch } from "lucide-svelte";
  import Starburst from "./decor/Starburst.svelte";
  import Meander from "./decor/Meander.svelte";
  import HangingTag from "./decor/HangingTag.svelte";

  let { children } = $props<{ children?: import("svelte").Snippet }>();
</script>

<div class="relative min-h-screen bg-background overflow-hidden">
  <!-- Neobrutal decorations -->
  <div class="absolute inset-0 nb-dots pointer-events-none" aria-hidden="true"></div>
  <div class="absolute -top-6 -left-6 size-28 bg-secondary pixel-border nb-tilt pointer-events-none" aria-hidden="true"></div>
  <div class="absolute top-1/3 -right-8 size-20 bg-accent nb-stripes pixel-border pointer-events-none" aria-hidden="true"></div>
  <div class="absolute -bottom-8 left-1/4 size-24 bg-primary nb-checker pixel-border nb-tilt pointer-events-none" aria-hidden="true"></div>
  <Starburst class="absolute -bottom-4 -right-6 size-20 text-accent pointer-events-none" />
  <HangingTag text="Open source" class="absolute top-16 right-8 hidden sm:flex text-border" />

  <!-- Public nav -->
  <header class="relative pixel-border-sm bg-card mx-4 mt-4 px-4 py-2 flex items-center justify-between">
    <div class="flex items-center gap-4">
      <a href={APP_ROUTES.EXPLORE} class="text-xl font-extrabold tracking-tight">
        <span class="nb-mark">SiGit</span>
      </a>
      <a href={APP_ROUTES.EXPLORE} class="pixel-border-sm px-3 py-1 text-sm bg-primary text-primary-foreground flex items-center gap-1.5">
        <GitBranch class="size-3.5" /> Explore
      </a>
    </div>
    <div class="flex items-center gap-2">
      <ThemeToggle />
      <a href="/login" class="pixel-border-sm px-3 py-1 text-sm bg-card">Sign in</a>
    </div>
  </header>

  <main class="relative max-w-4xl mx-auto px-4 py-8">
    <Meander class="h-2.5 w-full mb-6 text-border opacity-30" />
    {@render children?.()}
  </main>
</div>
