# Codegen — Node.js + Fastify + Prisma + Postgres

**Write every file under `config.output_dir`** from `.backend-design/config.json` (default `./backend`). The layout below uses `backend/` as the placeholder — substitute the real value.

**If `auth.json.strategy === "none"`:** skip everything auth-related — do not create `plugins/auth.ts`, `lib/password.ts`, the `/auth/*` routes, or the `User` entity unless it appears in `entities.json` (in particular: when `auth.inferred_from === "judgment:user_owned_mutations"` the `User` entity **must** be scaffolded as a placeholder table — it exists so nullable `user_id` FKs on other entities resolve; do not add `password_hash` or wire any auth preHandler to it). Do not register `@fastify/jwt`. Do not add `JWT_SECRET` to `.env.example`. No endpoint may use `preHandler: [fastify.authenticate]`.

**If `auth.json.strategy === "session"`:** follow the "Cookie sessions + CSRF" section below instead of the JWT instructions. The two strategies are mutually exclusive.

Scaffold a TypeScript backend. Authoritative spec is in `.backend-design/state/`:

- `entities.json` → `prisma/schema.prisma` models
- `relationships.json` → Prisma `@relation` directives, on-delete behavior
- `endpoints.json` → one route handler per entry
- `auth.json` → auth hook and `/auth/*` routes
- `config.json` → output directory

## Layout

```
backend/
  package.json
  tsconfig.json
  prisma/schema.prisma
  src/
    index.ts            # Fastify bootstrap, registers plugins + routes
    db.ts               # Prisma client singleton
    plugins/
      auth.ts           # @fastify/jwt config, decorator for req.user
      cors.ts           # @fastify/cors
    routes/
      <resource>.ts     # one file per resource, exports Fastify plugin
    schemas/
      <resource>.ts     # zod schemas + JSON schemas via zod-to-json-schema
    lib/
      password.ts       # bcrypt hash/compare
  .env.example
  README.md
```

## Constraints

- TypeScript `"strict": true`
- Fastify 4 with `@fastify/jwt`, `@fastify/cors`
- Each route file exports a Fastify plugin (`async function (fastify, opts) {}`) and is registered in `src/index.ts`
- Use Fastify's `schema` option on each route with JSON Schemas derived from zod schemas (via `zod-to-json-schema`). This gives you free validation AND OpenAPI compatibility.
- On validation failure Fastify auto-returns 400 with the error payload
- **Multipart endpoints**: register `@fastify/multipart`. Use `request.file()` or `request.files()` per the route's spec. Enforce `accept` (MIME) and `max_size_mb` (`limits.fileSize`). Same `lib/storage.ts` stub as the Express stack.
- **Placeholder endpoints** (any endpoint where `temporary: true`): scaffold per the rules in the "Placeholder endpoint scaffolding" section prepended above. Do NOT add Fastify schema validation, auth preHandlers, or Prisma calls on placeholder routes.
- **Inferred endpoints** (`inferred_from_signal: "<signal>"`): scaffold the route the same way as a normal endpoint, but add a TODO at the top of the handler: `// TODO: no UI wires up to this endpoint; inferred from <signal>. Add the form or remove the endpoint.` Common for auth endpoints when `auth.json.inferred_from` is `auth_required_screen`, `token_storage_key`, `auth_header`, or `auth_path`.
- **Webhook endpoints** (`is_webhook: true`): register `fastify.addContentTypeParser('application/json', { parseAs: 'buffer' }, ...)` for these routes so the raw body is preserved. Read `signature_header`, verify against `process.env.<WEBHOOK_SOURCE>_WEBHOOK_SECRET`, return 401 on invalid / 200 on valid. Add the env var to `.env.example`.
- `preHandler: [fastify.authenticate]` on routes where `endpoints[].auth === "required"`. The `authenticate` decorator wraps `request.jwtVerify()` and attaches `request.user`.
- **RBAC**: for routes with `required_role`, add a second preHandler `requireRole(role)` factory in `plugins/auth.ts` that runs after `authenticate` and returns 403 if `request.user.role` doesn't match. User entity must include `role: text`.
- **List endpoints**: same pagination/filter/sort semantics as the Express stack (cursor → `{data, next_cursor}`; offset → `{data, total}`; whitelist filters + sort). Express the query string via Fastify's `schema.querystring` (JSON Schema from zod-to-json-schema). Reject unknown params with 400.
- **Nested-resource scoping**: same as Express — filter the query by `<parent_table>_id` from the path param AND verify access to the parent record first; 404 on no access.
- bcrypt password hashing (cost from `auth.json -> bcrypt_cost`)
- **Extended auth flows** (per `auth.json` flags): same recipes as the Express stack — `password_reset` table + `/auth/password-reset/{request,confirm}`; `email_verified_at` on User + `/auth/verify-email`; OAuth `start`/`callback` per provider. Use a `lib/email.ts` stub that logs to stdout. Add per-provider `<PROVIDER>_CLIENT_ID` / `_SECRET` to `.env.example`.
- Dev script: `tsx watch src/index.ts`
- Use `config.pkg_manager` from `.backend-design/config.json` (default `pnpm`) for every README command and any `package.json` scripts you generate. Refer to it as `<PM>` below.
- Do not implement endpoints not in `endpoints.json`. Do not invent fields.

## Best-practice column semantics

Every entity in `entities.json` carries `deleted_at`, `version`, and (when a `users` entity exists) `created_by`, `updated_by`. Handlers must respect them:

- **Soft delete (`deleted_at`)**: every list and detail Prisma query adds `where: { deleted_at: null, ... }`. `DELETE /<resource>/:id` does `prisma.<model>.update({ where: { id }, data: { deleted_at: new Date() } })` instead of `delete()`. No restore endpoint.
- **Optimistic locking (`version`)**: PATCH handlers increment `version` by 1. If the request has an `If-Match` header, parse it as an integer and add `version: <parsedInt>` to the Prisma `where` clause; if the update affects zero rows (Prisma throws `P2025`), respond 409 with `{ error: "version_conflict", current_version: <current> }` after re-fetching the current value. Absent `If-Match` → `data: { ..., version: { increment: 1 } }`. Every response body for a single record includes `version`.
- **Audit columns (`created_by`, `updated_by`)**: in POST handlers, set both to `request.user.id`. In PATCH handlers, set `updated_by` only. Endpoints with `auth: "none"` omit both (NULL is allowed).
- **Partial unique indexes for soft-deletable entities**: same approach as the Express stack — prefer `@@index([col], where: { deleted_at: null })` or a raw partial-unique SQL migration if Prisma can't express it directly. Document the migration in `README.md`.
- **Placeholder routes (`temporary: true`)** never touch the DB.
- **Webhook routes** typically have no `request.user`; if their write targets entities with audit columns, leave `created_by`/`updated_by` as NULL.

## Cookie sessions + CSRF (when `auth.strategy === "session"`)

Replaces the JWT instructions above. Mutually exclusive with `jwt`.

- **Skip** `@fastify/jwt`. Register `@fastify/cookie` + `@fastify/session` + `@fastify/csrf-protection` instead.
- **Deps:** `@fastify/cookie`, `@fastify/session`, `@fastify/csrf-protection`. Postgres store (default): `connect-pg-simple` adapted to `@fastify/session`'s store interface (it accepts any `express-session`-compatible store, so the same adapter works). Redis store: `connect-redis` + `redis`.
- **`Session` Prisma model** when `auth.store === "postgres"` (from `entities.json`).
- **Registration order** in `src/index.ts`: security plugins → `@fastify/cookie` → `@fastify/session` (with the store) → `@fastify/csrf-protection` → routes.
- **Session config:**
  ```ts
  await fastify.register(fastifySession, {
    cookieName: "sid",
    secret: process.env.SESSION_SECRET!,
    rolling: true,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: Number(process.env.SESSION_MAX_AGE_DAYS ?? 7) * 24 * 60 * 60 * 1000,
    },
    store: /* connect-pg-simple OR connect-redis */,
    saveUninitialized: false,
  });
  ```
- **CSRF:** `@fastify/csrf-protection` adds `fastify.csrfProtection` (`preHandler` factory) and `request.generateCsrf()`. Apply `preHandler: [fastify.csrfProtection]` on every mutating route (POST/PATCH/PUT/DELETE) **except** webhooks (`is_webhook: true`).
- **Endpoints to generate:**
  - `POST /auth/signup` — hash password, insert user, `request.session.regenerate()`, set `request.session.userId = user.id`, return `{ user }`.
  - `POST /auth/login` — verify password, `request.session.regenerate()`, set `userId`, return `{ user }`.
  - `POST /auth/logout` — `await request.session.destroy()` → 204.
  - `GET /auth/csrf-token` — `return { csrfToken: await reply.generateCsrf() }`.
- **`requireSession` preHandler** (replaces `fastify.authenticate`): if `!request.session.userId` → 401. Otherwise fetch user once and decorate `request.user`.
- **Startup guard:** error and exit on missing `SESSION_SECRET` in production.
- **`.env.example`:** add `SESSION_SECRET`, `REDIS_URL` (only when `store === "redis"`), `SESSION_MAX_AGE_DAYS` (optional, commented).

## Security baseline (required)

Register these plugins from `src/index.ts` (after `@fastify/cors`, before route mounts):

- `@fastify/helmet` with default config.
- `@fastify/rate-limit` with `max: Number(process.env.RATE_LIMIT_MAX ?? 1000)`, `timeWindow: "15 minutes"`. Apply a per-route override on POST/PATCH/PUT/DELETE handlers via `config.rateLimit = { max: Number(process.env.RATE_LIMIT_WRITE_MAX ?? 100) }`.
- `@fastify/cors` configured with `origin` derived from `process.env.ALLOWED_ORIGINS` (comma-separated allowlist). Default to `["http://localhost:3000"]` when unset.
- Fastify's built-in pino logger: set `logger: { level: process.env.LOG_LEVEL ?? "info", redact: ["req.headers.authorization", "req.headers.cookie", "res.headers['set-cookie']"] }` in the Fastify constructor. In dev (`NODE_ENV !== "production"`), use `transport: { target: "pino-pretty" }`.

Startup guard in `src/index.ts`: if `process.env.NODE_ENV === "production"` and `ALLOWED_ORIGINS` is missing or contains `*`, `console.error` and `process.exit(1)`. Same for missing `JWT_SECRET` under JWT auth.

Dev deps: `@fastify/helmet`, `@fastify/rate-limit`, `@fastify/cors`, `pino-pretty`.

Document new env vars (`ALLOWED_ORIGINS`, `LOG_LEVEL`, `RATE_LIMIT_MAX`, `RATE_LIMIT_WRITE_MAX`) in `.env.example`.

## OpenAPI / Swagger UI (required)

The orchestrator emits `./openapi.json` at the repo root from `.backend-design/state/`. Serve it via `@fastify/swagger` in **static mode** so the UI matches the design-time contract exactly (Fastify can also derive from per-route JSON schemas, but that live spec drifts whenever a developer tweaks a handler — keep `static` for parity).

1. Copy `<repo-root>/openapi.json` → `backend/src/openapi.json` at codegen time.
2. Add deps: `@fastify/swagger`, `@fastify/swagger-ui`.
3. In `src/index.ts`, after `@fastify/cors` and the security plugins, before routes:
   ```ts
   import fastifySwagger from "@fastify/swagger";
   import fastifySwaggerUi from "@fastify/swagger-ui";
   import openapiDoc from "./openapi.json" with { type: "json" };

   await fastify.register(fastifySwagger, { mode: "static", specification: { document: openapiDoc } });
   await fastify.register(fastifySwaggerUi, {
     routePrefix: "/docs",
     uiHooks: process.env.NODE_ENV === "production" && !process.env.OPENAPI_PUBLIC
       ? { onRequest: [fastify.authenticate] }
       : undefined,
   });
   ```
4. Document `OPENAPI_PUBLIC` in `.env.example` (commented out; default behavior gates `/docs` behind auth in production).

Skip when `auth.strategy === "none"` and there are zero endpoints.

## Tests (required)

Generate a `tests/` directory with vitest + `@testcontainers/postgresql`. Use Fastify's `app.inject({ method, url, headers, payload })` instead of supertest — it's faster and avoids opening sockets.

Add to dev deps: `vitest`, `@testcontainers/postgresql`.

Add to `package.json` scripts:

```json
"test": "vitest run",
"test:watch": "vitest"
```

Files:

- **`vitest.config.ts`** — `globals: true`, `testTimeout: 30000`, `globalSetup: ["./tests/setup.ts"]`, `pool: "forks"`, `poolOptions: { forks: { singleFork: true } }`.
- **`tests/setup.ts`** — starts `PostgreSqlContainer`, sets `process.env.DATABASE_URL`, runs `npx prisma migrate deploy`, returns teardown.
- **`tests/helpers.ts`** — exports `buildApp()` (factory returning a fresh Fastify instance built the same way as `src/index.ts`), `prisma`, `truncateAll()`, and `createUserAndLogin(app)` that calls `app.inject({ method: "POST", url: "/auth/signup", ... })` and returns `{ user, token, headers }`.
- **`tests/auth.test.ts`** — under `auth.json.strategy === "jwt"`, same shape as the Express stack. Under `strategy === "session"`, use Fastify's `app.inject` and pass `headers.cookie` from the prior response's `set-cookie`: signup sets `sid=...`; reusing the cookie authenticates; `POST /auth/logout` clears it (next request → 401); mutating route without `X-CSRF-Token` → 403; with the right token → 200/201.
- **`tests/<resource>.test.ts`** — one per non-auth scaffolded resource. Use `app.inject` for every request. Cover: list-empty, create with `version: 1`, PATCH with `If-Match: 1` → 2, stale `If-Match` → 409, DELETE → 204, soft-delete excluded from subsequent list.
- `beforeEach(truncateAll)` for isolation.

Skip tests for placeholder routes and webhook routes.

## README run commands

```
<PM> install
cp .env.example .env   # fill in DATABASE_URL and JWT_SECRET
<PM> prisma migrate dev --name init
<PM> dev
<PM> test              # runs the suite against a testcontainer Postgres (needs Docker)
```

## Verification

1. `<PM> install` succeeds
2. `<PM> prisma generate` succeeds
3. `<PM> tsc --noEmit` passes
4. `<PM> test` passes (skip with "Docker not running" note if `docker info` fails)
