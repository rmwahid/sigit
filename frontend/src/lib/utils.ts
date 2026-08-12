import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Format tanggal ISO ke tampilan lokal (contoh "8/12/2026").
// Satu helper untuk semua tampilan tanggal di UI.
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString();
}

// Type helper for forwarding element refs (shadcn-svelte pattern used by the
// ui components: `ref = $bindable(null)` + `bind:this={ref}`)
export type WithElementRef<T, R extends string = string> = T & {
  ref?: Element | null;
};
