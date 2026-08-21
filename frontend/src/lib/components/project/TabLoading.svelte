<script lang="ts">
  import Squiggle from "$lib/components/decor/Squiggle.svelte";
  import { Loader2 } from "lucide-svelte";

  // Loading state shown while a tab fetches its data for the first time
  // (lazy tabs: History, Activity, Pull Requests, Settings). Neobrutalist:
  // hard border + shadow, rotating icon badge, animated stripes.
  let {
    label = "Loading",
  }: {
    label?: string;
  } = $props();
</script>

<div class="tab-loading pixel-border bg-card flex flex-col items-center justify-center gap-3 px-6 py-10">
  <div class="tab-loading-spin flex items-center justify-center size-12 bg-primary text-primary-foreground border-2 border-border shadow-[4px_4px_0_0_var(--border)]">
    <Loader2 class="size-6" />
  </div>
  <div class="flex items-center gap-2 text-sm font-bold">
    <Squiggle class="size-4 text-muted-foreground" />
    {label}
    <Squiggle class="size-4 text-muted-foreground -scale-x-100" />
  </div>
  <div class="tab-loading-bar h-2 w-40 overflow-hidden border-2 border-border bg-card">
    <div class="tab-loading-fill h-full w-1/3 bg-accent"></div>
  </div>
</div>
