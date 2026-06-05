#!/usr/bin/env node
// render-design.mjs — deterministically render ./backend-design.md from .backend-design/state/*.json.
// Mirrors the 8-section structure documented in SKILL.md so reviewers get a stable diff between runs.

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { isMainModule } from "./is-main.mjs";

const STATE_FILES = [
  "screens.json",
  "components.json",
  "endpoints.json",
  "forms.json",
  "entities.json",
  "relationships.json",
  "auth.json",
  "open_questions.json",
];

export function summarizeDesign(cwd = process.cwd()) {
  const state = loadState(cwd);
  const allEndpoints = state.endpoints ?? [];
  const internalEndpoints = allEndpoints.filter((e) => !e.is_external);
  const externalEndpoints = allEndpoints.filter((e) => e.is_external);
  const placeholderEndpoints = allEndpoints.filter((e) => e.temporary);
  const auth = state.auth ?? null;

  const epKeys = new Set(
    internalEndpoints.filter((e) => e.method && e.path).map((e) => `${e.method.toUpperCase()} ${e.path}`)
  );
  let covered = 0;
  let flagged = 0;
  for (const s of state.screens ?? []) {
    for (const f of s.data_fetches ?? []) {
      const key = `${(f.method ?? "GET").toUpperCase()} ${f.url ?? ""}`;
      if (epKeys.has(key)) covered++;
      else flagged++;
    }
  }
  const unwiredButtons = (state.forms?.standalone_buttons ?? []).filter((b) => {
    if (b.action !== "api_call") return false;
    if (!b.target) return true;
    const [method, ...rest] = b.target.split(" ");
    return !epKeys.has(`${(method ?? "").toUpperCase()} ${rest.join(" ")}`);
  }).length;

  const questions = Array.isArray(state.open_questions) ? state.open_questions : [];
  const skepticCount = questions.filter((q) => q?.category === "skeptic").length;
  return {
    entity_count: (state.entities ?? []).length,
    table_count: (state.entities ?? []).length,
    endpoint_count: internalEndpoints.length,
    external_endpoint_count: externalEndpoints.length,
    placeholder_count: placeholderEndpoints.length,
    webhook_count: allEndpoints.filter((e) => e.is_webhook).length,
    screen_count: (state.screens ?? []).length,
    relationship_count: (state.relationships ?? []).length,
    auth_enabled: !!(auth && auth.strategy && auth.strategy !== "none"),
    auth_strategy: auth?.strategy ?? null,
    open_question_count: questions.length,
    skeptic_count: skepticCount,
    product_question_count: questions.length - skepticCount,
    coverage_check: { covered, flagged, unwired_buttons: unwiredButtons },
  };
}

export function renderDesign(cwd = process.cwd()) {
  const state = loadState(cwd);
  const config = loadJson(join(cwd, ".backend-design", "config.json")) ?? {};
  const lines = [];

  lines.push("# Backend design", "");
  lines.push(overview(state, config), "");
  lines.push("## Entity map", "");
  lines.push(...entityMap(state), "");
  lines.push("## Data model", "");
  lines.push(...dataModel(state), "");
  lines.push("## API endpoints", "");
  lines.push(...endpointsSection(state), "");
  lines.push("## Auth model", "");
  lines.push(...authSection(state), "");
  lines.push("## External integrations", "");
  lines.push(...externalSection(state), "");
  lines.push("## Coverage check", "");
  lines.push(...coverageSection(state), "");
  lines.push("## Open questions", "");
  lines.push(...openQuestions(state), "");

  return lines.join("\n").replace(/\n{3,}/g, "\n\n");
}

function loadState(cwd) {
  const dir = join(cwd, ".backend-design", "state");
  const out = {};
  for (const f of STATE_FILES) {
    const p = join(dir, f);
    if (!existsSync(p)) continue;
    try {
      out[f.replace(".json", "")] = JSON.parse(readFileSync(p, "utf8"));
    } catch {
      // Validator surfaces parse errors elsewhere; render with whatever we have.
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

function overview(state, config) {
  const entities = state.entities ?? [];
  const endpoints = (state.endpoints ?? []).filter((e) => !e.is_external);
  const screens = state.screens ?? [];
  const auth = state.auth;
  const stack = config?.stack?.label ?? "(unspecified stack)";
  const fw = config?.frontend?.framework ?? "the frontend";
  const authBit = auth?.strategy === "jwt" ? `${auth.algorithm ?? "JWT"}-based auth` : "no auth";
  return (
    `Inferred from ${fw}: **${pluralN(entities.length, "entity", "entities")}**, ` +
    `**${pluralN(endpoints.length, "endpoint")}**, ` +
    `**${pluralN(screens.length, "screen")}**, ${authBit}. Target stack: ${stack}.`
  );
}

function pluralN(count, singular, plural = null) {
  if (count === 1) return `1 ${singular}`;
  return `${count} ${plural ?? singular + "s"}`;
}

function entityMap(state) {
  const entities = state.entities ?? [];
  const rels = state.relationships ?? [];
  if (!entities.length) return ["_No entities inferred._"];

  const out = [];
  const relsByFrom = new Map();
  for (const r of rels) {
    if (!relsByFrom.has(r.from)) relsByFrom.set(r.from, []);
    relsByFrom.get(r.from).push(r);
  }
  for (const ent of [...entities].sort(byName)) {
    out.push(`- **${ent.name}** (\`${ent.table ?? snake(ent.name)}\`)`);
    const outgoing = relsByFrom.get(ent.name) ?? [];
    for (const r of outgoing.sort((a, b) => a.to.localeCompare(b.to))) {
      out.push(`  - ${r.type} → ${r.to}${r.fk ? ` via \`${r.fk}\`` : ""}${r.on_delete ? ` (on delete: ${r.on_delete})` : ""}`);
    }
  }
  return out;
}

function dataModel(state) {
  const entities = state.entities ?? [];
  if (!entities.length) return ["_No entities to render._"];
  const out = [];
  for (const ent of [...entities].sort(byName)) {
    out.push(`### ${ent.name}`, "");
    out.push(`Table: \`${ent.table ?? snake(ent.name)}\``, "");
    out.push("| Column | Type | Constraints | Default |");
    out.push("|---|---|---|---|");
    for (const f of ent.fields ?? []) {
      const cons = [];
      if (f.pk) cons.push("PK");
      if (f.required) cons.push("NOT NULL");
      if (f.unique) cons.push("UNIQUE");
      if (f.fk) cons.push(`FK → ${f.fk}`);
      out.push(`| \`${f.name}\` | \`${f.type}\` | ${cons.join(", ") || "—"} | ${f.default ? `\`${f.default}\`` : "—"} |`);
    }
    if (ent.indexes?.length) {
      out.push("", "Indexes:");
      for (const idx of ent.indexes) {
        const cols = (idx.columns ?? []).map((c) => `\`${c}\``).join(", ");
        out.push(`- ${cols}${idx.unique ? " (unique)" : ""}`);
      }
    }
    out.push("");
  }
  return out;
}

function endpointsSection(state) {
  const endpoints = (state.endpoints ?? []).filter((e) => !e.is_external);
  if (!endpoints.length) return ["_No internal endpoints inferred._"];

  const sorted = [...endpoints].sort((a, b) => {
    const pa = a.path ?? "";
    const pb = b.path ?? "";
    if (pa !== pb) return pa.localeCompare(pb);
    return (a.method ?? "").localeCompare(b.method ?? "");
  });

  const out = [];
  out.push("| Method | Path | Auth | Body | Response | Triggered by |");
  out.push("|---|---|---|---|---|---|");
  for (const ep of sorted) {
    const method = ep.method ?? "?";
    const path = ep.path ?? "?";
    const auth = ep.auth ?? "—";
    const role = ep.required_role ? ` (role: ${fmtRole(ep.required_role)})` : "";
    const body = ep.request_body && Object.keys(ep.request_body).length ? "`" + Object.keys(ep.request_body).join(", ") + "`" : "—";
    const response = ep.response ? "`" + (typeof ep.response === "string" ? ep.response : JSON.stringify(ep.response)) + "`" : "—";
    const trig = (ep.triggered_by ?? []).slice(0, 2).join(", ") || (ep.is_webhook ? `webhook (${ep.webhook_source ?? "?"})` : "—");
    const flags = [];
    if (ep.temporary) flags.push("⚠ placeholder");
    if (ep.is_webhook) flags.push("webhook");
    if (ep.content_type === "multipart/form-data") flags.push("multipart");
    const methodCell = flags.length ? `\`${method}\`<br>_${flags.join(", ")}_` : `\`${method}\``;
    out.push(`| ${methodCell} | \`${path}\` | ${auth}${role} | ${body} | ${response} | ${trig} |`);
  }

  const placeholders = sorted.filter((ep) => ep.temporary);
  if (placeholders.length) {
    out.push("", "### Placeholder endpoints", "");
    out.push("These were scaffolded from orphan UI signals (vibe-coder mode). Paths and methods are best guesses — review `backend-design-next-steps.md` and replace before shipping.");
    out.push("");
    for (const ep of placeholders) {
      out.push(`- \`${ep.method} ${ep.path}\` — ${ep.placeholder_reason ?? "(no reason given)"}`);
    }
  }
  return out;
}

function authSection(state) {
  const auth = state.auth;
  if (!auth) return ["_No auth model declared._"];
  const out = [];
  out.push(`- **Strategy**: \`${auth.strategy}\``);
  if (auth.strategy === "jwt") {
    out.push(`- **Algorithm**: \`${auth.algorithm ?? "—"}\``);
    out.push(`- **Expiry**: \`${auth.expiry ?? "—"}\``);
    out.push(`- **Secret env var**: \`${auth.secret_env ?? "JWT_SECRET"}\``);
  }
  if (auth.password_hash) out.push(`- **Password hashing**: \`${auth.password_hash}\`${auth.bcrypt_cost ? ` (cost ${auth.bcrypt_cost})` : ""}`);
  if (auth.inferred_from && auth.inferred_from !== "signup_form" && auth.inferred_from !== "login_form") {
    out.push(`- **Inferred from**: \`${auth.inferred_from}\` (no login/signup form in the UI — backend was scaffolded from this signal; the next-steps doc has details)`);
  }
  out.push(`- **Signup**: ${yesNo(auth.signup)}`);
  out.push(`- **Email verification**: ${yesNo(auth.email_verification)}`);
  out.push(`- **Password reset**: ${yesNo(auth.password_reset)}`);
  if (auth.oauth_providers?.length) {
    const names = auth.oauth_providers.map((p) => (typeof p === "string" ? p : p?.name ?? "?"));
    out.push(`- **OAuth providers**: ${names.join(", ")}`);
  }
  if (auth.rbac_roles?.length) {
    out.push(`- **RBAC roles**: ${auth.rbac_roles.map((r) => `\`${r}\``).join(", ")}`);
  }
  return out;
}

function externalSection(state) {
  const ext = (state.endpoints ?? []).filter((e) => e.is_external);
  if (!ext.length) return ["_No third-party integrations detected._"];

  const groups = new Map();
  for (const ep of ext) {
    const origin = ep.external_origin ?? "(unknown origin)";
    if (!groups.has(origin)) groups.set(origin, []);
    groups.get(origin).push(ep);
  }
  const out = [];
  for (const [origin, eps] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    out.push(`### ${origin}`, "");
    for (const ep of eps.sort((a, b) => (a.path ?? "").localeCompare(b.path ?? ""))) {
      out.push(`- \`${ep.method} ${ep.path}\`${(ep.triggered_by ?? []).length ? ` — from ${ep.triggered_by[0]}` : ""}`);
    }
    out.push("");
  }
  out.push("These are NOT scaffolded in the generated backend — they document third-party services the frontend depends on.");
  return out;
}

function coverageSection(state) {
  const screens = state.screens ?? [];
  const endpoints = state.endpoints ?? [];
  const buttons = state.forms?.standalone_buttons ?? [];
  const epKeys = new Set(endpoints.filter((e) => e.method && e.path).map((e) => `${e.method.toUpperCase()} ${e.path}`));

  const out = [];
  out.push("| Screen | Fetches | Mapped to backend? |");
  out.push("|---|---|---|");
  for (const s of [...screens].sort((a, b) => (a.id ?? a.file ?? "").localeCompare(b.id ?? b.file ?? ""))) {
    const fetches = s.data_fetches ?? [];
    if (!fetches.length) {
      out.push(`| ${s.id ?? s.file} | _(none)_ | n/a |`);
      continue;
    }
    for (const f of fetches) {
      const key = `${(f.method ?? "GET").toUpperCase()} ${f.url ?? ""}`;
      const mapped = epKeys.has(key) ? "✓" : "✗ unmapped";
      out.push(`| ${s.id ?? s.file} | \`${key}\` | ${mapped} |`);
    }
  }

  const unwired = buttons.filter((b) => {
    if (b.action !== "api_call") return false;
    if (!b.target) return true;
    const [method, ...rest] = b.target.split(" ");
    return !epKeys.has(`${(method ?? "").toUpperCase()} ${rest.join(" ")}`);
  });
  if (unwired.length) {
    out.push("", "**Unwired buttons** (no matching endpoint — see `backend-design-next-steps.md`):");
    for (const b of unwired) out.push(`- "${b.label ?? "(unlabeled)"}" at \`${b.file ?? "?"}\``);
  }
  return out;
}

function openQuestions(state) {
  // Source of truth: synthesis-agent-written open_questions.json. Each item carries question,
  // recommendation, optional context + evidence. When the synthesis agent has spoken, we defer
  // entirely — it has the project context that heuristics can't. Heuristics are a fallback only
  // for runs where the synthesis agent wrote nothing (or wasn't run yet).
  const richQuestions = Array.isArray(state.open_questions) ? state.open_questions : [];
  const out = [];

  out.push("These are product-intent ambiguities for **you** to resolve before approving the design. Environmental and wire-up gaps live in [backend-design-next-steps.md](backend-design-next-steps.md).", "");

  if (richQuestions.length) {
    const productQs = richQuestions.filter((q) => q?.category !== "skeptic");
    const skepticQs = richQuestions.filter((q) => q?.category === "skeptic");

    for (const q of productQs) renderQuestion(out, q);

    if (skepticQs.length) {
      out.push("### Skeptic-pass findings", "");
      out.push("Adversarial review surfaced these concrete concerns. They are not blockers — each has a recommendation; accept or reject per finding.", "");
      const byAxis = new Map();
      for (const q of skepticQs) {
        const axis = q.axis ?? "other";
        if (!byAxis.has(axis)) byAxis.set(axis, []);
        byAxis.get(axis).push(q);
      }
      for (const [axis, qs] of [...byAxis.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        for (const q of qs) renderQuestion(out, q, axis);
      }
    }
    return out;
  }

  // Heuristic fallback only when the synthesis agent produced no rich questions.
  const heuristics = heuristicQuestions(state);
  if (!heuristics.length) {
    return ["_No open product-intent questions surfaced._"];
  }
  for (const h of heuristics) {
    out.push(`### ${h.title}`, "");
    out.push(h.question, "");
    out.push(`**Recommendation:** ${h.recommendation}`, "");
  }
  return out;
}

function renderQuestion(out, q, axisLabel = null) {
  const title = q.title ?? q.id ?? "Question";
  const heading = axisLabel ? `#### [${axisLabel}] ${title}` : `### ${title}`;
  out.push(heading, "");
  if (q.question) out.push(q.question, "");
  if (q.context) out.push(`_Context:_ ${q.context}`, "");
  if (q.recommendation) out.push(`**Recommendation:** ${q.recommendation}`, "");
  if (q.evidence?.length) out.push(`_Evidence: ${q.evidence.join(", ")}_`, "");
}

function heuristicQuestions(state) {
  const auth = state.auth;
  const surface = state.forms?.auth_surface ?? {};
  const out = [];
  if (auth?.signup && !surface.password_reset?.present && !auth.password_reset) {
    out.push({
      title: "Password reset flow",
      question: "No password-reset flow detected in the frontend.",
      recommendation: "Add one for v1. Even if the UI isn't built yet, users will lock themselves out within days and you'll be doing manual resets. Codegen can scaffold `POST /auth/password-reset/request` + `/confirm` if you set `auth.password_reset: true`.",
    });
  }
  if (auth?.signup && !surface.email_verification?.present && !auth.email_verification) {
    out.push({
      title: "Email verification",
      question: "No email-verification flow detected.",
      recommendation: "Skip for v1 unless you handle payments or sensitive data. Verification adds friction and most apps add it later when abuse appears. Set `auth.email_verification: true` to opt in.",
    });
  }
  const placeholderCount = (state.endpoints ?? []).filter((e) => e.temporary).length;
  if (placeholderCount) {
    out.push({
      title: `${placeholderCount} placeholder endpoint(s)`,
      question: `${placeholderCount} endpoint(s) were scaffolded from orphan UI signals. Their paths and methods are best guesses.`,
      recommendation: "Walk through each one in the API endpoints table above (marked ⚠ placeholder) and either replace with a real handler or delete the button on the frontend. Do not ship placeholders to production.",
    });
  }
  return out;
}

function fmtRole(role) {
  if (Array.isArray(role)) return role.join("|");
  return role;
}

function yesNo(v) {
  return v ? "yes" : "no";
}

function byName(a, b) {
  return (a.name ?? "").localeCompare(b.name ?? "");
}

function snake(name) {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

export function runRender(cwd = process.cwd()) {
  const out = renderDesign(cwd);
  writeFileSync(join(cwd, "backend-design.md"), out.endsWith("\n") ? out : out + "\n");
  const summary = summarizeDesign(cwd);
  writeFileSync(
    join(cwd, ".backend-design", "state", "design-summary.json"),
    JSON.stringify(summary, null, 2) + "\n"
  );
  return out;
}

if (isMainModule(import.meta.url)) {
  runRender();
  console.log("Wrote ./backend-design.md");
}
