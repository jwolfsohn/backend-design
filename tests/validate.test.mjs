import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validate } from "../validate.mjs";

function makeFixture(stateFiles) {
  const root = mkdtempSync(join(tmpdir(), "bd-validate-"));
  const stateDir = join(root, ".backend-design", "state");
  mkdirSync(stateDir, { recursive: true });
  for (const [name, contents] of Object.entries(stateFiles)) {
    writeFileSync(join(stateDir, name), JSON.stringify(contents));
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("validate: minimal screens + components fixture passes", () => {
  const { root, cleanup } = makeFixture({
    "screens.json": [
      { id: "home", file: "src/Home.tsx", evidence: ["src/Home.tsx:1"] },
    ],
    "components.json": { components: [{ name: "Button" }] },
  });
  try {
    const { errors } = validate(root);
    assert.deepEqual(
      errors,
      [],
      `expected no errors on a minimal valid fixture, got: ${errors.join("; ")}`
    );
  } finally {
    cleanup();
  }
});

test("validate: relationship FK pointing at a missing column errors", () => {
  const { root, cleanup } = makeFixture({
    "screens.json": [
      {
        id: "feed",
        file: "src/Feed.tsx",
        evidence: ["src/Feed.tsx:1"],
        entities_displayed: ["Post", "User"],
      },
    ],
    "components.json": { components: [{ name: "PostCard" }] },
    "entities.json": [
      {
        name: "User",
        table: "users",
        fields: [{ name: "id", type: "uuid", pk: true }],
        evidence: ["src/Feed.tsx:1"],
      },
      {
        name: "Post",
        table: "posts",
        fields: [{ name: "id", type: "uuid", pk: true }],
        evidence: ["src/Feed.tsx:1"],
      },
    ],
    "relationships.json": [
      {
        from: "User",
        to: "Post",
        type: "one-to-many",
        fk: "Post.author_id",
        evidence: ["src/Feed.tsx:1"],
      },
    ],
  });
  try {
    const { errors } = validate(root);
    const fkErr = errors.find(
      (e) => e.includes("author_id") && e.includes("does not exist")
    );
    assert.ok(
      fkErr,
      `expected an FK-missing-column error, got: ${errors.join("; ")}`
    );
  } finally {
    cleanup();
  }
});

test("validate: endpoint with inferred_from_signal and empty triggered_by validates clean", () => {
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
    const { errors } = validate(root);
    const triggerErr = errors.find((e) => e.includes("no UI trigger"));
    assert.equal(triggerErr, undefined, `inferred_from_signal must satisfy the trigger invariant: ${errors.join("; ")}`);
  } finally {
    cleanup();
  }
});

test("validate: endpoint with neither triggered_by nor is_webhook nor inferred_from_signal errors", () => {
  const { root, cleanup } = makeFixture({
    "screens.json": [
      { id: "feed", file: "src/Feed.tsx", evidence: ["src/Feed.tsx:1"] },
    ],
    "components.json": { components: [{ name: "FeedCard" }] },
    "endpoints.json": [
      { method: "POST", path: "/api/orphan", auth: "none", triggered_by: [] },
    ],
  });
  try {
    const { errors } = validate(root);
    const triggerErr = errors.find((e) => e.includes("no UI trigger"));
    assert.ok(triggerErr, `expected trigger-invariant error, got: ${errors.join("; ")}`);
    assert.ok(triggerErr.includes("inferred_from_signal"), "error message must mention the new escape hatch");
  } finally {
    cleanup();
  }
});

test("validate: endpoint with both triggered_by and inferred_from_signal validates clean", () => {
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
    const { errors } = validate(root);
    const triggerErr = errors.find((e) => e.includes("no UI trigger"));
    assert.equal(triggerErr, undefined, `both fields together must validate clean: ${errors.join("; ")}`);
  } finally {
    cleanup();
  }
});

test("validate: missing .backend-design/state/ directory returns a clear error", () => {
  const root = mkdtempSync(join(tmpdir(), "bd-validate-empty-"));
  try {
    const { errors } = validate(root);
    assert.ok(
      errors.some((e) => e.includes("not found")),
      `expected a 'not found' error, got: ${errors.join("; ")}`
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
