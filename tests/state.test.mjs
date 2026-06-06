import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadJson, loadState, atomicWriteFileSync, STATE_FILES } from "../scripts/state.mjs";

function tmp() {
  return mkdtempSync(join(tmpdir(), "bd-state-"));
}

test("loadJson: returns null on missing file", () => {
  assert.equal(loadJson(join(tmp(), "missing.json")), null);
});

test("loadJson: returns null on malformed JSON", () => {
  const root = tmp();
  try {
    const p = join(root, "bad.json");
    writeFileSync(p, "{ not: valid");
    assert.equal(loadJson(p), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("loadJson: parses well-formed JSON", () => {
  const root = tmp();
  try {
    const p = join(root, "ok.json");
    writeFileSync(p, JSON.stringify({ a: 1 }));
    assert.deepEqual(loadJson(p), { a: 1 });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("loadState: parses present state files and skips missing ones", () => {
  const root = tmp();
  try {
    const stateDir = join(root, ".backend-design", "state");
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(join(stateDir, "screens.json"), JSON.stringify([{ id: "x" }]));
    writeFileSync(join(stateDir, "auth.json"), JSON.stringify({ strategy: "jwt" }));
    const state = loadState(root);
    assert.deepEqual(state.screens, [{ id: "x" }]);
    assert.deepEqual(state.auth, { strategy: "jwt" });
    assert.equal(state.entities, undefined, "missing files must be absent from the result");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("loadState: respects an explicit file subset", () => {
  const root = tmp();
  try {
    const stateDir = join(root, ".backend-design", "state");
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(join(stateDir, "endpoints.json"), JSON.stringify([{ method: "GET" }]));
    writeFileSync(join(stateDir, "screens.json"), JSON.stringify([{ id: "x" }]));
    const state = loadState(root, ["endpoints.json"]);
    assert.ok(state.endpoints, "subset must load endpoints.json");
    assert.equal(state.screens, undefined, "subset must skip screens.json");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("loadState: returns an empty object when the state dir is missing", () => {
  assert.deepEqual(loadState(tmp()), {});
});

test("atomicWriteFileSync: writes the final file and leaves no .tmp sibling", () => {
  const root = tmp();
  try {
    const target = join(root, "deep", "nested", "out.json");
    atomicWriteFileSync(target, '{"ok":true}');
    assert.equal(readFileSync(target, "utf8"), '{"ok":true}');
    assert.equal(existsSync(target + ".tmp"), false, "must not leave a .tmp sibling");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("STATE_FILES: covers the canonical 8 files in order", () => {
  assert.deepEqual(STATE_FILES, [
    "screens.json",
    "components.json",
    "endpoints.json",
    "forms.json",
    "entities.json",
    "relationships.json",
    "auth.json",
    "open_questions.json",
  ]);
});
