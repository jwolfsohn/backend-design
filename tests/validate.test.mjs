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

test("validate: endpoint with inferred_from_signal:'nonsense' errors against the legal-set enum", () => {
  const { root, cleanup } = makeFixture({
    "screens.json": [
      { id: "feed", file: "src/Feed.tsx", evidence: ["src/Feed.tsx:1"] },
    ],
    "components.json": { components: [{ name: "FeedCard" }] },
    "endpoints.json": [
      { method: "POST", path: "/api/anything", auth: "none", triggered_by: [], inferred_from_signal: "token_storeage_key" },
    ],
  });
  try {
    const { errors } = validate(root);
    const err = errors.find((e) => e.includes("token_storeage_key") && e.includes("legal set"));
    assert.ok(err, `expected enum-violation error, got: ${errors.join("; ")}`);
  } finally {
    cleanup();
  }
});

test("validate: endpoint with inferred_from_signal:'judgment:user_owned_mutations' is accepted by the enum", () => {
  const { root, cleanup } = makeFixture({
    "screens.json": [
      { id: "feed", file: "src/Feed.tsx", evidence: ["src/Feed.tsx:1"] },
    ],
    "components.json": { components: [{ name: "FeedCard" }] },
    "endpoints.json": [
      { method: "POST", path: "/api/anything", auth: "none", triggered_by: [], inferred_from_signal: "judgment:user_owned_mutations" },
    ],
  });
  try {
    const { errors } = validate(root);
    const enumErr = errors.find((e) => e.includes("legal set"));
    assert.equal(enumErr, undefined, `judgment:user_owned_mutations must be in the legal set: ${errors.join("; ")}`);
  } finally {
    cleanup();
  }
});

test("validate: endpoint with both is_webhook and inferred_from_signal errors (mutually exclusive)", () => {
  const { root, cleanup } = makeFixture({
    "screens.json": [
      { id: "feed", file: "src/Feed.tsx", evidence: ["src/Feed.tsx:1"] },
    ],
    "components.json": { components: [{ name: "FeedCard" }] },
    "endpoints.json": [
      {
        method: "POST",
        path: "/api/webhook/stripe",
        auth: "none",
        triggered_by: [],
        is_webhook: true,
        webhook_source: "stripe",
        signature_header: "Stripe-Signature",
        inferred_from_signal: "auth_path",
      },
    ],
  });
  try {
    const { errors } = validate(root);
    const err = errors.find((e) => e.includes("both is_webhook") && e.includes("inferred_from_signal"));
    assert.ok(err, `expected mutual-exclusion error, got: ${errors.join("; ")}`);
  } finally {
    cleanup();
  }
});

// Canonical signal-7 fixture: placeholder users entity, nullable user_id FK on Post, no auth
// endpoints, strategy "none", inferred_from "judgment:user_owned_mutations". Each test below
// either uses this fixture as-is (clean case) or mutates one field to violate an invariant.
function signal7Fixture() {
  return {
    "screens.json": [
      { id: "feed", file: "src/Feed.tsx", evidence: ["src/Feed.tsx:1"], entities_displayed: ["Post"] },
    ],
    "components.json": { components: [{ name: "FeedCard" }] },
    "entities.json": [
      {
        name: "User",
        table: "users",
        fields: [
          { name: "id", type: "uuid", pk: true },
          { name: "created_at", type: "timestamptz", required: true },
          { name: "updated_at", type: "timestamptz", required: true },
        ],
        evidence: ["src/Feed.tsx:1"],
        note: "placeholder — no auth surface",
      },
      {
        name: "Post",
        table: "posts",
        fields: [
          { name: "id", type: "uuid", pk: true },
          { name: "user_id", type: "uuid", required: false, fk: "users.id" },
        ],
        evidence: ["src/Feed.tsx:1"],
      },
    ],
    "relationships.json": [
      { from: "User", to: "Post", type: "one-to-many", fk: "Post.user_id", evidence: ["src/Feed.tsx:1"] },
    ],
    "endpoints.json": [
      { method: "POST", path: "/api/posts", auth: "none", triggered_by: ["src/Feed.tsx:42"] },
    ],
    "auth.json": {
      strategy: "none",
      inferred_from: "judgment:user_owned_mutations",
      signup: false,
    },
  };
}

test("validate: signal 7 with correct shape validates clean (no auth endpoints, no password_hash, signup:false, strategy:none)", () => {
  const { root, cleanup } = makeFixture(signal7Fixture());
  try {
    const { errors } = validate(root);
    assert.deepEqual(errors, [], `signal 7 canonical fixture must validate clean, got: ${errors.join("; ")}`);
  } finally {
    cleanup();
  }
});

test("validate: signal 7 with auth.strategy:'jwt' errors", () => {
  const fx = signal7Fixture();
  fx["auth.json"].strategy = "jwt";
  const { root, cleanup } = makeFixture(fx);
  try {
    const { errors } = validate(root);
    const err = errors.find((e) => e.includes("judgment:user_owned_mutations") && e.includes("strategy"));
    assert.ok(err, `expected strategy-mismatch error, got: ${errors.join("; ")}`);
  } finally {
    cleanup();
  }
});

test("validate: signal 7 with a POST /api/auth/signup endpoint errors", () => {
  const fx = signal7Fixture();
  fx["endpoints.json"].push({
    method: "POST",
    path: "/api/auth/signup",
    auth: "none",
    triggered_by: [],
    inferred_from_signal: "auth_required_screen",
  });
  const { root, cleanup } = makeFixture(fx);
  try {
    const { errors } = validate(root);
    const err = errors.find((e) => e.includes("judgment:user_owned_mutations") && e.includes("/api/auth/signup"));
    assert.ok(err, `expected forbidden-endpoint error, got: ${errors.join("; ")}`);
  } finally {
    cleanup();
  }
});

test("validate: signal 7 forbidden-endpoint regex catches register/signin/sign-up/versioned variants", () => {
  // Each path here should trip the forbidden-endpoint invariant. Validates that the regex catches
  // more than the literal /auth/{signup,login,logout} canonical set.
  const forbidden = [
    "/auth/register",
    "/auth/sign-up",
    "/auth/signin",
    "/v1/auth/login",
    "/api/v2/auth/sign-out",
  ];
  for (const path of forbidden) {
    const fx = signal7Fixture();
    fx["endpoints.json"].push({
      method: "POST",
      path,
      auth: "none",
      triggered_by: [],
      inferred_from_signal: "judgment:user_owned_mutations",
    });
    const { root, cleanup } = makeFixture(fx);
    try {
      const { errors } = validate(root);
      const err = errors.find((e) => e.includes("judgment:user_owned_mutations") && e.includes(path));
      assert.ok(err, `expected forbidden-endpoint error for ${path}, got: ${errors.join("; ")}`);
    } finally {
      cleanup();
    }
  }
});

test("validate: signal 7 with password_hash on the User entity errors", () => {
  const fx = signal7Fixture();
  fx["entities.json"][0].fields.push({ name: "password_hash", type: "text", required: true });
  const { root, cleanup } = makeFixture(fx);
  try {
    const { errors } = validate(root);
    const err = errors.find((e) => e.includes("judgment:user_owned_mutations") && e.includes("password_hash"));
    assert.ok(err, `expected password_hash error, got: ${errors.join("; ")}`);
  } finally {
    cleanup();
  }
});

test("validate: signal 7 with auth.signup:true errors (judgment-specific message)", () => {
  const fx = signal7Fixture();
  fx["auth.json"].signup = true;
  const { root, cleanup } = makeFixture(fx);
  try {
    const { errors } = validate(root);
    const err = errors.find((e) => e.includes("judgment:user_owned_mutations") && e.includes("signup"));
    assert.ok(err, `expected signup-flag error, got: ${errors.join("; ")}`);
  } finally {
    cleanup();
  }
});

test("validate: auth.strategy:'none' paired with auth.signup:true errors (global coherence)", () => {
  // Independent of signal 7 — strategy "none" should never coexist with signup:true regardless
  // of how auth was inferred. Uses a non-judgment inferred_from so the signal-7 block doesn't fire.
  const fx = signal7Fixture();
  fx["auth.json"].signup = true;
  fx["auth.json"].inferred_from = "token_storage_key";
  const { root, cleanup } = makeFixture(fx);
  try {
    const { errors } = validate(root);
    const err = errors.find((e) => e.includes("auth.strategy is 'none'") && e.includes("signup is true"));
    assert.ok(err, `expected strategy/signup coherence error, got: ${errors.join("; ")}`);
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
