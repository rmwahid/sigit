// Protocol constants - mirrors backend src/constants/protocol.ts (Pralumex
// style: named entries with slug + name). constants-sync.test.ts enforces parity.
export const ARCHIVE_FORMATS = {
  ZIP: { slug: "zip", name: "ZIP" },
  TAR_GZ: { slug: "tar.gz", name: "TAR.GZ" },
} as const;

export const ARCHIVE_FORMAT_SLUGS = Object.values(ARCHIVE_FORMATS).map((f) => f.slug);
