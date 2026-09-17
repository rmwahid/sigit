import { describe, expect, it } from "vitest";
import { renderMarkdown, safeHref } from "$lib/markdown";

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

  it("drops link targets with a dangerous scheme (README is untrusted git data)", () => {
    for (const scheme of [
      "javascript:alert(document.domain)",
      "JaVaScRiPt:alert(1)",
      "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
      "//evil.example/x",
    ]) {
      const out = renderMarkdown(`[click](${scheme})`);
      expect(out).not.toContain("href");
      expect(out).not.toContain("javascript:");
      expect(out).not.toContain("data:");
      // The label survives as plain text.
      expect(out).toContain("click");
    }
  });

  it("keeps safe and relative link targets", () => {
    expect(renderMarkdown("[a](https://example.com)")).toContain('href="https://example.com"');
    expect(renderMarkdown("[a](http://example.com)")).toContain('href="http://example.com"');
    expect(renderMarkdown("[a](mailto:x@y.z)")).toContain('href="mailto:x@y.z"');
    expect(renderMarkdown("[a](./docs/readme.md)")).toContain('href="./docs/readme.md"');
    expect(renderMarkdown("[a](#section)")).toContain('href="#section"');
  });

  it("links open externally with rel=noopener", () => {
    const out = renderMarkdown("[a](https://example.com)");
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).toContain('target="_blank"');
  });

  it("drops image sources with a dangerous scheme", () => {
    const out = renderMarkdown("![alt](javascript:alert(1))");
    expect(out).not.toContain("<img");
    expect(out).toContain("alt");
    expect(renderMarkdown("![alt](https://example.com/a.png)")).toContain('src="https://example.com/a.png"');
  });

  it("autolink with a script scheme is not turned into a link", () => {
    const out = renderMarkdown("<javascript:alert(1)>");
    expect(out).not.toContain("<a ");
    expect(out).toContain("javascript:alert(1)");
  });
});

describe("safeHref", () => {
  it("accepts https, http, mailto and relative references", () => {
    expect(safeHref("https://example.com")).toBe("https://example.com");
    expect(safeHref("http://example.com")).toBe("http://example.com");
    expect(safeHref("mailto:a@b.c")).toBe("mailto:a@b.c");
    expect(safeHref("/projects/1")).toBe("/projects/1");
    expect(safeHref("#top")).toBe("#top");
    expect(safeHref("?a=1")).toBe("?a=1");
    expect(safeHref("readme.md")).toBe("readme.md");
  });

  it("rejects other schemes, protocol-relative and empty values", () => {
    expect(safeHref("javascript:alert(1)")).toBeUndefined();
    expect(safeHref("DATA:text/plain,x")).toBeUndefined();
    expect(safeHref("//evil.example")).toBeUndefined();
    expect(safeHref("")).toBeUndefined();
    expect(safeHref(null)).toBeUndefined();
    expect(safeHref(undefined)).toBeUndefined();
  });

  it("trims surrounding whitespace before deciding", () => {
    expect(safeHref("  https://example.com  ")).toBe("https://example.com");
    expect(safeHref("  javascript:alert(1)  ")).toBeUndefined();
  });
});
