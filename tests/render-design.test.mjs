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

test("render-design: signal 7 auth section reads 'placeholder users entity only', not 'backend was scaffolded'", () => {
  const { root, cleanup } = makeFixture({
    "screens.json": [
      { id: "feed", file: "src/Feed.tsx", evidence: ["src/Feed.tsx:1"] },
    ],
    "components.json": { components: [{ name: "FeedCard" }] },
    "auth.json": {
      strategy: "none",
      inferred_from: "judgment:user_owned_mutations",
      signup: false,
    },
  });
  try {
    const md = renderDesign(root);
    assert.ok(
      md.includes("placeholder `users` entity only"),
      `expected the placeholder-only message for signal 7, got:\n${md}`
    );
    assert.ok(
      !md.includes("backend was scaffolded from this signal"),
      "signal 7 must NOT claim a backend was scaffolded — no auth backend exists"
    );
  } finally {
    cleanup();
  }
});

test("render-design: signal 3 (auth_required_screen) still reads 'backend was scaffolded from this signal'", () => {
  // Regression pin — the original message must keep working for signals 3-6, which do scaffold
  // the auth backend (the UI is what's missing).
  const { root, cleanup } = makeFixture({
    "screens.json": [
      { id: "dash", file: "src/Dash.tsx", evidence: ["src/Dash.tsx:1"] },
    ],
    "components.json": { components: [{ name: "Dashboard" }] },
    "auth.json": {
      strategy: "jwt",
      inferred_from: "auth_required_screen",
      signup: true,
    },
  });
  try {
    const md = renderDesign(root);
    assert.ok(
      md.includes("backend was scaffolded from this signal"),
      `expected the scaffolded-backend message for signal 3, got:\n${md}`
    );
    assert.ok(
      !md.includes("placeholder `users` entity only"),
      "signal 3 must NOT use the placeholder-only message"
    );
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

test("render-design: endpoint flag order is severity-descending (placeholder → inferred → webhook → multipart)", () => {
  // The renderer is presentation-only and does not validate — a fixture with all four flags
  // exercises the order even though the validator would reject is_webhook + inferred_from_signal.
  // What matters here is that whatever combination reaches the renderer, the flag pill reads in
  // a predictable order.
  const { root, cleanup } = makeFixture({
    "screens.json": [
      { id: "all", file: "src/All.tsx", evidence: ["src/All.tsx:1"] },
    ],
    "components.json": { components: [{ name: "AllFlags" }] },
    "endpoints.json": [
      {
        method: "POST",
        path: "/api/all-flags",
        auth: "none",
        triggered_by: [],
        temporary: true,
        is_webhook: true,
        webhook_source: "stripe",
        inferred_from_signal: "auth_required_screen",
        content_type: "multipart/form-data",
        placeholder_reason: "test",
      },
    ],
  });
  try {
    const md = renderDesign(root);
    const row = md.split("\n").find((l) => l.includes("/api/all-flags"));
    assert.ok(row, `expected the all-flags endpoint row, got md:\n${md}`);
    const flagsPill = row.match(/_([^_]+)_/)?.[1];
    assert.equal(
      flagsPill,
      "⚠ placeholder, inferred, webhook, multipart",
      `flag order must be severity-descending, got: "${flagsPill}"`
    );
  } finally {
    cleanup();
  }
});
