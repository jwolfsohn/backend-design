#!/usr/bin/env node
// render-s2ai-schema.mjs — deterministically render ./schema.mmd from .backend-design/state/*.json.
// Targets the s2ai Mermaid-based schema format. @dictionary blocks, @service auth, and regex
// patterns are intentionally left as TODO comments for the user to fill in by hand.

import { readFileSync } from "fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { isMainModule } from "./is-main.mjs";
import { loadState, atomicWriteFileSync } from "./state.mjs";

// Subset the s2ai renderer actually inspects; loadState skips the rest.
const S2AI_STATE_FILES = ["entities.json", "relationships.json", "endpoints.json", "auth.json"];

const TYPE_MAP = {
  uuid: "String",
  text: "String",
  varchar: "String",
  string: "String",
  char: "String",
  integer: "Integer",
  int: "Integer",
  bigint: "Integer",
  smallint: "Integer",
  numeric: "Float",
  decimal: "Float",
  float: "Float",
  real: "Float",
  double: "Float",
  boolean: "Boolean",
  bool: "Boolean",
  timestamptz: "Datetime",
  timestamp: "Datetime",
  datetime: "Datetime",
  date: "Date",
  json: "Json",
  jsonb: "Json",
  money: "Currency",
  currency: "Currency",
};

function loadVersion() {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(resolve(here, "..", "package.json"), "utf8"));
    return pkg.version ?? "?";
  } catch {
    return "?";
  }
}

function camelize(name) {
  if (!name) return name;
  return name.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
}

function snake(name) {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

function fieldType(field) {
  if (field.pk) return "PKey";
  if (field.fk) return "FKey";
  const t = (field.type ?? "").toLowerCase();
  return TYPE_MAP[t] ?? "String";
}

function isSecret(field) {
  const n = (field.name ?? "").toLowerCase();
  return n === "password" || n === "password_hash" || n === "passwordhash";
}

function buildFieldLine(field) {
  const type = fieldType(field);
  const name = camelize(field.name);
  const lowerName = (field.name ?? "").toLowerCase();
  const isCreatedAt = lowerName === "created_at" || lowerName === "createdat";
  const isUpdatedAt = lowerName === "updated_at" || lowerName === "updatedat";
  const isDeletedAt = lowerName === "deleted_at" || lowerName === "deletedat";
  const isVersion = lowerName === "version";

  const validate = {};
  if (field.required && !field.pk && !isCreatedAt && !isUpdatedAt) {
    validate.required = true;
  }

  const standaloneDecorators = [];
  if (isCreatedAt) standaloneDecorators.push("@autoGenerate", "@readOnly");
  if (isUpdatedAt) standaloneDecorators.push("@autoUpdate", "@readOnly");
  if (isDeletedAt) standaloneDecorators.push("@nullable", "@indexed");
  if (isVersion) standaloneDecorators.push("@autoGenerate");
  if (isSecret(field)) standaloneDecorators.push("@encrypt");

  const decorators = [];
  if (Object.keys(validate).length) {
    const kv = Object.entries(validate)
      .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
      .join(", ");
    decorators.push(`@validate { ${kv} }`);
  }
  decorators.push(...standaloneDecorators);
  if (field.unique && !field.pk) decorators.push("@unique");
  if (isSecret(field)) decorators.push(`@ui { display: "secret" }`);

  let line = `        ${type} ${name}`;
  if (decorators.length) line += `  %% ${decorators.join(", ")}`;
  return line;
}

function cardinalityToken(type) {
  switch (type) {
    case "one-to-one":
      return "||--||";
    case "one-to-many":
      return "||--o{";
    case "many-to-one":
      return "}o--||";
    case "many-to-many":
      return "}o--o{";
    default:
      return "||--o{";
  }
}

function isStandardCrud(ep, entityTables) {
  if (ep.is_external || ep.is_webhook || ep.temporary) return false;
  const path = ep.path ?? "";
  if (!path.startsWith("/api/")) return false;
  const segments = path.slice(5).split("/").filter(Boolean);
  if (segments.length === 0) return false;
  if (!entityTables.has(segments[0])) return false;
  if (segments.length === 1) return true;
  if (segments.length === 2 && segments[1].startsWith(":")) return true;
  if (segments.length === 3 && segments[1].startsWith(":") && entityTables.has(segments[2])) return true;
  if (
    segments.length === 4 &&
    segments[1].startsWith(":") &&
    entityTables.has(segments[2]) &&
    segments[3].startsWith(":")
  ) {
    return true;
  }
  return false;
}

function categorize(ep) {
  if (ep.is_webhook) return 0;
  if (ep.is_external) return 1;
  if ((ep.path ?? "").startsWith("/api/auth/")) return 2;
  if (ep.temporary) return 4;
  return 3;
}

function formatEndpointComment(ep) {
  const method = (ep.method ?? "?").toUpperCase();
  const path = ep.path ?? "?";
  const tags = [];
  if (ep.is_webhook) {
    tags.push(`webhook from ${ep.webhook_source ?? "?"}, signature: ${ep.signature_header ?? "?"}`);
  } else if (ep.is_external) {
    tags.push(`external call to ${ep.external_origin ?? "?"}`);
  } else if (ep.temporary) {
    tags.push(`placeholder${ep.placeholder_reason ? `: ${ep.placeholder_reason}` : ""}`);
  } else if (path.startsWith("/api/auth/")) {
    tags.push("auth flow");
  } else {
    tags.push("custom RPC");
  }
  if ((ep.triggered_by ?? []).length) tags.push(`triggered at ${ep.triggered_by[0]}`);
  return `%%   ${method} ${path}  (${tags.join("; ")})`;
}

function byName(a, b) {
  return (a.name ?? "").localeCompare(b.name ?? "");
}

export function renderSchema(cwd = process.cwd()) {
  const state = loadState(cwd, S2AI_STATE_FILES);
  const version = loadVersion();
  const entities = state.entities ?? [];
  const relationships = state.relationships ?? [];
  const endpoints = state.endpoints ?? [];
  const auth = state.auth ?? null;

  const lines = [];

  lines.push(
    `%% Generated by backend-design v${version}. Add @dictionary blocks, @service auth, and regex by hand.`
  );
  lines.push(
    `%% Source: .backend-design/state/*.json (entities.json, relationships.json, endpoints.json, auth.json)`
  );
  lines.push("");

  if (auth && auth.strategy && auth.strategy !== "none") {
    const detail = [];
    if (auth.algorithm) detail.push(auth.algorithm);
    if (auth.expiry) detail.push(`expiry ${auth.expiry}`);
    const detailStr = detail.length ? ` (${detail.join(", ")})` : "";
    lines.push(`%% TODO: add @service block for auth. Detected strategy: ${auth.strategy}${detailStr}.`);
    lines.push(`%% See s2ai docs/s2ai.md §@service for syntax.`);
    lines.push("");
  }

  if (entities.length === 0) {
    lines.push(`%% No entities inferred from the frontend — nothing to emit.`);
    return lines.join("\n");
  }

  lines.push("erDiagram");

  for (const r of relationships) {
    const token = cardinalityToken(r.type);
    lines.push(`    ${r.from} ${token} ${r.to}: ""`);
    if (r.type === "many-to-many" && !r.join_table) {
      lines.push(`    %% TODO: declare join entity for ${r.from} <-> ${r.to}`);
    }
  }
  if (relationships.length) lines.push("");

  for (const ent of [...entities].sort(byName)) {
    lines.push(`    ${ent.name} {`);
    for (const f of ent.fields ?? []) {
      lines.push(buildFieldLine(f));
    }
    lines.push(`    }`);
    lines.push("");
  }

  const entityTables = new Set(entities.map((e) => e.table ?? snake(e.name)));
  const nonCrud = endpoints.filter((ep) => !isStandardCrud(ep, entityTables));
  if (nonCrud.length) {
    lines.push("%% Non-CRUD endpoints (not expressible in .mmd — implement separately):");
    const sorted = [...nonCrud].sort((a, b) => {
      const c = categorize(a) - categorize(b);
      if (c !== 0) return c;
      return ((a.path ?? "") + (a.method ?? "")).localeCompare((b.path ?? "") + (b.method ?? ""));
    });
    for (const ep of sorted) {
      lines.push(formatEndpointComment(ep));
    }
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n");
}

export function runRender(cwd = process.cwd()) {
  const out = renderSchema(cwd);
  atomicWriteFileSync(join(cwd, "schema.mmd"), out.endsWith("\n") ? out : out + "\n");
  return out;
}

if (isMainModule(import.meta.url)) {
  runRender();
  console.log("Wrote ./schema.mmd");
}
