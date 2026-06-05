#!/usr/bin/env node
// checkpoint.mjs — frontend signature + state introspection for resumption (Phase 0).
//
// CLI modes:
//   node checkpoint.mjs signature   -> prints one-line signature to stdout (for orchestrator)
//   node checkpoint.mjs status      -> prints human-readable state report
//   node checkpoint.mjs decide      -> prints a one-line resumption decision (for orchestrator)

import { createHash } from "crypto";
import { execSync } from "child_process";
import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import { isMainModule } from "./is-main.mjs";

// Mirrors EXT_FOR in bin/backend-design.mjs. Kept here to avoid coupling the CLI tool's
// internals to the script. If a new framework is added, update both.
const EXT_FOR = {
  "nextjs-app": ["tsx", "jsx", "ts", "js"],
  "nextjs-pages": ["tsx", "jsx", "ts", "js"],
  "react-spa": ["tsx", "jsx", "ts", "js"],
  remix: ["tsx", "ts"],
  gatsby: ["tsx", "jsx", "ts", "js"],
  "vue-spa": ["vue", "ts", "js"],
  nuxt: ["vue", "ts"],
  sveltekit: ["svelte", "ts", "js"],
  "svelte-spa": ["svelte", "ts", "js"],
  angular: ["ts", "html"],
  astro: ["astro", "tsx", "ts", "js"],
  "solid-start": ["tsx", "ts"],
  "solid-spa": ["tsx", "ts", "js"],
  qwik: ["tsx", "ts"],
  htmx: ["html"],
  vanilla: ["html", "js"],
};

const IGNORE_DIRS = new Set([
  "node_modules", ".next", ".nuxt", ".svelte-kit", ".astro", ".angular",
  "dist", "build", ".git", "out", ".backend-design", "backend",
]);

export function computeSignature(cwd = process.cwd()) {
  const configHash = hashConfig(cwd);
  if (existsSync(join(cwd, ".git"))) {
    const head = tryExec("git rev-parse HEAD", cwd);
    if (head) {
      // Full diff (not --stat) so content changes with identical line counts are detected.
      const diff = tryExec("git diff HEAD", cwd) ?? "";
      const untracked = tryExec("git ls-files --others --exclude-standard", cwd) ?? "";
      const dirtyHash = createHash("sha256").update(diff).update("\0").update(untracked).digest("hex").slice(0, 16);
      return `git:${head.trim().slice(0, 12)}:${dirtyHash}:${configHash}`;
    }
  }
  return `fs:${hashFilesystem(cwd)}:${configHash}`;
}

function hashConfig(cwd) {
  const path = join(cwd, ".backend-design", "config.json");
  if (!existsSync(path)) return "noconfig";
  try {
    return createHash("sha256").update(readFileSync(path, "utf8")).digest("hex").slice(0, 16);
  } catch {
    return "noconfig";
  }
}

function tryExec(cmd, cwd) {
  try {
    return execSync(cmd, { cwd, encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] });
  } catch {
    return null;
  }
}

function hashFilesystem(cwd) {
  const config = loadJson(join(cwd, ".backend-design", "config.json"));
  const key = config?.frontend?.patterns_key;
  const exts = (key && EXT_FOR[key]) || ["tsx", "jsx", "ts", "js", "vue", "svelte", "astro", "html"];
  const files = walk(cwd, exts).sort();
  const hash = createHash("sha256");
  for (const rel of files) {
    hash.update(rel).update("\0");
    try {
      hash.update(readFileSync(join(cwd, rel)));
    } catch {
      // Skip unreadable files; they don't affect the hash beyond their name.
    }
    hash.update("\0");
  }
  return hash.digest("hex").slice(0, 16);
}

function walk(root, exts, rel = "") {
  const out = [];
  let entries = [];
  try {
    entries = readdirSync(join(root, rel), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry.name)) continue;
    if (entry.name.startsWith(".") && entry.name !== "..") continue;
    const nextRel = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(...walk(root, exts, nextRel));
    } else if (entry.isFile()) {
      const dot = entry.name.lastIndexOf(".");
      if (dot < 0) continue;
      const ext = entry.name.slice(dot + 1);
      if (exts.includes(ext)) out.push(nextRel);
    }
  }
  return out;
}

function loadJson(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

export function loadCheckpoint(cwd = process.cwd()) {
  return loadJson(join(cwd, ".backend-design", "checkpoint.json"));
}

export function decide(cwd = process.cwd()) {
  const cp = loadCheckpoint(cwd);
  if (!cp) {
    return { action: "fresh", reason: "No checkpoint — first run.", next_phase: 1 };
  }
  const sig = computeSignature(cwd);
  const frontendChanged = cp.frontend_signature && cp.frontend_signature !== sig;
  if (frontendChanged) {
    return {
      action: "fresh_with_gaps_preserved",
      reason: "Frontend changed since last run; re-running inventory. Existing gaps.json is preserved so closures will be tracked.",
      next_phase: 1,
      prev_signature: cp.frontend_signature,
      current_signature: sig,
    };
  }
  if (cp.phase_4_at) {
    return { action: "gaps_only", reason: "Backend already scaffolded and frontend unchanged. Running gap check only.", next_phase: "gaps" };
  }
  if (cp.design_approved_at) {
    return { action: "resume_phase_4", reason: "Design approved but scaffold not yet generated. Resuming at Phase 4.", next_phase: 4 };
  }
  if (cp.phase_2_6_at) {
    return { action: "resume_phase_3", reason: "Skeptic pass complete. Resuming at Phase 3 review gate.", next_phase: 3 };
  }
  if (cp.phase_2_5_at) {
    return { action: "resume_phase_2_6", reason: "Gap detection complete; skeptic pass not yet run. Resuming at Phase 2.6.", next_phase: 2.6 };
  }
  if (cp.phase_2_at) {
    return { action: "resume_phase_2_5", reason: "Synthesis complete. Resuming at Phase 2.5 gap detection.", next_phase: 2.5 };
  }
  if (cp.phase_1_at) {
    return { action: "resume_phase_2", reason: "Inventory complete. Resuming at Phase 2 synthesis.", next_phase: 2 };
  }
  return { action: "fresh", reason: "Checkpoint present but no phase recorded.", next_phase: 1 };
}

export function printStatus(cwd = process.cwd()) {
  const cp = loadCheckpoint(cwd);
  if (!cp) {
    console.log("No checkpoint found.");
    console.log("Run `npx backend-design start` then `/backend-design` to begin.");
    return 0;
  }

  console.log("Phase history:");
  const fmt = (when) => when ? when.replace("T", " ").slice(0, 19) + " UTC" : "—";
  const mark = (when) => when ? "✓" : " ";
  console.log(`  ${mark(cp.phase_1_at)} Phase 1   inventory       ${fmt(cp.phase_1_at)}`);
  console.log(`  ${mark(cp.phase_2_at)} Phase 2   synthesis       ${fmt(cp.phase_2_at)}`);
  console.log(`  ${mark(cp.phase_2_5_at)} Phase 2.5 gap detection  ${fmt(cp.phase_2_5_at)}`);
  console.log(`  ${mark(cp.phase_2_6_at)} Phase 2.6 skeptic pass   ${fmt(cp.phase_2_6_at)}`);
  console.log(`  ${mark(cp.design_approved_at)} Phase 3   approved        ${fmt(cp.design_approved_at)}`);
  console.log(`  ${mark(cp.phase_4_at)} Phase 4   scaffold        ${fmt(cp.phase_4_at)}`);
  console.log();

  if (cp.frontend_signature) {
    const current = computeSignature(cwd);
    if (cp.frontend_signature === current) {
      console.log(`Frontend signature: ${current} (unchanged since last run)`);
    } else {
      console.log(`Frontend signature: ${current}`);
      console.log(`             prior: ${cp.frontend_signature}  ← CHANGED`);
    }
    console.log();
  }

  const gaps = loadJson(join(cwd, ".backend-design", "gaps.json"));
  if (gaps && Array.isArray(gaps)) {
    const open = gaps.filter((g) => g.status === "open");
    const b = open.filter((g) => g.severity === "blocker").length;
    const w = open.filter((g) => g.severity === "warning").length;
    const i = open.filter((g) => g.severity === "info").length;
    console.log(`Open gaps: ${b} blocker(s) · ${w} wire-up(s) · ${i} info`);
    console.log();
  }

  const questions = loadJson(join(cwd, ".backend-design", "state", "open_questions.json"));
  if (Array.isArray(questions) && questions.length) {
    const skeptic = questions.filter((q) => q?.category === "skeptic").length;
    const product = questions.length - skeptic;
    console.log(`Open questions: ${product} product-intent · ${skeptic} skeptic-pass`);
    console.log();
  }

  const openapi = loadJson(join(cwd, "openapi.json"));
  if (openapi && openapi.paths) {
    const paths = Object.keys(openapi.paths).length;
    const webhooks = Object.keys(openapi.webhooks ?? {}).length;
    console.log(`OpenAPI: ./openapi.json (${paths} paths, ${webhooks} webhooks)`);
    console.log();
  }

  const d = decide(cwd);
  console.log(`Next: ${d.reason}`);
  return 0;
}

if (isMainModule(import.meta.url)) {
  const cmd = process.argv[2] ?? "signature";
  if (cmd === "signature") {
    console.log(computeSignature());
  } else if (cmd === "status") {
    process.exit(printStatus());
  } else if (cmd === "decide") {
    const d = decide();
    console.log(JSON.stringify(d));
  } else {
    console.error(`unknown command: ${cmd}`);
    console.error("usage: checkpoint.mjs [signature|status|decide]");
    process.exit(1);
  }
}
