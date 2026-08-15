<script lang="ts">
  import { formatDate } from "$lib/utils";
  import type { ActivityItem } from "$lib/api/browser";
  import { GitCommitHorizontal, Zap } from "lucide-svelte";

  // Activity tab: timeline grouped by date (state lives in the page).
  let {
    activityByDate,
    activityMore,
    loadMore,
  }: {
    activityByDate: [string, ActivityItem[]][];
    activityMore: boolean;
    loadMore: () => void;
  } = $props();
</script>

<div class="pixel-border bg-card flex flex-col">
  {#if activityByDate.length === 0}
    <div class="p-6 text-sm text-muted-foreground">No activity yet.</div>
  {:else}
    <div class="flex flex-col divide-y-2 divide-border">
      {#each activityByDate as [date, items]}
        <div class="px-4 py-3">
          <div class="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">{formatDate(date)}</div>
          <ul class="flex flex-col gap-2">
            {#each items as item}
              <li class="flex items-center gap-3 text-sm">
                {#if item.type === "commit"}
                  <GitCommitHorizontal class="size-4 text-primary shrink-0" />
                  <span class="font-bold truncate">{String(item.message ?? "")}</span>
                  <span class="text-xs text-muted-foreground hidden sm:inline">{String(item.author ?? "")}</span>
                  <code class="text-xs text-muted-foreground">{String(item.hash ?? "").slice(0, 7)}</code>
                {:else}
                  <Zap class="size-4 text-accent shrink-0" />
                  <span class="font-medium truncate">{String(item.event ?? "event")}</span>
                {/if}
                <span class="ml-auto text-xs text-muted-foreground hidden md:inline">{String(item.ts ?? "").slice(11, 16)}</span>
              </li>
            {/each}
          </ul>
        </div>
      {/each}
    </div>
    {#if activityMore}
      <button class="pixel-border-sm px-3 py-1.5 text-sm m-3 self-start" onclick={loadMore}>
        Load more
      </button>
    {/if}
  {/if}
</div>
