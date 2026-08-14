<script lang="ts">
  // Hanging price-tag sticker: string + punched hole + tilted box.
  // Decorative by default; pass onclick to make it an interactive trigger.
  // Caller positions it and sets the string color via a text-* class.
  let {
    text,
    class: className = "",
    tilt = "-rotate-2",
    onclick,
  } = $props<{ text: string; class?: string; tilt?: string; onclick?: () => void }>();

  const boxClass = $derived(
    "relative pixel-border px-3 py-1 text-sm font-bold bg-secondary text-secondary-foreground " + tilt
  );
</script>

<div class={"flex flex-col items-center " + className}>
  <div class="w-0.5 h-7 bg-current" aria-hidden="true"></div>
  {#if onclick}
    <button
      type="button"
      class={boxClass + " cursor-pointer transition-all hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[4px_4px_0_0_var(--border)]"}
      {onclick}
    >
      <span class="absolute -top-1.5 left-1/2 -translate-x-1/2 size-2 rounded-full bg-background border border-current" aria-hidden="true"></span>
      {text}
    </button>
  {:else}
    <div aria-hidden="true" class={boxClass + " pointer-events-none"}>
      <span class="absolute -top-1.5 left-1/2 -translate-x-1/2 size-2 rounded-full bg-background border border-current" aria-hidden="true"></span>
      {text}
    </div>
  {/if}
</div>
