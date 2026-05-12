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

function detectPackageManager(cwd) {
  if (existsSync(join(cwd, "bun.lockb")) || existsSync(join(cwd, "bun.lock"))) return "bun";
  if (existsSync(join(cwd, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(cwd, "yarn.lock"))) return "yarn";
  if (existsSync(join(cwd, "package-lock.json"))) return "npm";
  return "pnpm";
}

function detectWorkspace(cwd) {
  const out = [];
  const pkgPath = join(cwd, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pj = JSON.parse(readFileSync(pkgPath, "utf8"));
      if (Array.isArray(pj.workspaces) || pj.workspaces?.packages) {
        const patterns = Array.isArray(pj.workspaces) ? pj.workspaces : pj.workspaces.packages;
        for (const dir of ["apps", "packages"]) {
          const root = join(cwd, dir);
          if (existsSync(root)) {
            try {
              for (const sub of readdirSync(root)) {
                if (existsSync(join(root, sub, "package.json"))) out.push(`${dir}/${sub}`);
              }
            } catch {}
          }
        }
        if (!out.length && patterns) for (const p of patterns) out.push(p);
      }
    } catch {}
  }
  if (existsSync(join(cwd, "pnpm-workspace.yaml"))) {
    for (const dir of ["apps", "packages"]) {
      const root = join(cwd, dir);
      if (existsSync(root)) {
        try {
          for (const sub of readdirSync(root)) {
            if (existsSync(join(root, sub, "package.json")) && !out.includes(`${dir}/${sub}`)) {
              out.push(`${dir}/${sub}`);
            }
          }
        } catch {}
      }
    }
  }
  return out;
}

function detectFrontend(cwd) {
  const pkgPath = join(cwd, "package.json");
  if (existsSync(pkgPath)) {
    let pj;
    try {
      pj = JSON.parse(readFileSync(pkgPath, "utf8"));
    } catch {
      pj = {};
    }
    const deps = { ...(pj.dependencies ?? {}), ...(pj.devDependencies ?? {}) };

    if (deps.next) {
      const appRouter = existsSync(join(cwd, "app")) || existsSync(join(cwd, "src/app"));
      return {
        framework: "Next.js",
        version: deps.next,
        detail: appRouter ? "App Router" : "Pages Router",
        patterns_key: appRouter ? "nextjs-app" : "nextjs-pages",
      };
    }
    if (deps["@remix-run/react"] || deps.remix || deps["@remix-run/node"]) {
      return { framework: "Remix", version: deps["@remix-run/react"] ?? deps.remix, detail: "data routing", patterns_key: "remix" };
    }
    if (deps.gatsby) {
      return { framework: "Gatsby", version: deps.gatsby, detail: null, patterns_key: "gatsby" };
    }
    if (deps.nuxt || deps.nuxt3) {
      return { framework: "Nuxt", version: deps.nuxt ?? deps.nuxt3, detail: null, patterns_key: "nuxt" };
    }
    if (deps["@sveltejs/kit"]) {
      return { framework: "SvelteKit", version: deps["@sveltejs/kit"], detail: null, patterns_key: "sveltekit" };
    }
    if (deps.svelte) {
      return { framework: "Svelte", version: deps.svelte, detail: "SPA", patterns_key: "svelte-spa" };
    }
    if (deps["@angular/core"]) {
      return { framework: "Angular", version: deps["@angular/core"], detail: null, patterns_key: "angular" };
    }
    if (deps.astro) {
      return { framework: "Astro", version: deps.astro, detail: null, patterns_key: "astro" };
    }
    if (deps["@solidjs/start"] || deps["solid-start"]) {
      return { framework: "SolidStart", version: deps["@solidjs/start"] ?? deps["solid-start"], detail: null, patterns_key: "solid-start" };
    }
    if (deps["solid-js"]) {
      return { framework: "SolidJS", version: deps["solid-js"], detail: "SPA", patterns_key: "solid-spa" };
    }
    if (deps["@builder.io/qwik"] || deps["@builder.io/qwik-city"]) {
      return { framework: "Qwik", version: deps["@builder.io/qwik"] ?? deps["@builder.io/qwik-city"], detail: null, patterns_key: "qwik" };
    }
    if (deps.vue) {
      return { framework: "Vue", version: deps.vue, detail: "SPA", patterns_key: "vue-spa" };
    }
    if (deps.react) {
      const detail = deps.vite ? "Vite" : deps["react-scripts"] ? "CRA" : "SPA";
      return { framework: "React", version: deps.react, detail, patterns_key: "react-spa" };
    }
  }

  if (existsSync(join(cwd, "index.html"))) {
    let html = "";
    try {
      html = readFileSync(join(cwd, "index.html"), "utf8");
    } catch {}
    if (html.match(/\bhx-(get|post|put|delete|patch|swap)\b/) || html.includes("htmx.org")) {
      return { framework: "HTMX", version: null, detail: "HTML attributes", patterns_key: "htmx" };
    }
    return { framework: "Vanilla HTML/JS", version: null, detail: "static", patterns_key: "vanilla" };
  }

  return null;
}

function availableStacksFor(detected) {
  const pk = detected?.patterns_key;
  if (pk === "nextjs-app" || pk === "nextjs-pages") {
    return STACKS;
  }
  return STACKS.filter((s) => s.id !== "nextjs-prisma");
}

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

function countSourceFiles(cwd, patterns_key) {
  const exts = EXT_FOR[patterns_key] ?? ["tsx", "jsx", "ts", "js", "vue", "svelte", "astro", "html"];
  const namePart = exts.map((e) => `-name "*.${e}"`).join(" -o ");
  try {
    const out = execSync(
      `find . -type f \\( ${namePart} \\) ` +
        `-not -path "*/node_modules/*" -not -path "*/.next/*" -not -path "*/.nuxt/*" ` +
        `-not -path "*/.svelte-kit/*" -not -path "*/.astro/*" -not -path "*/.angular/*" ` +
        `-not -path "*/dist/*" -not -path "*/build/*" -not -path "*/.git/*" -not -path "*/out/*" | wc -l`,
      { cwd, encoding: "utf8" }
    );
    return parseInt(out.trim(), 10);
  } catch {
    return null;
  }
}

async function install() {
  banner();
  if (process.platform === "win32") {
    fail("Windows is not supported (the install needs symlinks + Unix tooling).");
    dim("Use WSL2 or run on macOS/Linux.");
    blank();
    process.exit(1);
  }
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
  if (pkgRoot.includes("/_npx/") || pkgRoot.includes("\\_npx\\")) {
    warn("install source is npx's cache — the symlink may break when the cache is cleared.");
    dim("For a durable install: `npm i -g backend-design` then `backend-design install`, or clone the repo and run `node bin/backend-design.mjs install` from the clone.");
  }
  blank();
  console.log(pc.bold("  Next steps"));
  console.log(`  ${pc.dim("1.")} ${pc.dim("cd into a frontend project (any modern framework)")}`);
  console.log(`  ${pc.dim("2.")} ${pc.cyan("backend-design start")}  ${pc.dim("# detect frontend, pick stack, write config")}`);
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
    fail("no frontend detected in this directory");
    dim("expected one of:");
    dim("  - package.json with react/next/vue/nuxt/svelte/angular/astro/solid/qwik/remix/gatsby");
    dim("  - index.html (vanilla or HTMX)");
    blank();
    const ws = detectWorkspace(cwd);
    if (ws.length) {
      dim("this looks like a workspace root. cd into one of these and re-run:");
      for (const p of ws) dim(`  - ${p}`);
      blank();
    }
    process.exit(1);
  }
  const versionStr = front.version ? pc.dim(front.version) : "";
  const detailStr = front.detail ? pc.dim(`(${front.detail})`) : "";
  ok(`${front.framework} ${versionStr} ${detailStr}`.trim());

  const fileCount = countSourceFiles(cwd, front.patterns_key);
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

  const stacks = availableStacksFor(front);
  if (stacks.length < STACKS.length) {
    dim(`(${STACKS.length - stacks.length} stack(s) hidden because they require a Next.js frontend)`);
    blank();
  }
  step("Choose your backend stack");
  const stackResp = await prompts(
    {
      type: "select",
      name: "stack",
      message: "stack",
      choices: stacks.map((s) => ({
        title: s.label,
        description: s.tagline,
        value: s.id,
      })),
      initial: 0,
    },
    { onCancel: () => process.exit(130) }
  );
  if (!stackResp.stack) process.exit(130);
  const stack = stacks.find((s) => s.id === stackResp.stack);
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

  const pkgManager = detectPackageManager(cwd);
  ok(`detected package manager: ${pkgManager}`);
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
    pkg_manager: pkgManager,
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
  console.log(`  ${pc.dim("stack:")}     ${stack.label}`);
  console.log(`  ${pc.dim("auth:")}      ${authResp.auth}`);
  console.log(`  ${pc.dim("output:")}    ${dirResp.out}`);
  console.log(`  ${pc.dim("pkg mgr:")}   ${pkgManager}`);
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
