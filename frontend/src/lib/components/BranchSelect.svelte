<script lang="ts">
  import { Check, ChevronsUpDown, GitBranch, Search } from "lucide-svelte";

  // Searchable branch selector (neobrutal). Hand-rolled instead of bits-ui
  // Combobox: small surface, and the native <select> has no search on desktop.
  let {
    items,
    value = $bindable(),
    onselect,
  }: {
    items: string[];
    value?: string;
    onselect?: () => void;
  } = $props();

  let open = $state(false);
  let query = $state("");
  let wrapper = $state<HTMLElement>();
  let inputEl = $state<HTMLInputElement>();

  const filtered = $derived(items.filter((i) => i.toLowerCase().includes(query.toLowerCase())));

  // Focus the search box whenever the dropdown opens.
  $effect(() => {
    if (open) inputEl?.focus();
  });

  function pick(item: string) {
    value = item;
    open = false;
    query = "";
    onselect?.();
  }

  function toggle() {
    open = !open;
    query = "";
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      open = false;
      query = "";
    } else if (e.key === "Enter" && filtered.length === 1) {
      pick(filtered[0]);
    }
  }

  // Close when clicking outside the dropdown.
  $effect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (wrapper && !wrapper.contains(e.target as Node)) open = false;
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  });
</script>

<div class="relative" bind:this={wrapper}>
  <button
    type="button"
    class="pixel-border-sm bg-background px-3 py-1.5 text-sm flex items-center gap-1.5 w-44 justify-between"
    onclick={toggle}
  >
    <span class="flex items-center gap-1.5 truncate">
      <GitBranch class="size-3.5 shrink-0" /> {value || "HEAD"}
    </span>
    <ChevronsUpDown class="size-3.5 opacity-60" />
  </button>

  {#if open}
    <div class="absolute z-50 mt-1 w-56 pixel-border bg-card p-1 flex flex-col">
      <div class="flex items-center gap-1.5 px-2 py-1 mb-1 border-b border-border">
        <Search class="size-3.5 opacity-60" />
        <input
          class="bg-transparent text-sm outline-none flex-1 min-w-0"
          bind:value={query}
          bind:this={inputEl}
          placeholder="Search branch..."
          onkeydown={onKeydown}
        />
      </div>
      <ul class="max-h-56 overflow-auto">
        {#each filtered as item}
          <li>
            <button
              type="button"
              class="w-full flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-left hover:bg-primary hover:text-primary-foreground"
              onclick={() => pick(item)}
            >
              <GitBranch class="size-3.5 shrink-0" />
              <span class="truncate">{item}</span>
              {#if value === item}
                <Check class="size-3.5 ml-auto" />
              {/if}
            </button>
          </li>
        {/each}
        {#if filtered.length === 0}
          <li class="px-2 py-1.5 text-sm text-muted-foreground">No branch found</li>
        {/if}
      </ul>
    </div>
  {/if}
</div>
