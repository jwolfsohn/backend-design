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
  const entityNames = new Set(entities.map((e) => e.name));

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
  }

  for (const ep of endpoints) {
    if (!ep.method || !ep.path) errors.push(`Endpoint missing method or path: ${JSON.stringify(ep)}`);
    if (!ep.triggered_by?.length && !ep.evidence?.length) {
      errors.push(`Endpoint ${ep.method ?? "?"} ${ep.path ?? "?"} has no UI trigger or evidence`);
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
    if (!entityNames.has(r.from)) errors.push(`Relationship references unknown 'from' entity: ${r.from}`);
    if (!entityNames.has(r.to)) errors.push(`Relationship references unknown 'to' entity: ${r.to}`);
    if (!["one-to-one", "one-to-many", "many-to-one", "many-to-many"].includes(r.type)) {
      errors.push(`Relationship ${r.from} -> ${r.to} has invalid type: ${r.type}`);
    }
    if (!r.evidence?.length) errors.push(`Relationship ${r.from} -> ${r.to} has no evidence`);
    if (r.type === "many-to-many" && !r.join_table) {
      warnings.push(`Many-to-many ${r.from} <-> ${r.to} should declare a join_table`);
    }
    if (["one-to-many", "many-to-one"].includes(r.type) && !r.fk) {
      errors.push(`Relationship ${r.from} -> ${r.to} (${r.type}) must declare an fk`);
    }
  }

  const displayedEntities = new Set(screens.flatMap((s) => s.entities_displayed ?? []));
  for (const ent of entities) {
    if (!displayedEntities.has(ent.name) && ent.name !== "User") {
      warnings.push(`Entity ${ent.name} is not displayed on any screen — confirm it's needed`);
    }
  }

  for (const ent of entities) {
    const slug = ent.name.toLowerCase();
    const touched = endpoints.some(
      (ep) =>
        ep.path?.toLowerCase().includes(slug) ||
        ep.response === ent.name ||
        (Array.isArray(ep.response) && ep.response.includes(ent.name))
    );
    if (!touched) warnings.push(`Entity ${ent.name} has no endpoint that references it`);
  }

  const authNeeded =
    authSurface?.signup?.present || authSurface?.login?.present;
  if (authNeeded && !auth) {
    errors.push("Auth surface present in UI but auth.json is missing");
  }
  if (authNeeded && !entityNames.has("User")) {
    errors.push("Auth surface present but no User entity declared");
  }

  for (const f of forms) {
    if (!f.inputs?.length) warnings.push(`Form ${f.id ?? f.file} has no inputs`);
    if (!f.evidence?.length) errors.push(`Form ${f.id ?? f.file} has no evidence`);
  }

  return { errors, warnings, state };
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
