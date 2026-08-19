// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { mount, unmount } from "svelte";
import Button from "$lib/components/ui/button/button.svelte";

// Button component: verifies the href branch (anchor) and the plain button
// branch, plus the disabled semantics used across the neobrutalist UI.
function renderButton(props: Record<string, unknown> = {}): string {
  const target = document.createElement("div");
  const component = mount(Button, { target, props });
  const html = target.innerHTML;
  unmount(component);
  return html;
}

describe("Button", () => {
  it("renders an anchor when href is set", () => {
    const html = renderButton({ href: "/projects" });
    expect(html).toContain("<a");
    expect(html).toContain('href="/projects"');
    expect(html).toContain('data-slot="button"');
    expect(html).not.toContain("<button");
  });

  it("renders a button element by default", () => {
    const html = renderButton({ type: "submit" });
    expect(html).toContain("<button");
    expect(html).toContain('type="submit"');
    expect(html).not.toContain("<a");
  });

  it("applies the default variant classes", () => {
    const html = renderButton({});
    expect(html).toContain("rounded-md");
    expect(html).toContain("border-2");
    expect(html).toContain("bg-primary");
    expect(html).toContain("text-primary-foreground");
  });

  it("drops the href and flags aria-disabled on a disabled anchor", () => {
    const html = renderButton({ href: "/projects", disabled: true });
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain('role="link"');
    expect(html).toContain('tabindex="-1"');
    expect(html).not.toContain('href="/projects"');
  });

  it("merges custom classes with the variant classes", () => {
    const html = renderButton({ class: "my-extra" });
    expect(html).toContain("my-extra");
    expect(html).toContain("rounded-md");
  });
});
