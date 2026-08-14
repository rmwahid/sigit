<script lang="ts">
  // Hand-drawn asterisk burst, classic neobrutal ornament. Original artwork.
  let { class: className = "" } = $props<{ class?: string }>();
</script>

<svg viewBox="0 0 100 100" class={className} aria-hidden="true">
  <path d="M50 2 L56 34 L98 50 L66 56 L50 98 L44 66 L2 50 L34 44 Z" fill="currentColor" />
</svg>
