<script lang="ts">
  import { formatDate } from "$lib/utils";
  import { formatActivityItem } from "$lib/project-page";
  import type { ActivityItem } from "$lib/api/browser";
  import { GitCommitHorizontal, Zap } from "lucide-svelte";

  // Activity tab: timeline grouped by date (state lives in the page). Each
  // line is a commit or an audit event rendered as a human sentence.
  let {
    activityByDate,
    activityMore,
    loadMore,
    activityLoading,
  }: {
    activityByDate: [string, ActivityItem[]][];
    activityMore: boolean;
    loadMore: () => void;
    activityLoading: boolean;
  } = $props();
</script>

<div class="pixel-border bg-card flex flex-col">
  {#if activityByDate.length === 0}
    <div class="p-6 text-sm text-muted-foreground">{activityLoading ? "Loading..." : "No activity yet."}</div>
  {:else}
    <div class="flex flex-col divide-y-2 divide-border">
      {#each activityByDate as [date, items]}
        <div class="px-4 py-3">
          <div class="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">{formatDate(date)}</div>
          <ul class="flex flex-col gap-2">
            {#each items as item}
              <li class="flex items-center gap-3 text-sm">
                {#if item.type === "commit"}
                  <span class="shrink-0 size-6 flex items-center justify-center border-2 border-border bg-secondary text-secondary-foreground">
                    <GitCommitHorizontal class="size-4" />
                  </span>
                  <span class="font-bold truncate flex-1">{formatActivityItem(item)}</span>
                  <code class="text-xs text-muted-foreground shrink-0">{String(item.hash ?? "").slice(0, 7)}</code>
                {:else}
                  <span class="shrink-0 flex items-center justify-center size-6 border-2 border-border bg-accent text-accent-foreground">
                    <Zap class="size-3.5" />
                  </span>
                  <span class="font-medium truncate flex-1">{formatActivityItem(item)}</span>
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
