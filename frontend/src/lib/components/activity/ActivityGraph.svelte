<script lang="ts">
  import { activityLevel, buildActivityGrid, MONTH_NAMES, type ActivityDay } from "$lib/activity";
  import { COPY } from "$lib/constants/copy";

  let { days = [] }: { days?: ActivityDay[] } = $props();

  const GAP_PX = 3;

  const grid = $derived(buildActivityGrid(days));
  const summary = $derived(
    COPY.ACTIVITY_SUMMARY.replace("{count}", String(grid.total)).replace("{year}", String(new Date().getFullYear()))
  );

  function displayDate(key: string): string {
    const [year, month, day] = key.split("-").map(Number);
    return `${MONTH_NAMES[month - 1]} ${day}, ${year}`;
  }

  function cellLabel(count: number, date: string): string {
    const template = count === 0 ? COPY.ACTIVITY_NO_COMMITS : COPY.ACTIVITY_COMMITS_ON_DAY;
    return template.replace("{count}", String(count)).replace("{date}", displayDate(date));
  }
</script>

<div class="pixel-border bg-card p-4">
  <p class="text-sm font-bold">{summary}</p>
  <div class="mt-3 overflow-x-auto pb-2">
    <div class="min-w-[600px]">
      <!-- Month labels: same 53-column track grid as the cells, so labels align -->
      <div
        class="grid h-4 text-[10px] text-muted-foreground"
        style:grid-template-columns="repeat(53, minmax(0, 1fr))"
        style:gap="{GAP_PX}px"
      >
        {#each grid.months as month}
          <span class="whitespace-nowrap" style:grid-column-start="{month.col + 1}">{month.label}</span>
        {/each}
      </div>
      <div class="grid grid-flow-col grid-rows-7" style:grid-auto-columns="minmax(0, 1fr)" style:gap="{GAP_PX}px">
        {#each grid.weeks as week}
          {#each week as cell}
            {#if cell}
              <div
                class="aspect-square rounded-[2px]"
                class:bg-muted={cell.count === 0}
                style:background={cell.count === 0 ? undefined : `var(--activity-${activityLevel(cell.count)})`}
                title={cellLabel(cell.count, cell.date)}
                role="img"
                aria-label={cellLabel(cell.count, cell.date)}
              ></div>
            {:else}
              <div class="aspect-square rounded-[2px]" style:background="var(--activity-future)"></div>
            {/if}
          {/each}
        {/each}
      </div>
    </div>
  </div>
  <div class="mt-3 flex items-center justify-end gap-1.5 text-[10px] text-muted-foreground">
    <span>{COPY.ACTIVITY_LESS}</span>
    {#each [0, 1, 2, 3, 4] as level}
      <div
        class="size-[10px] rounded-[2px]"
        class:bg-muted={level === 0}
        style:background={level === 0 ? undefined : `var(--activity-${level})`}
      ></div>
    {/each}
    <span>{COPY.ACTIVITY_MORE}</span>
  </div>
</div>
