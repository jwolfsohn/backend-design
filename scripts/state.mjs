import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

// Canonical 8-file state list. Mirrored historically in validate.mjs (as FILES),
// render-design.mjs, render-env-example.mjs, render-openapi.mjs,
// render-s2ai-schema.mjs, and detect-gaps.mjs. Single source of truth lives here.
export const STATE_FILES = [
  "screens.json",
  "components.json",
  "endpoints.json",
  "forms.json",
  "entities.json",
  "relationships.json",
  "auth.json",
  "open_questions.json",
];

export function loadJson(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

export function loadState(cwd, files = STATE_FILES) {
  const dir = join(cwd, ".backend-design", "state");
  const out = {};
  if (!existsSync(dir)) return out;
  for (const f of files) {
    const p = join(dir, f);
    if (!existsSync(p)) continue;
    try {
      out[f.replace(".json", "")] = JSON.parse(readFileSync(p, "utf8"));
    } catch {
      // Validator surfaces parse errors elsewhere.
    }
  }
  return out;
}

// Write via temp + rename so an interrupted writer can't leave a half-written
// file at the user-visible path. Same .tmp suffix every call — fine for a CLI
// because concurrent writes to one render target aren't a realistic case.
export function atomicWriteFileSync(path, contents) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = path + ".tmp";
  writeFileSync(tmp, contents);
  renameSync(tmp, path);
}
