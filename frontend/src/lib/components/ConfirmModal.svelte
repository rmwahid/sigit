<script lang="ts">
  // Neobrutal confirmation modal - replaces the native browser confirm()
  // dialogs (blocking and unstyled). The caller controls open/close and
  // decides what happens on confirm; danger actions use the destructive tone.
  import { X } from "lucide-svelte";

  let {
    open,
    title,
    message,
    confirmLabel = "Confirm",
    cancelLabel = "Cancel",
    danger = false,
    onConfirm,
    onCancel,
  }: {
    open: boolean;
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    danger?: boolean;
    onConfirm: () => void;
    onCancel: () => void;
  } = $props();
</script>

{#if open}
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
    <div class="pixel-border bg-card w-full max-w-sm p-4 flex flex-col gap-3">
      <div class="flex items-center justify-between">
        <span id="confirm-title" class="font-bold">{title}</span>
        <button class="pixel-border-sm px-1.5 py-0.5" onclick={onCancel} aria-label="Close">
          <X class="size-4" />
        </button>
      </div>
      <p class="text-sm">{message}</p>
      <div class="flex justify-end gap-2">
        <button class="pixel-border-sm px-3 py-1.5 text-sm" onclick={onCancel}>{cancelLabel}</button>
        <button
          class="pixel-border-sm px-3 py-1.5 text-sm {danger
            ? 'bg-destructive text-destructive-foreground'
            : 'bg-primary text-primary-foreground'}"
          onclick={onConfirm}
        >{confirmLabel}</button>
      </div>
    </div>
  </div>
{/if}
