import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderDesign } from "../scripts/render-design.mjs";

function makeFixture(stateFiles) {
  const root = mkdtempSync(join(tmpdir(), "bd-render-"));
  const stateDir = join(root, ".backend-design", "state");
  mkdirSync(stateDir, { recursive: true });
  for (const [name, contents] of Object.entries(stateFiles)) {
    writeFileSync(join(stateDir, name), JSON.stringify(contents));
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("render-design: trigger column shows 'inferred from <signal> (no UI)' when inferred_from_signal is set", () => {
  const { root, cleanup } = makeFixture({
    "screens.json": [
      { id: "feed", file: "src/Feed.tsx", evidence: ["src/Feed.tsx:1"] },
    ],
    "components.json": { components: [{ name: "FeedCard" }] },
    "endpoints.json": [
      {
        method: "POST",
        path: "/api/auth/signup",
        auth: "none",
        triggered_by: [],
        inferred_from_signal: "auth_required_screen",
      },
    ],
  });
  try {
    const md = renderDesign(root);
    assert.ok(
      md.includes("inferred from `auth_required_screen` (no UI)"),
      `expected trigger column to render the inferred-from-signal label, got: ${md.match(/\| `POST`.*$/m)?.[0] ?? "(no row)"}`
    );
    assert.ok(md.includes("_inferred_"), "expected 'inferred' flag in the method cell");
  } finally {
    cleanup();
  }
});

test("render-design: triggered_by wins over inferred_from_signal when both present", () => {
  const { root, cleanup } = makeFixture({
    "screens.json": [
      { id: "login", file: "src/Login.tsx", evidence: ["src/Login.tsx:1"] },
    ],
    "components.json": { components: [{ name: "LoginForm" }] },
    "endpoints.json": [
      {
        method: "POST",
        path: "/api/auth/login",
        auth: "none",
        triggered_by: ["src/Login.tsx:42"],
        inferred_from_signal: "token_storage_key",
      },
    ],
  });
  try {
    const md = renderDesign(root);
    assert.ok(md.includes("src/Login.tsx:42"), "expected UI file:line in trigger column");
    assert.ok(!md.includes("inferred from `token_storage_key` (no UI)"), "expected UI trigger to win for display");
  } finally {
    cleanup();
  }
});
