// @vitest-environment happy-dom
import { describe, expect, it, beforeEach } from "vitest";
import { getTheme, setTheme, initTheme } from "$lib/theme";

describe("theme", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = "";
  });

  it("defaults to dark when nothing is saved", () => {
    expect(getTheme()).toBe("dark");
  });

  it("returns the saved theme", () => {
    localStorage.setItem("sigit-theme", "light");
    expect(getTheme()).toBe("light");
  });

  it("setTheme toggles the dark class and persists", () => {
    setTheme("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(localStorage.getItem("sigit-theme")).toBe("light");

    setTheme("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem("sigit-theme")).toBe("dark");
  });

  it("initTheme applies the saved theme", () => {
    localStorage.setItem("sigit-theme", "light");
    initTheme();
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});
