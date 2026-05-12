#!/usr/bin/env node
import { mkdirSync, symlinkSync, unlinkSync, lstatSync, existsSync, readFileSync, writeFileSync, readdirSync } from "fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { homedir } from "os";
import { execSync } from "child_process";
import prompts from "prompts";
import pc from "picocolors";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(__dirname, "..");
const pkg = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8"));

const STACKS = [
  {
    id: "node-express-prisma",
    label: "Node.js + Express + Prisma + Postgres",
    tagline: "Battle-tested. Most ubiquitous. Easy to deploy.",
    language: "typescript",
    runtime: "node",
    framework: "express",
    orm: "prisma",
    database: "postgres",
  },
  {
    id: "node-fastify-prisma",
    label: "Node.js + Fastify + Prisma + Postgres",
    tagline: "Express, but ~2x faster. Schema validation built in.",
    language: "typescript",
    runtime: "node",
    framework: "fastify",
    orm: "prisma",
    database: "postgres",
  },
  {
    id: "node-hono-drizzle",
    label: "Node.js + Hono + Drizzle + Postgres",
    tagline: "TS-first, edge-ready. Drizzle is leaner than Prisma.",
    language: "typescript",
    runtime: "node",
    framework: "hono",
    orm: "drizzle",
    database: "postgres",
  },
  {
    id: "nextjs-prisma",
    label: "Next.js API routes + Prisma + Postgres",
    tagline: "Colocated with the frontend. Easiest deploy on Vercel.",
    language: "typescript",
    runtime: "node",
    framework: "nextjs",
    orm: "prisma",
    database: "postgres",
  },
  {
    id: "python-fastapi",
    label: "Python + FastAPI + SQLAlchemy + Postgres",
    tagline: "Strong typing, async by default. SQLAlchemy 2 + alembic.",
    language: "python",
    runtime: "python",
    framework: "fastapi",
    orm: "sqlalchemy",
    database: "postgres",
  },
];

const AUTH_OPTIONS = [
  { id: "jwt", label: "JWT (stateless, simple)", tagline: "Recommended for SPAs and mobile clients." },
  { id: "session", label: "Sessions (cookie-based)", tagline: "More secure for browser apps; needs a session store." },
  { id: "none", label: "No auth", tagline: "Skip if the app has no users." },
];

function banner() {
  const line = pc.dim("─".repeat(56));
  console.log("");
  console.log(`  ${pc.bold(pc.cyan("backend-design"))} ${pc.dim(`v${pkg.version}`)}`);
  console.log(`  ${pc.dim("design your backend from your frontend")}`);
  console.log(`  ${line}`);
  console.log("");
}

const step = (label) => console.log(`${pc.cyan("→")} ${label}`);
const ok = (label) => console.log(`  ${pc.green("✓")} ${label}`);
const warn = (label) => console.log(`  ${pc.yellow("!")} ${label}`);
const fail = (label) => console.log(`  ${pc.red("✗")} ${label}`);
const dim = (label) => console.log(`  ${pc.dim(label)}`);
const blank = () => console.log("");

function pathExists(p) {
  try {
    lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

function detectFrontend(cwd) {
  const pkgPath = join(cwd, "package.json");
  if (!existsSync(pkgPath)) return null;
  const pj = JSON.parse(readFileSync(pkgPath, "utf8"));
  const deps = { ...(pj.dependencies ?? {}), ...(pj.devDependencies ?? {}) };
  if (deps.next) {
    const router = existsSync(join(cwd, "app")) || existsSync(join(cwd, "src/app")) ? "App Router" : "Pages Router";
    return { framework: "Next.js", version: deps.next, detail: router };
  }
  if (deps.react) return { framework: "React", version: deps.react, detail: deps["react-router-dom"] ? "react-router" : "SPA" };
  return null;
}

function countSourceFiles(cwd) {
  try {
    const out = execSync(
      `find . -type f \\( -name "*.tsx" -o -name "*.jsx" -o -name "*.ts" -o -name "*.js" \\) ` +
        `-not -path "*/node_modules/*" -not -path "*/.next/*" ` +
        `-not -path "*/dist/*" -not -path "*/build/*" -not -path "*/.git/*" | wc -l`,
      { cwd, encoding: "utf8" }
    );
    return parseInt(out.trim(), 10);
  } catch {
    return null;
  }
}

async function install() {
  banner();
  step("Installing skill into ~/.claude/skills/");
  const skillsDir = join(homedir(), ".claude", "skills");
  const target = join(skillsDir, "backend-design");
  mkdirSync(skillsDir, { recursive: true });
  if (pathExists(target)) {
    unlinkSync(target);
    dim(`removed existing: ${target}`);
  }
  symlinkSync(pkgRoot, target, "dir");
  ok(`linked: ${pc.dim(target + " → " + pkgRoot)}`);
  blank();
  console.log(pc.bold("  Next steps"));
  console.log(`  ${pc.dim("1.")} ${pc.dim("cd into a React/Next.js project")}`);
  console.log(`  ${pc.dim("2.")} ${pc.cyan("npx backend-design start")}  ${pc.dim("# pick stack, write config")}`);
  console.log(`  ${pc.dim("3.")} Restart Claude Code, then run ${pc.cyan("/backend-design")}`);
  blank();
}

async function uninstall() {
  banner();
  const target = join(homedir(), ".claude", "skills", "backend-design");
  if (pathExists(target)) {
    unlinkSync(target);
    ok(`removed: ${pc.dim(target)}`);
  } else {
    dim("not installed");
  }
  blank();
}

async function start() {
  banner();
  const cwd = process.cwd();

  step("Checking working directory");
  const front = detectFrontend(cwd);
  if (!front) {
    fail("no React/Next.js frontend detected in this directory");
    dim("expected `react` or `next` in package.json dependencies");
    blank();
    process.exit(1);
  }
  ok(`${front.framework} ${pc.dim(front.version)} ${pc.dim(`(${front.detail})`)}`);

  const fileCount = countSourceFiles(cwd);
  if (fileCount === null) {
    warn("could not count source files");
  } else if (fileCount > 1500) {
    fail(`${fileCount} source files — too large to analyze cleanly`);
    dim("scope down to a subdirectory before running, or pass --scope <path>");
    blank();
    process.exit(1);
  } else if (fileCount > 500) {
    warn(`${fileCount} source files — full analysis may cost $5–15`);
    dim("you can scope down later when the skill runs");
  } else {
    ok(`${fileCount} source files ${pc.dim("(within budget)")}`);
  }
  blank();

  step("Choose your backend stack");
  const stackResp = await prompts(
    {
      type: "select",
      name: "stack",
      message: "stack",
      choices: STACKS.map((s) => ({
        title: s.label,
        description: s.tagline,
        value: s.id,
      })),
      initial: 0,
    },
    { onCancel: () => process.exit(130) }
  );
  if (!stackResp.stack) process.exit(130);
  const stack = STACKS.find((s) => s.id === stackResp.stack);
  blank();

  step("Authentication strategy");
  const authResp = await prompts(
    {
      type: "select",
      name: "auth",
      message: "auth",
      choices: AUTH_OPTIONS.map((a) => ({
        title: a.label,
        description: a.tagline,
        value: a.id,
      })),
      initial: 0,
    },
    { onCancel: () => process.exit(130) }
  );
  if (!authResp.auth) process.exit(130);
  blank();

  let defaultOut = stack.framework === "nextjs" ? "." : "./backend";
  step("Output directory");
  const dirResp = await prompts(
    {
      type: "text",
      name: "out",
      message: "directory",
      initial: defaultOut,
    },
    { onCancel: () => process.exit(130) }
  );
  if (!dirResp.out) process.exit(130);
  blank();

  const config = {
    version: pkg.version,
    created_at: new Date().toISOString(),
    stack: {
      id: stack.id,
      label: stack.label,
      language: stack.language,
      runtime: stack.runtime,
      framework: stack.framework,
      orm: stack.orm,
      database: stack.database,
    },
    auth: { strategy: authResp.auth },
    output_dir: dirResp.out,
    frontend: front,
  };

  step("Writing config");
  const stateDir = join(cwd, ".backend-design");
  mkdirSync(stateDir, { recursive: true });
  const configPath = join(stateDir, "config.json");
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
  ok(`wrote ${pc.dim(".backend-design/config.json")}`);
  blank();

  console.log(pc.bold("  Summary"));
  console.log(`  ${pc.dim("stack:")}  ${stack.label}`);
  console.log(`  ${pc.dim("auth:")}   ${authResp.auth}`);
  console.log(`  ${pc.dim("output:")} ${dirResp.out}`);
  blank();
  console.log(pc.bold("  Next step"));
  console.log(`  Open Claude Code in this directory and run ${pc.cyan("/backend-design")}`);
  console.log(`  ${pc.dim("(or just say: 'build a backend for this frontend')")}`);
  blank();
}

async function validate() {
  banner();
  step("Validating .backend-design/state/");
  const mod = await import("../validate.mjs");
  blank();
  const exitCode = mod.printResults(mod.validate(process.cwd()));
  blank();
  process.exit(exitCode);
}

function help() {
  banner();
  console.log(pc.bold("  Commands"));
  console.log(`  ${pc.cyan("install")}    Symlink the skill into ~/.claude/skills/`);
  console.log(`  ${pc.cyan("uninstall")}  Remove the symlink`);
  console.log(`  ${pc.cyan("start")}      Pick a stack and write .backend-design/config.json`);
  console.log(`  ${pc.cyan("validate")}   Check .backend-design/state/*.json invariants`);
  blank();
  console.log(pc.bold("  Typical flow"));
  console.log(`  ${pc.dim("$")} npx backend-design install`);
  console.log(`  ${pc.dim("$")} cd my-app`);
  console.log(`  ${pc.dim("$")} npx backend-design start`);
  console.log(`  ${pc.dim("$")} claude  ${pc.dim("# then: /backend-design")}`);
  blank();
}

const cmd = process.argv[2];
const cmds = { install, uninstall, start, validate, help };

if (!cmd) {
  help();
  process.exit(0);
}
if (!cmds[cmd]) {
  fail(`unknown command: ${cmd}`);
  blank();
  help();
  process.exit(1);
}
await cmds[cmd]();
