#!/usr/bin/env node
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const FILES = [
  "screens.json",
  "components.json",
  "endpoints.json",
  "forms.json",
  "entities.json",
  "relationships.json",
  "auth.json",
];

const VALID_REL_TYPES = ["one-to-one", "one-to-many", "many-to-one", "many-to-many"];

export function validate(cwd = process.cwd()) {
  const stateDir = join(cwd, ".backend-design", "state");
  const errors = [];
  const warnings = [];
  const state = {};

  if (!existsSync(stateDir)) {
    errors.push(`${stateDir} not found. Run Phase 1 first.`);
    return { errors, warnings, state };
  }

  for (const f of FILES) {
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

    if (!ep.triggered_by?.length && !ep.is_webhook) {
      errors.push(`Endpoint ${key} has no UI trigger — frontend is the source of truth (set is_webhook:true if this is an incoming webhook)`);
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

  const authEntityName = findAuthEntityName(entityByName, authSurface);
  const displayedEntities = new Set(screens.flatMap((s) => s.entities_displayed ?? []));
  for (const ent of entities) {
    if (ent.name === authEntityName) continue;
    if (!displayedEntities.has(ent.name)) {
      warnings.push(`Entity ${ent.name} is not displayed on any screen — confirm it's needed`);
    }
  }

  for (const ent of entities) {
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

  const authNeeded = authSurface?.signup?.present || authSurface?.login?.present;
  if (authNeeded && !auth && !isPhase1Only) {
    errors.push("Auth surface present in UI but auth.json is missing");
  }
  if (authNeeded && entities.length && !authEntityName) {
    errors.push("Auth surface present but no auth entity declared (expected User/Account/Member/Profile)");
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

  for (const btn of standaloneButtons) {
    if (btn.action === "api_call" && btn.target) {
      const [method, ...rest] = btn.target.split(" ");
      const path = rest.join(" ");
      if (method && path) {
        const key = `${method.toUpperCase()} ${path}`;
        if (!endpointKeys.has(key)) {
          warnings.push(`Button at ${btn.file} targets '${btn.target}' but no matching endpoint is defined`);
        }
      }
    }
  }

  return { errors, warnings, state };
}

function findAuthEntityName(entityByName, authSurface) {
  const authNeeded = authSurface?.signup?.present || authSurface?.login?.present;
  if (!authNeeded) return null;
  const candidates = ["User", "Account", "Member", "Profile"];
  for (const c of candidates) {
    if (entityByName.has(c)) return c;
  }
  return null;
}

function pluralize(slug) {
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

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(printResults(validate()));
}
