import { THEME_STORAGE_KEY } from "./constants/paths";

export type Theme = "dark" | "light";

const KEY = THEME_STORAGE_KEY;

export function getTheme(): Theme {
  if (typeof localStorage === "undefined") return "dark";
  const saved = localStorage.getItem(KEY);
  return saved === "light" ? "light" : "dark";
}

export function setTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === "dark") root.classList.add("dark");
  else root.classList.remove("dark");
  localStorage.setItem(KEY, theme);
}

export function initTheme(): void {
  setTheme(getTheme());
}
