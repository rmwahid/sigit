import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../src/lib/markdown";

describe("renderMarkdown", () => {
  it("renders basic markdown", () => {
    expect(renderMarkdown("# Title")).toContain("<h1");
    expect(renderMarkdown("**bold**")).toContain("<strong>bold</strong>");
    expect(renderMarkdown("`code`")).toContain("<code>code</code>");
    expect(renderMarkdown("[link](https://example.com)")).toContain('href="https://example.com"');
  });

  it("escapes raw html (XSS-safe)", () => {
    const out = renderMarkdown("<script>alert(1)</script>");
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;script&gt;");
  });
});
