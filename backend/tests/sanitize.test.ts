// Paired test for lib/sanitize.ts: the sanitizer is the trust boundary for
// rich-text PR content, so the allowlist behavior is pinned here.
import { describe, expect, it } from "bun:test";
import { sanitizeRichText } from "../src/lib/sanitize";

describe("sanitizeRichText", () => {
  it("keeps plain text and safe block/inline tags", () => {
    const html = "<h2>Title</h2><p>Hello <strong>world</strong> <em>now</em>.</p><ul><li>one</li></ul>";
    expect(sanitizeRichText(html)).toBe(
      '<h2>Title</h2><p>Hello <strong>world</strong> <em>now</em>.</p><ul><li>one</li></ul>'
    );
  });

  it("strips script tags and event handlers", () => {
    const html = '<p onclick="alert(1)">hi</p><script>alert(1)</script>';
    const out = sanitizeRichText(html);
    expect(out).not.toContain("<script");
    expect(out).not.toContain("onclick");
    expect(out).toBe("<p>hi</p>");
  });

  it("drops javascript: links and rewrites safe links with target/rel", () => {
    const html = '<a href="javascript:alert(1)">bad</a> <a href="https://sigit.dev">good</a>';
    expect(sanitizeRichText(html)).toBe(
      '<a>bad</a> <a href="https://sigit.dev" target="_blank" rel="noopener noreferrer">good</a>'
    );
  });

  it("strips images and style attributes", () => {
    const html = '<p style="color:red"><img src="x" onerror="alert(1)"></p>';
    const out = sanitizeRichText(html);
    expect(out).toBe("<p></p>");
    expect(out).not.toContain("<img");
    expect(out).not.toContain("style");
  });

  it("keeps the code class and pre/blockquote blocks", () => {
    const html = '<pre><code class="hljs language-ts">const x = 1;</code></pre><blockquote>note</blockquote>';
    expect(sanitizeRichText(html)).toBe(
      '<pre><code class="hljs language-ts">const x = 1;</code></pre><blockquote>note</blockquote>'
    );
  });

  it("strips unknown tags but keeps their text", () => {
    expect(sanitizeRichText("<iframe>hi</iframe><div>there</div>")).toBe("hithere");
  });
});
