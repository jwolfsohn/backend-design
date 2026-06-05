import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Robust replacement for `import.meta.url === \`file://${process.argv[1]}\``.
// That naive comparison fails two ways:
//   1. Through a symlink (e.g. .claude/skills/backend-design -> npm cache), import.meta.url
//      resolves to the real path while process.argv[1] keeps the symlink as typed.
//   2. With a relative path (`node scripts/foo.mjs`), process.argv[1] stays relative
//      while import.meta.url is absolute.
// Resolving both sides to a canonical real path handles both. If either side can't be
// resolved (file gone, argv[1] missing), treat as "not main" so library imports stay safe.
export function isMainModule(metaUrl) {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(metaUrl)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}
