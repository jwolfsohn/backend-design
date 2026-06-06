#!/usr/bin/env node
// detect-gaps.mjs — deterministic vibe-coder gap detector.
//
// Reads `.backend-design/state/*.json` + `.backend-design/config.json` + `./.env*` + `./package.json`.
// Writes `.backend-design/gaps.json` and `./backend-design-next-steps.md`.
// Idempotent. Safe to re-run; closure detection diffs against the previous `gaps.json`.

import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { isMainModule } from "./is-main.mjs";
import { loadJson, atomicWriteFileSync } from "./state.mjs";

const SKILL_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const TEMPLATES_PATH = join(SKILL_DIR, "prompts", "next-steps-templates.md");

const STATE_FILES = ["screens.json", "components.json", "endpoints.json", "forms.json", "entities.json", "auth.json"];

const SERVICE_DEP = {
  supabase: "@supabase/supabase-js",
  stripe: "stripe",
  openai: "openai",
};

export function detectGaps(cwd = process.cwd()) {
  const stateDir = join(cwd, ".backend-design", "state");
  const state = loadState(stateDir);
  const config = loadJson(join(cwd, ".backend-design", "config.json"));
  const pkg = loadJson(join(cwd, "package.json")) ?? { dependencies: {}, devDependencies: {} };
  const env = loadEnvVars(cwd);

  const detected = [];
  detected.push(...detectMissingEnvVars(state, config, env));
  detected.push(...detectMissingAuthUi(state));
  detected.push(...detectUnwiredButtons(state));
  detected.push(...detectPlaceholderEndpoints(state));
  detected.push(...detectExternalAccounts(state, pkg));

  return mergeWithPersisted(detected, loadJson(join(cwd, ".backend-design", "gaps.json")) ?? []);
}

function loadState(stateDir) {
  const state = {};
  if (!existsSync(stateDir)) return state;
  for (const f of STATE_FILES) {
    const p = join(stateDir, f);
    if (!existsSync(p)) continue;
    try {
      state[f.replace(".json", "")] = JSON.parse(readFileSync(p, "utf8"));
    } catch {
      // Skip unparseable files; the validator will surface parse errors elsewhere.
    }
  }
  return state;
}

// Files considered "real" sources of env values. Mirrors Next.js's load order
// loosely — .env.example is excluded because it's a template, not a source.
const ENV_FILES = [
  ".env",
  ".env.local",
  ".env.development",
  ".env.development.local",
  ".env.production",
  ".env.production.local",
];

function loadEnvVars(cwd) {
  const env = new Set();
  for (const f of ENV_FILES) {
    const p = join(cwd, f);
    if (!existsSync(p)) continue;
    const raw = readFileSync(p, "utf8");
    for (const line of raw.split("\n")) {
      if (line.trim().startsWith("#")) continue;
      // Accept lowercase keys and `export FOO=bar` shell syntax; uppercase the
      // captured name before insertion so downstream `env.has("DATABASE_URL")`
      // checks hit even when the file contains `database_url=…`.
      const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!m) continue;
      const value = m[2].trim().replace(/^["']|["']$/g, "");
      if (value) env.add(m[1].toUpperCase());
    }
  }
  return env;
}

function detectMissingEnvVars(state, config, env) {
  const gaps = [];
  const auth = state.auth;
  const endpoints = state.endpoints ?? [];

  // The s2ai-schema stack emits a .mmd file and stops — there is no runtime to configure.
  // DATABASE_URL, JWT_SECRET, webhook/OAuth secrets, etc. all live in whatever runtime
  // s2ai's pipeline produces, not here.
  if (config?.stack?.id === "s2ai-schema") {
    return gaps;
  }

  if (config?.stack?.database === "postgres" && !env.has("DATABASE_URL")) {
    gaps.push({
      type: "missing_env_var",
      specifier: "DATABASE_URL",
      severity: "blocker",
      what: "DATABASE_URL is not set in .env",
      evidence: [".env"],
    });
  }

  if (auth?.strategy === "jwt") {
    const v = auth.secret_env ?? "JWT_SECRET";
    if (!env.has(v)) {
      gaps.push({
        type: "missing_env_var",
        specifier: v,
        severity: "blocker",
        what: `${v} is not set in .env`,
        evidence: [".env"],
      });
    }
  }

  if (auth?.strategy === "session") {
    if (!env.has("SESSION_SECRET")) {
      gaps.push({
        type: "missing_env_var",
        specifier: "SESSION_SECRET",
        severity: "blocker",
        what: "SESSION_SECRET is not set in .env",
        evidence: [".env"],
      });
    }
    if (auth.store === "redis" && !env.has("REDIS_URL")) {
      gaps.push({
        type: "missing_env_var",
        specifier: "REDIS_URL",
        severity: "blocker",
        what: "REDIS_URL is not set in .env (auth.store is 'redis')",
        evidence: [".env"],
      });
    }
  }

  // Per-source webhook secrets (stripe, github, etc.). Source name is inferred at Phase 1.
  const webhookSources = new Set();
  for (const ep of endpoints) {
    if (!ep.is_webhook) continue;
    const source = (ep.webhook_source ?? "").toLowerCase().trim();
    if (source) webhookSources.add(source);
  }
  for (const source of webhookSources) {
    const v = `${source.toUpperCase()}_WEBHOOK_SECRET`;
    if (!env.has(v)) {
      gaps.push({
        type: "missing_env_var",
        specifier: v,
        severity: "blocker",
        what: `${v} is not set in .env`,
        evidence: [".env"],
      });
    }
  }

  const stripeOutbound = endpoints.some((ep) => ep.is_external && (ep.external_origin ?? "").toLowerCase().includes("stripe"));
  if (stripeOutbound && !env.has("STRIPE_SECRET_KEY")) {
    gaps.push({
      type: "missing_env_var",
      specifier: "STRIPE_SECRET_KEY",
      severity: "blocker",
      what: "STRIPE_SECRET_KEY is not set in .env",
      evidence: [".env"],
    });
  }

  // Email provider: required by codegen's lib/email.ts stub if password reset or email verification is on.
  if (auth?.password_reset || auth?.email_verification) {
    const emailVars = ["SENDGRID_API_KEY", "RESEND_API_KEY", "MAILGUN_API_KEY", "POSTMARK_API_KEY", "SMTP_HOST"];
    if (!emailVars.some((v) => env.has(v))) {
      gaps.push({
        type: "missing_env_var",
        specifier: "EMAIL_PROVIDER",
        severity: "blocker",
        what: "Auth flow requires email delivery but no provider key (SENDGRID/RESEND/MAILGUN/POSTMARK_API_KEY or SMTP_HOST) is set in .env",
        evidence: [".env"],
      });
    }
  }

  // Multipart endpoints: codegen writes to UPLOADS_DIR. Default works, so warning, not blocker.
  // Endpoint-level content_type is set in Phase 2, so when this runs standalone after Phase 1
  // fall back to the form-level multipart flag from forms.json.
  const forms = state.forms?.forms ?? [];
  const hasMultipart =
    endpoints.some((ep) => ep.content_type === "multipart/form-data") ||
    forms.some((f) => f.multipart === true);
  if (hasMultipart && !env.has("UPLOADS_DIR")) {
    gaps.push({
      type: "missing_env_var",
      specifier: "UPLOADS_DIR",
      severity: "warning",
      what: "Multipart uploads detected but UPLOADS_DIR is not set — codegen will default to ./uploads/",
      evidence: [".env"],
    });
  }

  for (const provider of auth?.oauth_providers ?? []) {
    const name = typeof provider === "string" ? provider : provider?.name;
    if (!name) continue;
    const up = name.toUpperCase();
    for (const suffix of ["CLIENT_ID", "CLIENT_SECRET"]) {
      const v = `${up}_${suffix}`;
      if (!env.has(v)) {
        gaps.push({
          type: "missing_env_var",
          specifier: v,
          severity: "blocker",
          what: `${v} is not set in .env`,
          evidence: [".env"],
        });
      }
    }
  }

  return gaps;
}

function detectMissingAuthUi(state) {
  const gaps = [];
  const auth = state.auth;
  const authSurface = state.forms?.auth_surface ?? {};
  const screens = state.screens ?? [];
  const endpoints = state.endpoints ?? [];

  // Authoritative signal: either Phase 2's auth.json says signup/login are on, OR
  // endpoints.json contains the auth endpoints. The endpoint fallback lets `gaps` work
  // when invoked as a standalone CLI command before Phase 2 has run.
  const hasSignupEndpoint = endpoints.some((ep) => ep.method === "POST" && /\/auth\/signup$/.test(ep.path ?? ""));
  const hasLoginEndpoint = endpoints.some((ep) => ep.method === "POST" && /\/auth\/login$/.test(ep.path ?? ""));
  const wantsSignup = auth?.signup || hasSignupEndpoint;
  const wantsLogin = auth?.signup || hasLoginEndpoint || authSurface.signup?.present;

  // When auth was inferred from a non-UI signal (auth_required screens, token storage keys,
  // bearer headers, /api/auth/* fetches), the design is correct but the UI is missing —
  // reword the blocker so it's clear the gap is the form, not the design.
  const inferredFrom = auth?.inferred_from;
  const inferredWithoutUi =
    inferredFrom && inferredFrom !== "signup_form" && inferredFrom !== "login_form";
  const inferredSuffix = inferredWithoutUi
    ? ` (auth was inferred from ${inferredFrom}; add the UI or remove the inferring signal)`
    : "";

  if (wantsSignup && !authSurface.signup?.present) {
    gaps.push({
      type: "missing_auth_ui",
      specifier: "signup",
      severity: "blocker",
      what: `Signup endpoint exists in the design but the frontend has no signup form${inferredSuffix}`,
      evidence: ["forms.json"],
    });
  }
  if (wantsLogin && !authSurface.login?.present) {
    gaps.push({
      type: "missing_auth_ui",
      specifier: "login",
      severity: "blocker",
      what: `Login endpoint exists in the design but the frontend has no login form${inferredSuffix}`,
      evidence: ["forms.json"],
    });
  }

  const noAuthSurface = !authSurface.signup?.present && !authSurface.login?.present;
  if (noAuthSurface) {
    const gated = screens.filter((s) => s.auth_required);
    if (gated.length) {
      gaps.push({
        type: "missing_auth_ui",
        specifier: "screen_gate",
        severity: "blocker",
        what: `${gated.length} screen(s) require auth but the frontend has no login or signup forms`,
        evidence: gated.slice(0, 3).map((s) => s.file).filter(Boolean),
      });
    }
  }

  return gaps;
}

function detectUnwiredButtons(state) {
  const gaps = [];
  const buttons = state.forms?.standalone_buttons ?? [];
  const endpoints = state.endpoints ?? [];
  const endpointKeys = new Set(
    endpoints.filter((ep) => ep.method && ep.path).map((ep) => `${ep.method.toUpperCase()} ${ep.path}`)
  );
  // Buttons whose file:line is already named as a trigger for a temporary endpoint are "covered" —
  // they get surfaced as `placeholder_endpoint` gaps instead, which is more useful (it names the
  // scaffolded method/path the user needs to review).
  const placeholderTriggers = new Set(
    endpoints
      .filter((ep) => ep.temporary)
      .flatMap((ep) => ep.triggered_by ?? [])
  );

  for (const btn of buttons) {
    if (btn.action !== "api_call") continue;
    if (btn.file && placeholderTriggers.has(btn.file)) continue;

    let unwired = false;
    if (!btn.target) {
      unwired = true;
    } else {
      const [method, ...rest] = btn.target.split(" ");
      const path = rest.join(" ");
      const key = `${(method ?? "").toUpperCase()} ${path}`;
      if (!endpointKeys.has(key)) unwired = true;
    }

    if (unwired) {
      const label = btn.label ?? "(unlabeled button)";
      const evidenceFile = (btn.file ?? "").split(":")[0];
      gaps.push({
        type: "unwired_button",
        specifier: label,
        severity: "warning",
        what: `"${label}" button has no working handler`,
        evidence: [btn.file ?? evidenceFile ?? "(unknown location)"],
        context: { label, file: btn.file ?? evidenceFile },
      });
    }
  }

  return gaps;
}

function detectPlaceholderEndpoints(state) {
  const gaps = [];
  for (const ep of state.endpoints ?? []) {
    if (!ep.temporary) continue;
    const key = `${(ep.method ?? "").toUpperCase()} ${ep.path ?? ""}`.trim();
    gaps.push({
      type: "placeholder_endpoint",
      specifier: key,
      severity: "warning",
      what: `${key} is a placeholder — needs real implementation`,
      evidence: ep.triggered_by ?? ["endpoints.json"],
      context: {
        method: ep.method,
        path: ep.path,
        reason: ep.placeholder_reason ?? "",
        trigger: (ep.triggered_by ?? [])[0] ?? "",
      },
    });
  }
  return gaps;
}

function detectExternalAccounts(state, pkg) {
  const gaps = [];
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const endpoints = state.endpoints ?? [];

  const services = new Set();
  if (deps["@supabase/supabase-js"]) services.add("supabase");
  if (deps.stripe || deps["@stripe/stripe-js"]) services.add("stripe");

  for (const ep of endpoints) {
    if (!ep.is_external) continue;
    const origin = (ep.external_origin ?? "").toLowerCase();
    if (origin.includes("stripe")) services.add("stripe");
    if (origin.includes("openai")) services.add("openai");
    if (origin.includes("supabase")) services.add("supabase");
  }

  for (const service of services) {
    const dep = SERVICE_DEP[service];
    gaps.push({
      type: "external_account_unconfirmed",
      specifier: service,
      severity: "info",
      what: `${service} integration detected — confirm you have an account set up`,
      evidence: dep && deps[dep] ? [`package.json (${dep})`] : ["endpoints.json"],
      context: { service },
    });
  }

  return gaps;
}

function naturalKey(gap) {
  // For unwired buttons, multiple buttons can share a file — disambiguate by label too.
  if (gap.type === "unwired_button") {
    const filePath = (gap.evidence?.[0] ?? "").split(":")[0].split("(")[0].trim();
    return `${gap.type}|${filePath}|${gap.specifier ?? ""}`;
  }
  return `${gap.type}|${gap.specifier ?? ""}`;
}

function mergeWithPersisted(detected, persisted) {
  const now = new Date().toISOString();
  const detectedByKey = new Map(detected.map((g) => [naturalKey(g), g]));
  const persistedByKey = new Map(persisted.map((g) => [naturalKey(g), g]));

  const out = [];

  for (const [key, g] of detectedByKey) {
    const prev = persistedByKey.get(key);
    if (prev && prev.status === "open") {
      out.push({ ...g, id: prev.id ?? key, status: "open", first_seen_at: prev.first_seen_at ?? now, closed_at: null });
    } else {
      out.push({ ...g, id: key, status: "open", first_seen_at: now, closed_at: null });
    }
  }

  for (const [key, g] of persistedByKey) {
    if (detectedByKey.has(key)) continue;
    if (g.status === "open") {
      out.push({ ...g, status: "closed", closed_at: now });
    } else {
      out.push(g);
    }
  }

  return out;
}

let templateCache = null;
function loadTemplates() {
  if (templateCache) return templateCache;
  templateCache = new Map();
  if (!existsSync(TEMPLATES_PATH)) return templateCache;
  const raw = readFileSync(TEMPLATES_PATH, "utf8");
  let key = null;
  let body = [];
  for (const line of raw.split("\n")) {
    const m = line.match(/^##\s+(.+?)\s*$/);
    if (m) {
      if (key) templateCache.set(key, body.join("\n").trim());
      key = m[1].trim();
      body = [];
    } else if (key) {
      body.push(line);
    }
  }
  if (key) templateCache.set(key, body.join("\n").trim());
  return templateCache;
}

function templateFor(gap) {
  const templates = loadTemplates();
  if (gap.specifier && templates.has(`${gap.type}:${gap.specifier}`)) {
    return templates.get(`${gap.type}:${gap.specifier}`);
  }
  return templates.get(gap.type) ?? "";
}

function substitute(body, gap) {
  const ctx = gap.context ?? {};
  return body
    .replace(/\{label\}/g, ctx.label ?? gap.specifier ?? "")
    .replace(/\{file\}/g, ctx.file ?? gap.evidence?.[0] ?? "")
    .replace(/\{evidence\}/g, gap.evidence?.[0] ?? "")
    .replace(/\{var\}/g, gap.specifier ?? "")
    .replace(/\{service\}/g, ctx.service ?? gap.specifier ?? "")
    .replace(/\{endpoint\}/g, gap.specifier ?? "")
    .replace(/\{method\}/g, ctx.method ?? "")
    .replace(/\{path\}/g, ctx.path ?? "")
    .replace(/\{trigger\}/g, ctx.trigger ?? gap.evidence?.[0] ?? "")
    .replace(/\{reason\}/g, ctx.reason ?? "");
}

export function renderNextSteps(gaps) {
  const open = gaps.filter((g) => g.status === "open");
  const closed = gaps.filter((g) => g.status === "closed");
  const bySeverity = { blocker: [], warning: [], info: [] };
  for (const g of open) (bySeverity[g.severity] ?? bySeverity.info).push(g);

  const lines = [];
  lines.push("# Backend setup — next steps");
  lines.push("");
  lines.push("This is your action checklist. For the design itself, see [backend-design.md](backend-design.md).");
  lines.push("");
  lines.push(`**${bySeverity.blocker.length} blocker(s) · ${bySeverity.warning.length} wire-up(s) · ${bySeverity.info.length} info item(s)**`);
  lines.push("");

  if (bySeverity.blocker.length) {
    lines.push("## 1. Setup required (blockers)");
    lines.push("");
    lines.push("Your generated backend will not run until each of these is resolved.");
    lines.push("");
    for (const g of bySeverity.blocker) lines.push(renderGap(g), "");
  }

  if (bySeverity.warning.length) {
    lines.push("## 2. Frontend wire-up");
    lines.push("");
    lines.push("The backend will run, but these UI signals don't connect to anything yet.");
    lines.push("");
    for (const g of bySeverity.warning) lines.push(renderGap(g), "");
  }

  if (bySeverity.info.length) {
    lines.push("## 3. External services to verify");
    lines.push("");
    for (const g of bySeverity.info) lines.push(renderGap(g), "");
  }

  if (closed.length) {
    lines.push("## Recently closed");
    lines.push("");
    for (const g of closed) {
      const when = g.closed_at ? g.closed_at.split("T")[0] : "";
      lines.push(`- ~~${g.what}~~${when ? ` _(closed ${when})_` : ""}`);
    }
    lines.push("");
  }

  if (!open.length) {
    lines.push(closed.length ? "All known gaps are closed. You're ready to scaffold." : "No gaps detected. You're ready to scaffold.");
    lines.push("");
  }

  return lines.join("\n");
}

function renderGap(gap) {
  const body = substitute(templateFor(gap), gap);
  const evidence = gap.evidence?.length ? `\n_Evidence: ${gap.evidence.join(", ")}_` : "";
  return `### [ ] ${gap.what}\n\n${body}${evidence}`;
}

export function runDetect(cwd = process.cwd()) {
  const baseDir = join(cwd, ".backend-design");
  if (!existsSync(baseDir)) {
    throw new Error(`${baseDir} not found. Run \`npx backend-design start\` then Phase 1 first.`);
  }
  const gaps = detectGaps(cwd);
  atomicWriteFileSync(join(baseDir, "gaps.json"), JSON.stringify(gaps, null, 2) + "\n");
  atomicWriteFileSync(join(cwd, "backend-design-next-steps.md"), renderNextSteps(gaps) + "\n");
  return gaps;
}

export function summarize(gaps) {
  const open = gaps.filter((g) => g.status === "open");
  return {
    blockers: open.filter((g) => g.severity === "blocker").length,
    warnings: open.filter((g) => g.severity === "warning").length,
    infos: open.filter((g) => g.severity === "info").length,
    closed: gaps.filter((g) => g.status === "closed").length,
  };
}

export function printResults(gaps) {
  const s = summarize(gaps);
  const open = gaps.filter((g) => g.status === "open");
  if (s.blockers) {
    console.log(`\n${s.blockers} blocker(s):`);
    for (const g of open.filter((g) => g.severity === "blocker")) console.log(`  ! ${g.what}`);
  }
  if (s.warnings) {
    console.log(`\n${s.warnings} wire-up(s):`);
    for (const g of open.filter((g) => g.severity === "warning")) console.log(`  - ${g.what}`);
  }
  if (s.infos) {
    console.log(`\n${s.infos} info item(s):`);
    for (const g of open.filter((g) => g.severity === "info")) console.log(`  i ${g.what}`);
  }
  if (s.closed) {
    console.log(`\n${s.closed} recently closed.`);
  }
  console.log();
  console.log("Wrote .backend-design/gaps.json and ./backend-design-next-steps.md");
  return s.blockers > 0 ? 1 : 0;
}

if (isMainModule(import.meta.url)) {
  try {
    process.exit(printResults(runDetect()));
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
