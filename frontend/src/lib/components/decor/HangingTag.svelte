<script lang="ts">
  // Hanging price-tag sticker: string + punched hole + tilted box.
  // Caller positions it and sets the string color via a text-* class.
  let {
    text,
    class: className = "",
    tilt = "-rotate-2",
  } = $props<{ text: string; class?: string; tilt?: string }>();
</script>

<div class={"flex flex-col items-center " + className}>
  <div class="w-0.5 h-7 bg-current" aria-hidden="true"></div>
  <div
    class={"relative pixel-border px-3 py-1 text-sm font-bold bg-secondary text-secondary-foreground " + tilt}
  >
    <span
      class="absolute -top-1.5 left-1/2 -translate-x-1/2 size-2 rounded-full bg-background border border-current"
      aria-hidden="true"
    ></span>
    {text}
  </div>
</div>
