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
