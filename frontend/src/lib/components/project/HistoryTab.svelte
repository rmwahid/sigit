<script lang="ts">
  import DiffViewer from "$lib/DiffViewer.svelte";
  import { formatDate } from "$lib/utils";
  import type { CommitInfo } from "$lib/api/browser";
  import BranchSelect from "$lib/components/BranchSelect.svelte";
  import { GitCommitHorizontal, X } from "lucide-svelte";

  // History tab: paginated commit list + diff panel (state lives in the page).
  let {
    history,
    historyMore,
    historyLoading,
    diff,
    isAnon,
    showDiff,
    loadMore,
    closeDiff,
    branches,
    ref = $bindable(),
    onRefChange,
  }: {
    history: CommitInfo[];
    historyMore: boolean;
    historyLoading: boolean;
    diff: { diff: string; files: { path: string; status: string }[] } | null;
    isAnon: boolean;
    showDiff: (hash: string) => void;
    loadMore: () => void;
    closeDiff: () => void;
    branches: string[];
    ref?: string;
    onRefChange?: () => void;
  } = $props();
</script>

<div class="flex flex-col gap-4">
  <div class="flex items-center gap-2">
    <BranchSelect items={branches.length ? branches : ["HEAD"]} bind:value={ref} onselect={onRefChange} />
    <span class="text-xs text-muted-foreground">Commits reachable from the selected branch.</span>
  </div>

  <div class="pixel-border bg-card flex flex-col">
    {#if history.length === 0}
      <div class="p-6 text-sm text-muted-foreground">
        {historyLoading ? "Loading..." : "No commits yet. Push commits via git to see them here."}
      </div>
    {:else}
      <ul>
        {#each history as commit}
          <li class="border-b border-border last:border-b-0 px-4 py-2 flex items-center gap-3 text-sm">
            <span class="shrink-0 size-6 flex items-center justify-center border-2 border-border bg-secondary text-secondary-foreground">
              <GitCommitHorizontal class="size-4" />
            </span>
            <span class="font-bold truncate flex-1">{commit.message}</span>
            <span class="text-xs text-muted-foreground hidden sm:inline">{commit.author}</span>
            <code class="text-xs text-muted-foreground">{commit.hash.slice(0, 7)}</code>
            <span class="text-xs text-muted-foreground hidden md:inline">{formatDate(commit.date)}</span>
            {#if !isAnon}
              <button class="pixel-border-sm px-2 py-0.5 text-xs" onclick={() => showDiff(commit.hash)}>Diff</button>
            {/if}
          </li>
        {/each}
      </ul>
      {#if historyMore}
        <button class="pixel-border-sm px-3 py-1.5 text-sm m-3 self-start" disabled={historyLoading} onclick={loadMore}>
          {historyLoading ? "Loading..." : "Load more"}
        </button>
      {/if}
    {/if}
  </div>

  {#if diff}
    <div class="pixel-border bg-card p-4">
      <div class="flex items-center justify-between mb-2">
        <h3 class="font-bold">Diff</h3>
        <button class="pixel-border-sm px-2 py-1 text-xs flex items-center gap-1" onclick={closeDiff}>
          <X class="size-3.5" /> Close
        </button>
      </div>
      <DiffViewer diff={diff.diff} />
    </div>
  {/if}
</div>
