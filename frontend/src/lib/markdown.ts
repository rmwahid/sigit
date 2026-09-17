import { marked, Renderer } from "marked";

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// Only these schemes may reach an href/src. marked does NOT sanitize link or
// image targets, so a README containing "[x](javascript:...)" would otherwise
// render a clickable script URL, and this HTML is inserted with {@html}.
// Mirrors the server-side allowlist in backend lib/sanitize.ts.
const SAFE_LINK_SCHEME = /^(https?:\/\/|mailto:)/i;
// Any other explicit scheme (javascript:, data:, vbscript:, file:, ...).
const EXPLICIT_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

// Returns the href when it is safe to use, otherwise undefined (link becomes
// plain text, image becomes alt text). Relative paths, fragments and queries
// carry no scheme and are kept.
export function safeHref(href: string | null | undefined): string | undefined {
  if (!href) return undefined;
  const trimmed = href.trim();
  if (!trimmed) return undefined;
  if (SAFE_LINK_SCHEME.test(trimmed)) return trimmed;
  if (EXPLICIT_SCHEME.test(trimmed)) return undefined;
  if (trimmed.startsWith("//")) return undefined; // protocol-relative
  return trimmed;
}

// Render repo README markdown. README content is untrusted repository data:
// raw HTML passthrough is escaped and every link/image target is filtered
// through the scheme allowlist, so the marked output cannot inject scripts or
// trigger a "javascript:" URL when it is inserted with {@html}.
export function renderMarkdown(md: string): string {
  const renderer = new Renderer();
  renderer.html = ({ text }) => escapeHtml(text);
  renderer.link = ({ href, title, tokens }) => {
    const text = renderer.parser.parseInline(tokens);
    const safe = safeHref(href);
    if (!safe) return text;
    const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
    return `<a href="${escapeHtml(safe)}"${titleAttr} rel="noopener noreferrer" target="_blank">${text}</a>`;
  };
  renderer.image = ({ href, title, text }) => {
    const safe = safeHref(href);
    if (!safe) return escapeHtml(text ?? "");
    const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
    return `<img src="${escapeHtml(safe)}" alt="${escapeHtml(text ?? "")}"${titleAttr}>`;
  };
  return marked.parse(md, { renderer, async: false }) as string;
}
