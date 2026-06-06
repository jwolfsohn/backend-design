import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderOpenApi } from "../scripts/render-openapi.mjs";

function makeFixture(stateFiles, config) {
  const root = mkdtempSync(join(tmpdir(), "bd-openapi-"));
  const stateDir = join(root, ".backend-design", "state");
  mkdirSync(stateDir, { recursive: true });
  for (const [name, contents] of Object.entries(stateFiles)) {
    writeFileSync(join(stateDir, name), JSON.stringify(contents));
  }
  if (config) {
    writeFileSync(join(root, ".backend-design", "config.json"), JSON.stringify(config));
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("render-openapi: session-strategy auth-required endpoint gets security: cookieAuth", () => {
  const { root, cleanup } = makeFixture({
    "endpoints.json": [
      { method: "GET", path: "/api/me", auth: "required", triggered_by: ["src/Me.tsx:1"] },
    ],
    "auth.json": { strategy: "session", cookie: { name: "sid" } },
  });
  try {
    const spec = renderOpenApi(root);
    assert.deepEqual(
      spec.paths["/api/me"].get.security,
      [{ cookieAuth: [] }],
      "session-strategy operation must declare cookieAuth"
    );
    assert.ok(
      spec.components?.securitySchemes?.cookieAuth,
      "cookieAuth scheme must be registered in components"
    );
  } finally {
    cleanup();
  }
});

test("render-openapi: jwt-strategy auth-required endpoint still gets security: bearerAuth (back-compat)", () => {
  const { root, cleanup } = makeFixture({
    "endpoints.json": [
      { method: "GET", path: "/api/me", auth: "required", triggered_by: ["src/Me.tsx:1"] },
    ],
    "auth.json": { strategy: "jwt", algorithm: "HS256" },
  });
  try {
    const spec = renderOpenApi(root);
    assert.deepEqual(spec.paths["/api/me"].get.security, [{ bearerAuth: [] }]);
  } finally {
    cleanup();
  }
});

test("render-openapi: mixed required/optional body fields yields a required array with only the required ones", () => {
  const { root, cleanup } = makeFixture({
    "endpoints.json": [
      {
        method: "POST",
        path: "/api/posts",
        auth: "none",
        triggered_by: ["src/NewPost.tsx:1"],
        request_body: {
          title: "string",
          cover_image: { type: "string", required: false },
        },
      },
    ],
  });
  try {
    const spec = renderOpenApi(root);
    const schema = spec.paths["/api/posts"].post.requestBody.content["application/json"].schema;
    assert.deepEqual(schema.required, ["title"], "only required: true (or absent) fields land in required");
    assert.ok(schema.properties.cover_image, "optional field still appears in properties");
  } finally {
    cleanup();
  }
});

test("render-openapi: string-shorthand body fields stay required-by-default", () => {
  const { root, cleanup } = makeFixture({
    "endpoints.json": [
      {
        method: "POST",
        path: "/api/posts",
        auth: "none",
        triggered_by: ["src/NewPost.tsx:1"],
        request_body: { title: "string", body: "string" },
      },
    ],
  });
  try {
    const spec = renderOpenApi(root);
    const schema = spec.paths["/api/posts"].post.requestBody.content["application/json"].schema;
    assert.deepEqual(schema.required.sort(), ["body", "title"]);
  } finally {
    cleanup();
  }
});

test("render-openapi: required: true on an object field also marks it required", () => {
  const { root, cleanup } = makeFixture({
    "endpoints.json": [
      {
        method: "POST",
        path: "/api/posts",
        auth: "none",
        triggered_by: ["src/NewPost.tsx:1"],
        request_body: {
          title: { type: "string", required: true },
        },
      },
    ],
  });
  try {
    const spec = renderOpenApi(root);
    const schema = spec.paths["/api/posts"].post.requestBody.content["application/json"].schema;
    assert.deepEqual(schema.required, ["title"]);
  } finally {
    cleanup();
  }
});

test("render-openapi: multipart body honors required: false on non-file fields", () => {
  const { root, cleanup } = makeFixture({
    "endpoints.json": [
      {
        method: "POST",
        path: "/api/upload",
        auth: "none",
        triggered_by: ["src/Upload.tsx:1"],
        content_type: "multipart/form-data",
        request_body: {
          file: { accept: "image/*" },
          caption: { type: "string", required: false },
        },
      },
    ],
  });
  try {
    const spec = renderOpenApi(root);
    const schema = spec.paths["/api/upload"].post.requestBody.content["multipart/form-data"].schema;
    assert.deepEqual(schema.required, ["file"], "caption is optional; only file stays required");
    assert.equal(schema.properties.file.format, "binary");
  } finally {
    cleanup();
  }
});
