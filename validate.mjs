#!/usr/bin/env node
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { isMainModule } from "./scripts/is-main.mjs";
import { STATE_FILES } from "./scripts/state.mjs";

const VALID_REL_TYPES = ["one-to-one", "one-to-many", "many-to-one", "many-to-many"];

// Legal values for the `inferred_from_signal` endpoint escape-hatch field. Mirrored in
// SKILL.md (auth-signal section) and prompts/inventory/endpoints.md. Keep them in sync.
const LEGAL_INFERRED_SIGNALS = new Set([
  "auth_required_screen",
  "token_storage_key",
  "auth_header",
  "auth_path",
  "judgment:user_owned_mutations",
]);

// Signal-7 forbidden auth endpoints. Catches signup/login/logout (with/without hyphen and the
// register/signin/signout synonyms) at any depth of /auth/ nesting (/auth/, /api/auth/, /v1/auth/,
// etc.). Deliberately does NOT match /auth/refresh, /auth/me, or other auth-adjacent paths —
// those aren't endpoints signal 7 contracts against.
const FORBIDDEN_AUTH_ENDPOINT_RE = /^POST\s+(?:\/[a-z0-9-]+)*\/auth\/(?:sign-?up|register|log-?in|sign-?in|log-?out|sign-?out)\b/i;

export function validate(cwd = process.cwd()) {
  const stateDir = join(cwd, ".backend-design", "state");
  const errors = [];
  const warnings = [];
  const state = {};

  if (!existsSync(stateDir)) {
    errors.push(`${stateDir} not found. Run Phase 1 first.`);
    return { errors, warnings, state };
  }

  for (const f of STATE_FILES) {
    const path = join(stateDir, f);
    if (existsSync(path)) {
      try {
        state[f.replace(".json", "")] = JSON.parse(readFileSync(path, "utf8"));
      } catch (e) {
        errors.push(`Failed to parse ${f}: ${e.message}`);
      }
    }
  }
  if (errors.length) return { errors, warnings, state };

  const screens = state.screens ?? [];
  const components = state.components?.components ?? [];
  const endpoints = state.endpoints ?? [];
  const forms = state.forms?.forms ?? [];
  const standaloneButtons = state.forms?.standalone_buttons ?? [];
  const authSurface = state.forms?.auth_surface ?? {};
  const entities = state.entities ?? [];
  const relationships = state.relationships ?? [];
  const auth = state.auth ?? null;

  const entityByName = new Map(entities.map((e) => [e.name, e]));
  const componentNames = new Set(components.map((c) => c.name));
  const isPhase1Only = !entities.length && !relationships.length && !auth;

  if (!screens.length) errors.push("screens.json is empty — Agent 1 produced no screens");
  if (!components.length) errors.push("components.json is empty — Agent 2 produced no components");
  if (!forms.length && !standaloneButtons.length) {
    warnings.push("forms.json has no forms and no standalone buttons — confirm this is intentional");
  }

  for (const s of screens) {
    if (!s.file) errors.push(`Screen ${s.id ?? "?"} has no file`);
    if (!Array.isArray(s.evidence) || !s.evidence.length) {
      errors.push(`Screen ${s.id ?? s.file} has no evidence`);
    }
    for (const child of s.children ?? []) {
      if (!componentNames.has(child)) {
        warnings.push(`Screen ${s.id ?? s.file} references component '${child}' which is not in components.json`);
      }
    }
  }

  const endpointKeys = new Map();
  for (const ep of endpoints) {
    if (!ep.method || !ep.path) {
      errors.push(`Endpoint missing method or path: ${JSON.stringify(ep)}`);
      continue;
    }
    const key = `${ep.method.toUpperCase()} ${ep.path}`;
    if (endpointKeys.has(key)) {
      errors.push(`Duplicate endpoint: ${key} (already defined; check for accidental copies)`);
    }
    endpointKeys.set(key, ep);

    if (ep.is_external) {
      if (!ep.external_origin) {
        warnings.push(`External endpoint ${key} has no external_origin`);
      }
      continue;
    }

    if (!ep.triggered_by?.length && !ep.is_webhook && !ep.inferred_from_signal) {
      errors.push(`Endpoint ${key} has no UI trigger — frontend is the source of truth (set is_webhook:true for incoming webhooks, or inferred_from_signal:"<name>" when the endpoint was inferred from a non-UI signal like auth_required_screen, token_storage_key, auth_header, auth_path)`);
    }
    if (ep.is_webhook && ep.inferred_from_signal) {
      errors.push(`Endpoint ${key} has both is_webhook:true and inferred_from_signal — pick one; an endpoint is either an incoming webhook OR inferred from a non-UI signal, not both`);
    }
    if (ep.inferred_from_signal && !LEGAL_INFERRED_SIGNALS.has(ep.inferred_from_signal)) {
      errors.push(`Endpoint ${key} has inferred_from_signal:"${ep.inferred_from_signal}" — not in the legal set (${[...LEGAL_INFERRED_SIGNALS].join(", ")})`);
    }
    if (!isPhase1Only && !("auth" in ep)) {
      errors.push(`Endpoint ${key} is missing 'auth' field (expected 'required' or 'none')`);
    }
    if ("auth" in ep && !["required", "none"].includes(ep.auth)) {
      errors.push(`Endpoint ${key} has invalid auth value '${ep.auth}' (expected 'required' or 'none')`);
    }
    if (auth?.strategy === "none" && ep.auth === "required") {
      errors.push(`Endpoint ${key} requires auth but auth.strategy is 'none' — either change the endpoint to auth: 'none' or pick a real auth strategy`);
    }
    if (ep.required_role) {
      const declaredRoles = new Set(auth?.rbac_roles ?? []);
      const roles = Array.isArray(ep.required_role) ? ep.required_role : [ep.required_role];
      for (const role of roles) {
        if (!declaredRoles.has(role)) {
          errors.push(`Endpoint ${key} requires role '${role}' but it is not declared in auth.rbac_roles`);
        }
      }
      if (ep.auth !== "required") {
        errors.push(`Endpoint ${key} has required_role but auth is '${ep.auth}' (role gating requires auth: 'required')`);
      }
    }
  }

  for (const ent of entities) {
    if (!ent.name) errors.push(`Entity missing name: ${JSON.stringify(ent)}`);
    if (!ent.fields?.length) errors.push(`Entity ${ent.name} has no fields`);
    if (!ent.evidence?.length) errors.push(`Entity ${ent.name} has no evidence`);
    const fieldNames = new Set();
    for (const f of ent.fields ?? []) {
      if (!f.name) errors.push(`Entity ${ent.name} has a field with no name`);
      if (!f.type) errors.push(`Entity ${ent.name}.${f.name ?? "?"} has no type`);
      if (fieldNames.has(f.name)) errors.push(`Entity ${ent.name} has duplicate field: ${f.name}`);
      fieldNames.add(f.name);
      if (f.name === "version") {
        if (f.type !== "integer") errors.push(`Entity ${ent.name}.version must be type 'integer' (got '${f.type}')`);
        if (f.required !== true) errors.push(`Entity ${ent.name}.version must be required: true`);
        if (f.default !== "1" && f.default !== 1) errors.push(`Entity ${ent.name}.version must default to 1 (got ${JSON.stringify(f.default)})`);
      }
      if (typeof f.fk === "string" && f.fk.includes(".")) {
        const [fkTable, fkCol] = f.fk.split(".");
        const targetEnt = findEntityByTable(entityByName, fkTable);
        if (!targetEnt) {
          errors.push(`Entity ${ent.name}.${f.name} fk '${f.fk}' references unknown table '${fkTable}' — no entity has table=${fkTable}`);
        } else if (!(targetEnt.fields ?? []).some((tf) => tf.name === fkCol)) {
          errors.push(`Entity ${ent.name}.${f.name} fk '${f.fk}' references column '${fkCol}' which does not exist on entity '${targetEnt.name}'`);
        }
      }
    }
    const hasPk = (ent.fields ?? []).some((f) => f.pk);
    if (!hasPk) errors.push(`Entity ${ent.name} has no primary key`);
  }

  for (const r of relationships) {
    const fromEnt = entityByName.get(r.from);
    const toEnt = entityByName.get(r.to);
    if (!fromEnt) errors.push(`Relationship references unknown 'from' entity: ${r.from}`);
    if (!toEnt) errors.push(`Relationship references unknown 'to' entity: ${r.to}`);
    if (!VALID_REL_TYPES.includes(r.type)) {
      errors.push(`Relationship ${r.from} -> ${r.to} has invalid type: ${r.type}`);
    }
    if (!r.evidence?.length) errors.push(`Relationship ${r.from} -> ${r.to} has no evidence`);

    if (r.type === "many-to-many") {
      if (!r.join_table) {
        errors.push(`Many-to-many ${r.from} <-> ${r.to} must declare a join_table`);
      }
    } else if (["one-to-many", "many-to-one"].includes(r.type)) {
      if (!r.fk) {
        errors.push(`Relationship ${r.from} -> ${r.to} (${r.type}) must declare an fk`);
        continue;
      }
      const [srcEntityName, srcCol] = r.fk.split(".");
      if (!srcEntityName || !srcCol) {
        errors.push(`Relationship ${r.from} -> ${r.to}: fk '${r.fk}' must be in 'Entity.column' form`);
        continue;
      }
      const srcEnt = entityByName.get(srcEntityName);
      if (!srcEnt) {
        errors.push(`Relationship ${r.from} -> ${r.to}: fk '${r.fk}' references unknown entity '${srcEntityName}'`);
      } else if (!(srcEnt.fields ?? []).some((f) => f.name === srcCol)) {
        errors.push(`Relationship ${r.from} -> ${r.to}: fk column '${srcCol}' does not exist on entity '${srcEntityName}'`);
      }
      const refEnt = r.type === "many-to-one" ? toEnt : fromEnt;
      if (refEnt && !(refEnt.fields ?? []).some((f) => f.pk)) {
        errors.push(`Relationship ${r.from} -> ${r.to}: target entity '${refEnt.name}' has no PK for fk to reference`);
      }
    }
  }

  const authEntityName = findAuthEntityName(entityByName, authSurface, auth);

  // Auth strategy/store invariants (jwt | session | none). Session strategy must also declare a
  // store so codegen knows whether to add a Session entity (Postgres) or wire Redis.
  if (auth?.strategy && !["jwt", "session", "none"].includes(auth.strategy)) {
    errors.push(`auth.strategy '${auth.strategy}' is invalid (expected 'jwt', 'session', or 'none')`);
  }
  if (auth?.strategy === "session") {
    if (!auth.store) {
      errors.push("auth.strategy is 'session' but auth.store is missing (expected 'postgres' or 'redis')");
    } else if (!["postgres", "redis"].includes(auth.store)) {
      errors.push(`auth.store '${auth.store}' is invalid for strategy 'session' (expected 'postgres' or 'redis')`);
    }
    const hasSession = entityByName.has("Session");
    if (auth.store === "postgres" && entities.length && !hasSession) {
      errors.push("auth.strategy is 'session' with store 'postgres' but no 'Session' entity is declared in entities.json");
    }
    if (auth.store === "redis" && hasSession) {
      errors.push("auth.store is 'redis' but a 'Session' entity is declared — redis-backed sessions don't use a DB table");
    }
  } else if (auth?.store) {
    warnings.push(`auth.store is set ('${auth.store}') but strategy is '${auth.strategy}' — only the 'session' strategy uses a store`);
  }

  // Coherence: strategy "none" should not also signal signup. detect-gaps.mjs treats auth.signup
  // as authoritative for the "missing signup form" blocker; pairing it with strategy:"none" produces
  // a spurious blocker for designs that intentionally ship anonymously.
  if (auth?.strategy === "none" && auth?.signup === true) {
    errors.push("auth.strategy is 'none' but auth.signup is true — pick a real strategy or set signup: false");
  }

  // Signal 7 (judgment:user_owned_mutations) emits a placeholder users entity only. v1 ships
  // anonymously: no /auth/* endpoints, no password storage, no signup flag. Backstop the shape
  // so a partial agent implementation can't drift past the validator.
  if (!isPhase1Only && auth?.inferred_from === "judgment:user_owned_mutations") {
    if (auth.strategy !== "none") {
      errors.push(`auth.inferred_from is 'judgment:user_owned_mutations' but auth.strategy is '${auth.strategy ?? "(missing)"}' — judgment-call signals require strategy: "none"`);
    }
    if (auth.signup === true) {
      errors.push("auth.inferred_from is 'judgment:user_owned_mutations' but auth.signup is true — set signup: false (no signup endpoint is emitted under this signal)");
    }
    for (const ep of endpoints) {
      if (!ep.method || !ep.path) continue;
      const key = `${ep.method.toUpperCase()} ${ep.path}`;
      if (FORBIDDEN_AUTH_ENDPOINT_RE.test(key)) {
        errors.push(`auth.inferred_from is 'judgment:user_owned_mutations' but endpoint '${key}' is present — signal 7 ships anonymously, no auth endpoints should be emitted`);
      }
    }
    if (authEntityName) {
      const authEnt = entityByName.get(authEntityName);
      if (authEnt && (authEnt.fields ?? []).some((f) => f.name === "password_hash")) {
        errors.push(`auth.inferred_from is 'judgment:user_owned_mutations' but entity '${authEntityName}' has a 'password_hash' field — placeholder users should not store credentials`);
      }
    }
  }

  // Entities exempt from "is this displayed on a screen" and "best-practice columns" warnings.
  // Session rows are server-managed: they have no UI surface and aren't user-authored.
  const exemptEntities = new Set([authEntityName, "Session"].filter(Boolean));

  const displayedEntities = new Set(screens.flatMap((s) => s.entities_displayed ?? []));
  for (const ent of entities) {
    if (exemptEntities.has(ent.name)) continue;
    if (!displayedEntities.has(ent.name)) {
      warnings.push(`Entity ${ent.name} is not displayed on any screen — confirm it's needed`);
    }
  }

  for (const ent of entities) {
    if (exemptEntities.has(ent.name)) continue;
    const slug = ent.name.toLowerCase();
    const plural = pluralize(slug);
    const segRegex = new RegExp(`(^|/)(${slug}|${plural})(/|$)`);
    const touched = endpoints.some((ep) => {
      const path = (ep.path ?? "").toLowerCase();
      if (segRegex.test(path)) return true;
      if (ep.response === ent.name) return true;
      if (Array.isArray(ep.response) && ep.response.includes(ent.name)) return true;
      if (typeof ep.response === "string" && ep.response === `${ent.name}[]`) return true;
      return false;
    });
    if (!touched) warnings.push(`Entity ${ent.name} has no endpoint that references it`);
  }

  for (const ep of endpoints) {
    if (ep.is_external) continue;
    if (!ep.filterable_fields?.length && !ep.sortable_fields?.length) continue;
    const responseName = typeof ep.response === "string"
      ? ep.response.replace(/\[\]$/, "")
      : null;
    const targetEntity = responseName ? entityByName.get(responseName) : null;
    if (!targetEntity) {
      warnings.push(`Endpoint ${ep.method} ${ep.path} declares filter/sort fields but response '${ep.response}' doesn't map to a known entity`);
      continue;
    }
    const cols = new Set((targetEntity.fields ?? []).map((f) => f.name));
    for (const f of ep.filterable_fields ?? []) {
      if (!cols.has(f)) errors.push(`Endpoint ${ep.method} ${ep.path}: filterable_fields includes '${f}', not a column on ${targetEntity.name}`);
    }
    for (const s of ep.sortable_fields ?? []) {
      if (!cols.has(s)) errors.push(`Endpoint ${ep.method} ${ep.path}: sortable_fields includes '${s}', not a column on ${targetEntity.name}`);
    }
    if (ep.pagination && ep.pagination.strategy && !["cursor", "offset"].includes(ep.pagination.strategy)) {
      errors.push(`Endpoint ${ep.method} ${ep.path}: pagination.strategy '${ep.pagination.strategy}' must be 'cursor' or 'offset'`);
    }
  }

  const authNeededFromUi = authSurface?.signup?.present || authSurface?.login?.present;
  const authNeededFromInference = !!auth?.inferred_from || auth?.signup === true;
  const authNeeded = authNeededFromUi || authNeededFromInference;
  if (authNeededFromUi && !auth && !isPhase1Only) {
    errors.push("Auth surface present in UI but auth.json is missing");
  }
  if (authNeeded && entities.length && !authEntityName) {
    const why = authNeededFromUi
      ? "Auth surface present"
      : `Auth inferred from '${auth?.inferred_from ?? "auth.signup=true"}'`;
    errors.push(`${why} but no auth entity declared (expected User/Account/Member/Profile)`);
  }

  if (authEntityName && entities.length) {
    for (const ent of entities) {
      if (exemptEntities.has(ent.name)) continue;
      const names = new Set((ent.fields ?? []).map((f) => f.name));
      const missing = [];
      if (!names.has("deleted_at")) missing.push("deleted_at");
      if (!names.has("version")) missing.push("version");
      if (!names.has("created_by")) missing.push("created_by");
      if (!names.has("updated_by")) missing.push("updated_by");
      if (missing.length) {
        warnings.push(`Entity ${ent.name} is missing best-practice column(s): ${missing.join(", ")} — codegen handlers assume these exist`);
      }
    }
  }

  if (auth && !isPhase1Only) {
    const requiredAuthEndpoints = [];
    if (auth.password_reset) {
      requiredAuthEndpoints.push("POST /auth/password-reset/request");
      requiredAuthEndpoints.push("POST /auth/password-reset/confirm");
    }
    if (auth.email_verification) {
      requiredAuthEndpoints.push("POST /auth/verify-email");
    }
    for (const provider of auth.oauth_providers ?? []) {
      requiredAuthEndpoints.push(`GET /auth/oauth/${provider}/start`);
      requiredAuthEndpoints.push(`GET /auth/oauth/${provider}/callback`);
    }
    for (const required of requiredAuthEndpoints) {
      if (!endpointKeys.has(required)) {
        errors.push(`auth.json flag implies '${required}' but it is missing from endpoints.json`);
      }
    }
  }

  for (const f of forms) {
    if (!f.inputs?.length) warnings.push(`Form ${f.id ?? f.file} has no inputs`);
    if (!f.evidence?.length) errors.push(`Form ${f.id ?? f.file} has no evidence`);
  }

  const openQuestions = Array.isArray(state.open_questions) ? state.open_questions : null;
  if (openQuestions) {
    const validCategories = new Set(["product", "skeptic", undefined, null]);
    const validAxes = new Set(["security", "scalability", "multi_tenancy", "operability", undefined, null]);
    for (const q of openQuestions) {
      // Structural fields are required; missing them breaks the renderer.
      if (!q.question) errors.push(`Open question ${q.id ?? q.title ?? "?"} missing 'question' field`);
      // Recommendation is content quality — surface as a warning so a single missing rec doesn't
      // block Phase 3. The synthesis brief still asks for one on every entry.
      if (!q.recommendation) warnings.push(`Open question ${q.id ?? q.title ?? "?"} missing 'recommendation' field — the design doc renders one alongside each question so the user has a default to accept`);
      if (q.category !== undefined && !validCategories.has(q.category)) {
        errors.push(`Open question ${q.id ?? q.title ?? "?"} has invalid category '${q.category}' (expected 'product' or 'skeptic')`);
      }
      if (q.category === "skeptic" && q.axis !== undefined && !validAxes.has(q.axis)) {
        errors.push(`Open question ${q.id ?? q.title ?? "?"} has invalid axis '${q.axis}' (expected 'security', 'scalability', 'multi_tenancy', or 'operability')`);
      }
    }
  }

  // Note: unwired-button detection (api_call button with no matching endpoint) lives in
  // scripts/detect-gaps.mjs, not here. The validator checks state consistency; gap detection
  // surfaces user-facing wire-up work.

  return { errors, warnings, state };
}

function findAuthEntityName(entityByName, authSurface, auth) {
  const authNeeded =
    authSurface?.signup?.present ||
    authSurface?.login?.present ||
    !!auth?.inferred_from;
  if (!authNeeded) return null;
  const candidates = ["User", "Account", "Member", "Profile"];
  for (const c of candidates) {
    if (entityByName.has(c)) return c;
  }
  return null;
}

function findEntityByTable(entityByName, table) {
  for (const ent of entityByName.values()) {
    if (ent.table === table) return ent;
  }
  return null;
}

const IRREGULAR_PLURALS = {
  person: "people",
  child: "children",
  datum: "data",
  goose: "geese",
  man: "men",
  woman: "women",
  mouse: "mice",
  foot: "feet",
  tooth: "teeth",
  ox: "oxen",
};

function pluralize(slug) {
  if (IRREGULAR_PLURALS[slug]) return IRREGULAR_PLURALS[slug];
  if (slug.endsWith("y") && !/[aeiou]y$/.test(slug)) return slug.slice(0, -1) + "ies";
  if (/(s|x|z|ch|sh)$/.test(slug)) return slug + "es";
  return slug + "s";
}

export function printResults({ errors, warnings, state }) {
  if (warnings.length) {
    console.error("Warnings:");
    for (const w of warnings) console.error("  ! " + w);
  }
  if (errors.length) {
    if (warnings.length) console.error("");
    console.error("Errors:");
    for (const e of errors) console.error("  x " + e);
    console.error(`\nFAIL: ${errors.length} error(s), ${warnings.length} warning(s)`);
    return 1;
  }
  const components = state.components?.components ?? [];
  const forms = state.forms?.forms ?? [];
  console.log("OK");
  console.log(`  ${state.entities?.length ?? 0} entities`);
  console.log(`  ${state.relationships?.length ?? 0} relationships`);
  console.log(`  ${state.endpoints?.length ?? 0} endpoints`);
  console.log(`  ${state.screens?.length ?? 0} screens`);
  console.log(`  ${components.length} components`);
  console.log(`  ${forms.length} forms`);
  if (warnings.length) console.log(`  ${warnings.length} warning(s) — review above`);
  return 0;
}

if (isMainModule(import.meta.url)) {
  process.exit(printResults(validate()));
}
