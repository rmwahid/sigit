<script lang="ts">
  // Wavy underline divider, classic neobrutal ornament. Original artwork.
  let { class: className = "" } = $props<{ class?: string }>();
</script>

<svg
  viewBox="0 0 120 12"
  preserveAspectRatio="none"
  class={className}
  aria-hidden="true"
>
  <path
    d="M0 6 Q10 0 20 6 T40 6 T60 6 T80 6 T100 6 T120 6"
    fill="none"
    stroke="currentColor"
    stroke-width="3"
    stroke-linecap="round"
    vector-effect="non-scaling-stroke"
  />
</svg>
