import { test } from "node:test";
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

// The skill installs as a symlink and ships scripts invoked with relative <SKILL_DIR> paths.
// These tests pin the two failure modes that broke the helper's predecessor:
//   - through a symlink, import.meta.url resolves but process.argv[1] doesn't
//   - with a relative path, process.argv[1] stays relative while import.meta.url is absolute
// Both must report "main" or every script silently no-ops.

const HELPER_REAL = realpathSync(new URL("../scripts/is-main.mjs", import.meta.url).pathname);

function makeScript(dir, name = "probe.mjs") {
  const probe = join(dir, name);
  writeFileSync(probe, `import { isMainModule } from ${JSON.stringify(HELPER_REAL)};
process.stdout.write(isMainModule(import.meta.url) ? "main" : "not-main");
`);
  return probe;
}

test("isMainModule: returns 'main' when invoked directly by absolute path", () => {
  const dir = mkdtempSync(join(tmpdir(), "bd-ismain-"));
  try {
    const probe = makeScript(dir);
    const out = execFileSync("node", [probe], { encoding: "utf8" });
    assert.equal(out, "main");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("isMainModule: returns 'main' when invoked through a symlink", () => {
  const dir = mkdtempSync(join(tmpdir(), "bd-ismain-symlink-"));
  try {
    const probe = makeScript(dir);
    const linkDir = join(dir, "link");
    mkdirSync(linkDir);
    const link = join(linkDir, "probe.mjs");
    symlinkSync(probe, link);
    const out = execFileSync("node", [link], { encoding: "utf8" });
    assert.equal(out, "main", "guard must survive symlink-resolution mismatch between import.meta.url and process.argv[1]");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("isMainModule: returns 'main' when invoked by relative path", () => {
  const dir = mkdtempSync(join(tmpdir(), "bd-ismain-rel-"));
  try {
    const probe = makeScript(dir);
    const rel = relative(process.cwd(), probe);
    const out = execFileSync("node", [rel], { encoding: "utf8" });
    assert.equal(out, "main", "guard must survive relative-vs-absolute mismatch");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("isMainModule: returns 'not-main' when imported by another script", () => {
  const dir = mkdtempSync(join(tmpdir(), "bd-ismain-imported-"));
  try {
    const probe = makeScript(dir, "probe.mjs");
    const entry = join(dir, "entry.mjs");
    writeFileSync(entry, `import ${JSON.stringify(probe)};\n`);
    const out = execFileSync("node", [entry], { encoding: "utf8" });
    assert.equal(out, "not-main", "imported module must not run its main block");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
