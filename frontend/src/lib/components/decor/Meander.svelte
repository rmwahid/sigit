<script lang="ts">
  // Greek key (meander) strip, a nod to the classical/kingdom vibe.
  // Repeated square spirals, drawn with currentColor. Original artwork.
  let { class: className = "" } = $props<{ class?: string }>();

  const CELL = 20;
  const COLS = 6;
  let d = $derived(
    Array.from({ length: COLS }, (_, i) => {
      const x = i * CELL;
      return `M${x} 10 V0 H${x + CELL} V10 H${x + 5} V5 H${x + 15}`;
    }).join(" ")
  );
</script>

<svg
  viewBox={`0 0 ${CELL * COLS} 10`}
  preserveAspectRatio="none"
  class={className}
  aria-hidden="true"
>
  <path
    d={d}
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linejoin="round"
    vector-effect="non-scaling-stroke"
  />
</svg>
