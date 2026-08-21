// HTML sanitization for rich-text content (pull request descriptions,
// comments, review bodies). Rich text is edited client-side with Tiptap and
// stored as HTML, so the server must strip anything outside the allowlist
// before persisting or responding: the API response is rendered verbatim on
// the frontend, so this is the trust boundary.
import sanitizeHtml from "sanitize-html";

// Tiptap starter-kit output. Attributes are locked to the minimal safe set:
// anchors keep href (https/mailto only, enforced in the transform), code
// spans keep class (hljs), images are NOT allowed (no external embeds),
// everything else is plain.
const ALLOWED_TAGS = [
  "p",
  "br",
  "hr",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "strike",
  "sub",
  "sup",
  "code",
  "pre",
  "blockquote",
  "ul",
  "ol",
  "li",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "a",
];

const ALLOWED_ATTRS = {
  a: ["href", "target", "rel"],
  code: ["class"],
};

// https/mailto only; any other scheme (javascript:, data:, file:) is dropped.
const ALLOWED_URI_REGEX = /^(https?:\/\/|mailto:)/i;

export function sanitizeRichText(input: string): string {
  return sanitizeHtml(input, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRS,
    allowedSchemes: ["http", "https", "mailto"],
    // Rewrites every anchor: keeps the href only when the scheme is safe and
    // forces target/rel so links always open externally in a new tab.
    transformTags: {
      a: (tagName, attribs) => {
        const href = attribs.href;
        const safeHref = href && ALLOWED_URI_REGEX.test(href) ? href : undefined;
        const out: Record<string, string> = {};
        if (safeHref) {
          out.href = safeHref;
          out.target = "_blank";
          out.rel = "noopener noreferrer";
        }
        return { tagName, attribs: out };
      },
    },
  });
}