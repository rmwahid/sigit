import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Formats an ISO date to the local display (e.g. "8/12/2026").
// Single helper for all date rendering in the UI.
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString();
}

// Type helper for forwarding element refs (shadcn-svelte pattern used by the
// ui components: `ref = $bindable(null)` + `bind:this={ref}`)
export type WithElementRef<T, R extends string = string> = T & {
  ref?: Element | null;
};
