import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Type helper for forwarding element refs (shadcn-svelte pattern used by the
// ui components: `ref = $bindable(null)` + `bind:this={ref}`)
export type WithElementRef<T, R extends string = string> = T & {
  ref?: Element | null;
};
