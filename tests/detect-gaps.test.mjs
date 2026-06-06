import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectGaps } from "../scripts/detect-gaps.mjs";

function fixture({ stateFiles = {}, config, envFiles = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), "bd-detect-"));
  const stateDir = join(root, ".backend-design", "state");
  mkdirSync(stateDir, { recursive: true });
  for (const [name, contents] of Object.entries(stateFiles)) {
    writeFileSync(join(stateDir, name), JSON.stringify(contents));
  }
  if (config) {
    writeFileSync(join(root, ".backend-design", "config.json"), JSON.stringify(config));
  }
  for (const [name, contents] of Object.entries(envFiles)) {
    writeFileSync(join(root, name), contents);
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("detect-gaps: env vars in .env.development satisfy the blocker check", () => {
  const { root, cleanup } = fixture({
    config: { stack: { database: "postgres" }, auth: { strategy: "session", store: "redis" } },
    stateFiles: { "auth.json": { strategy: "session", store: "redis" } },
    envFiles: { ".env.development": "database_url=postgres://x\nexport REDIS_URL=redis://x\n" },
  });
  try {
    const gaps = detectGaps(root);
    const missing = gaps.filter((g) => g.type === "missing_env_var").map((g) => g.specifier);
    assert.ok(!missing.includes("DATABASE_URL"), `DATABASE_URL must be satisfied, gaps were: ${missing.join(",")}`);
    assert.ok(!missing.includes("REDIS_URL"), `REDIS_URL must be satisfied, gaps were: ${missing.join(",")}`);
  } finally {
    cleanup();
  }
});

test("detect-gaps: lowercase key uppercased before insertion (load-bearing detail)", () => {
  const { root, cleanup } = fixture({
    config: { stack: { database: "postgres" }, auth: { strategy: "jwt", secret_env: "JWT_SECRET" } },
    stateFiles: { "auth.json": { strategy: "jwt", secret_env: "JWT_SECRET" } },
    envFiles: { ".env": "jwt_secret=abc\n" },
  });
  try {
    const gaps = detectGaps(root);
    const missing = gaps.filter((g) => g.type === "missing_env_var").map((g) => g.specifier);
    assert.ok(!missing.includes("JWT_SECRET"), `lowercase jwt_secret must satisfy JWT_SECRET check, gaps were: ${missing.join(",")}`);
  } finally {
    cleanup();
  }
});

test("detect-gaps: empty env files produce missing-env-var blockers (negative case)", () => {
  const { root, cleanup } = fixture({
    config: { stack: { database: "postgres" }, auth: { strategy: "session", store: "redis" } },
    stateFiles: { "auth.json": { strategy: "session", store: "redis" } },
  });
  try {
    const gaps = detectGaps(root);
    const missing = gaps.filter((g) => g.type === "missing_env_var").map((g) => g.specifier);
    assert.ok(missing.includes("DATABASE_URL"), "DATABASE_URL must be a blocker when no env file has it");
    assert.ok(missing.includes("REDIS_URL"), "REDIS_URL must be a blocker when no env file has it");
    assert.ok(missing.includes("SESSION_SECRET"), "SESSION_SECRET must be a blocker when no env file has it");
  } finally {
    cleanup();
  }
});

test("detect-gaps: export prefix is honored", () => {
  const { root, cleanup } = fixture({
    config: { stack: { database: "postgres" } },
    stateFiles: {},
    envFiles: { ".env.production": "export DATABASE_URL=postgres://prod\n" },
  });
  try {
    const gaps = detectGaps(root);
    const missing = gaps.filter((g) => g.type === "missing_env_var").map((g) => g.specifier);
    assert.ok(!missing.includes("DATABASE_URL"), `export prefix must satisfy DATABASE_URL, gaps were: ${missing.join(",")}`);
  } finally {
    cleanup();
  }
});
