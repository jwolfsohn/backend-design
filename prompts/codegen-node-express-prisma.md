# Codegen — Node.js + Express + Prisma + Postgres

**Write every file under `config.output_dir`** from `.backend-design/config.json` (default `./backend`). The layout below uses `backend/` as the placeholder — substitute the real value.

**If `auth.json.strategy === "none"`:** skip everything auth-related — do not create `middleware/auth.ts`, `lib/jwt.ts`, `lib/password.ts`, the `/auth/*` routes, or the `User` entity unless it appears in `entities.json` for a non-auth reason. Do not add `JWT_SECRET` to `.env.example`. No endpoint may use the auth middleware. The validator will reject any endpoint with `auth: "required"` under this strategy.

**If `auth.json.strategy === "session"`:** follow the dedicated "Cookie sessions + CSRF" section below instead of the JWT instructions. The two strategies are mutually exclusive — never wire both.

Scaffold a TypeScript backend. Authoritative spec is in `.backend-design/state/`:

- `entities.json` → `prisma/schema.prisma` models
- `relationships.json` → Prisma `@relation` directives, on-delete behavior
- `endpoints.json` → one route handler per entry, exactly as specified
- `auth.json` → auth middleware and `/auth/*` routes
- `config.json` → output directory (default `./backend`)

## Layout

```
backend/
  package.json
  tsconfig.json
  prisma/schema.prisma
  src/
    index.ts            # Express bootstrap, mounts routes
    db.ts               # Prisma client singleton
    middleware/
      auth.ts           # JWT verify -> req.user
      error.ts          # global error handler
    routes/
      <resource>.ts     # one file per resource
    schemas/
      <resource>.ts     # zod request validators
    lib/
      jwt.ts            # sign/verify helpers
      password.ts       # bcrypt hash/compare
  .env.example
  README.md
```

## Constraints

- TypeScript `"strict": true`
- Express 4
- Middlewares: `cors`, `express.json()`, the JWT middleware, global error handler returning `{ error: string }` with the correct status
- **RBAC**: if any endpoint has `required_role`, generate `middleware/requireRole.ts` exporting `requireRole(role: string | string[])` which checks `req.user.role` against the allowed list and returns 403 on mismatch. Apply it on the relevant route(s) AFTER the JWT middleware. The User entity must have a `role: text` column; if `entities.json` doesn't already include it, add it with a default of the first non-admin role from `auth.rbac_roles`.
- **List endpoints with pagination/filter/sort**: read these query params:
  - `pagination.strategy === "cursor"`: `cursor` (opaque, base64-encoded id), `limit` (default 20, max 100). Return `{ data, next_cursor }`.
  - `pagination.strategy === "offset"`: `offset` (default 0), `limit` (default 20, max 100). Return `{ data, total }`.
  - `filterable_fields`: parse each as a query param of the same name; build a Prisma `where` from the present ones. Reject unknown filter params with 400.
  - `sortable_fields`: parse `sort` as `field:asc|desc`; whitelist against `sortable_fields`, default to `created_at:desc`.
  - Generate a zod schema for the query string per endpoint.
- **Nested-resource scoping** (`path_params[i].scopes_query: true`): in the list and detail handlers, include `where: { <parent_table>_id: req.params.<paramName> }` in the Prisma query. Before that, verify the authenticated user has access to the parent record (e.g. `prisma.org.findFirst({ where: { id: orgId, members: { some: { user_id: req.user.id } } } })`) — return 404 if not, so existence is not leaked.
- zod on every request body. Validation failure → 400 `{ error: "<zod message>" }`
- **Multipart endpoints** (`content_type: "multipart/form-data"`): use `multer` with memory or disk storage. Validate file MIME against `accept`, size against `max_size_mb`. Apply BEFORE the zod validator on non-file fields. Persist files: leave a `lib/storage.ts` stub with `saveFile(buffer, key): Promise<{ url: string }>` that defaults to writing under `uploads/` with a `// TODO: swap for S3/R2/etc.`. Add `UPLOADS_DIR` to `.env.example`.
- **Placeholder endpoints** (any endpoint where `temporary: true`): scaffold per the rules in the "Placeholder endpoint scaffolding" section prepended above (501 in production, throw in non-production, no data access, loud marker comment). Do NOT add zod validation, auth middleware, or Prisma queries on placeholder routes.
- **Webhook endpoints** (any endpoint where `is_webhook: true`): mount BEFORE `express.json()` and use `express.raw({ type: "application/json" })` so the raw body is available for signature verification. Emit a stub that:
  1. Reads the signature header named in `signature_header`.
  2. Verifies it against `process.env.<WEBHOOK_SOURCE>_WEBHOOK_SECRET` (uppercase the `webhook_source`). The exact verification algorithm differs per provider — for Stripe, use `stripe.webhooks.constructEvent`; for GitHub, HMAC-SHA256 of the raw body. Leave a clearly-marked `// TODO: verify with <provider> SDK` if no SDK is installed.
  3. Returns 401 on invalid signature, 200 on success.
  4. Adds the corresponding `*_WEBHOOK_SECRET` to `.env.example`.
- bcrypt password hashing (cost from `auth.json -> bcrypt_cost`)
- **Extended auth flows (per `auth.json` flags + `endpoints.json` entries):**
  - **Password reset**: `password_reset` table (`user_id`, `token_hash`, `expires_at`, `used_at`) + `POST /auth/password-reset/request` (issues a 1-hour token, emails it via a `sendEmail(to, subject, body)` stub at `lib/email.ts` — the stub just logs to stdout, leave a `// TODO: wire to SES/Resend/etc.`) and `POST /auth/password-reset/confirm` (verifies, sets new password hash, marks used_at).
  - **Email verification**: add `email_verified_at: timestamptz | null` to the User entity. `POST /auth/verify-email` accepts `{ token }` and sets it. Issue verification email on signup using the same `lib/email.ts` stub.
  - **OAuth providers**: for each provider, `GET /auth/oauth/<provider>/start` redirects to the provider's authorize URL, `GET /auth/oauth/<provider>/callback` exchanges the code, upserts the User, issues a JWT. Read `<PROVIDER>_CLIENT_ID` and `<PROVIDER>_CLIENT_SECRET` from env; add them to `.env.example`. Leave a `// TODO: install '<provider>-oauth' package` if no SDK is wired.
  - Any auth-flow endpoint added by Phase 2 must actually be implemented — the validator will reject if a required endpoint is missing from `endpoints.json`, and the orchestrator will fail verification if it's missing from the generated code.
- JWT per `auth.json` (algorithm, expiry, secret from `process.env[auth.secret_env]`)
- Dev script: `tsx watch src/index.ts`
- Use `config.pkg_manager` from `.backend-design/config.json` (default `pnpm`) for every README command and any `package.json` scripts you generate. Refer to it as `<PM>` below. For npm, prefix scripts with `npm run` (e.g. `npm run dev`); pnpm/yarn/bun run scripts directly.
- Do not implement endpoints not in `endpoints.json`. Do not invent fields not in `entities.json`.

## Best-practice column semantics

Every entity in `entities.json` carries `deleted_at`, `version`, and (when a `users` entity exists) `created_by`, `updated_by`. Handlers must respect them:

- **Soft delete (`deleted_at`)**: every list and detail Prisma query adds `where: { deleted_at: null, ... }`. `DELETE /<resource>/:id` does `prisma.<model>.update({ where: { id }, data: { deleted_at: new Date() } })` instead of `delete()`. No restore endpoint.
- **Optimistic locking (`version`)**: PATCH handlers increment `version` by 1. If the request has an `If-Match` header, parse it as an integer and add `version: <parsedInt>` to the Prisma `where` clause; if the update affects zero rows (Prisma will throw `P2025` Record not found), respond 409 with `{ error: "version_conflict", current_version: <current> }` after re-fetching the current value. Absent `If-Match` → just `data: { ..., version: { increment: 1 } }`. Every response body for a single record includes `version`.
- **Audit columns (`created_by`, `updated_by`)**: in POST handlers, set both to `req.user.id`. In PATCH handlers, set `updated_by` to `req.user.id` only (leave `created_by` alone). Endpoints with `auth: "none"` omit both fields from the insert/update (NULL is allowed because the FK is nullable).
- **Partial unique indexes for soft-deletable entities**: when a field has `unique: true` on an entity that also has `deleted_at`, do NOT emit a column-level `@unique` in `schema.prisma`. Instead use `@@index([col], where: { deleted_at: null }, name: "<table>_<col>_active_unique")` — or, if Prisma's preview features allow it, `@@unique([col], name: ..., where: { deleted_at: null })`. If Prisma can't express the partial unique constraint, fall back to a raw SQL migration emitted via `prisma db execute --file ./prisma/partial-unique.sql` and document it in `BACKEND_SETUP.md`.
- **Placeholder routes (`temporary: true`)** never touch the DB — soft delete, version, and audit columns are irrelevant there.
- **Webhook routes** (`is_webhook: true`) typically have no `req.user`; if their write targets entities with audit columns, leave `created_by`/`updated_by` as NULL.

## Cookie sessions + CSRF (when `auth.strategy === "session"`)

Replaces every JWT-specific instruction above. The two strategies are mutually exclusive.

- **Skip** `src/middleware/auth.ts` (JWT verify), `src/lib/jwt.ts`. Generate `src/lib/session.ts` instead.
- **Deps** to add:
  - `express-session`, `@types/express-session`
  - `cookie-parser`, `@types/cookie-parser`
  - `csrf-csrf` (the maintained replacement for the deprecated `csurf`)
  - Postgres store (default, when `auth.store === "postgres"`): `connect-pg-simple`, `@types/connect-pg-simple`. Reuses `DATABASE_URL` — no new infra.
  - Redis store (when `auth.store === "redis"`): `connect-redis`, `redis`. Requires `REDIS_URL`.
- **`Session` Prisma model** (when `auth.store === "postgres"`): from `entities.json -> Session`. Schema is provided by Phase 2 synthesis; do not add best-practice columns to it.
- **Middleware order** in `src/index.ts`: security middleware → `cookieParser()` → `session(...)` → `doubleCsrfProtection` → routes.
- **Session config:**
  ```ts
  app.use(session({
    name: "sid",
    secret: process.env.SESSION_SECRET!,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: Number(process.env.SESSION_MAX_AGE_DAYS ?? 7) * 24 * 60 * 60 * 1000,
    },
    store: /* connect-pg-simple OR connect-redis instance */,
  }));
  ```
- **CSRF setup** (via `csrf-csrf`):
  ```ts
  const { doubleCsrfProtection, generateToken } = doubleCsrf({
    getSecret: () => process.env.SESSION_SECRET!,
    cookieName: "x-csrf-token",
    cookieOptions: { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" },
    getTokenFromRequest: (req) => req.headers["x-csrf-token"],
  });
  ```
  Mount `doubleCsrfProtection` globally. Exempt webhook routes (`is_webhook: true`) — webhooks come from a server, not a browser, and are auth-verified via signature. Mount the exemption by wrapping `doubleCsrfProtection` to bypass when `req.path` starts with a webhook path.
- **Endpoints to generate:**
  - `POST /auth/signup` — hash password, insert user, `req.session.regenerate(cb)`, set `req.session.userId = user.id`, return `{ user }`.
  - `POST /auth/login` — verify password, `req.session.regenerate(cb)`, set `req.session.userId`, return `{ user }`.
  - `POST /auth/logout` — `req.session.destroy(cb)` → 204. This entry already exists in `endpoints.json` with `triggered_by` set; implement the body.
  - `GET /auth/csrf-token` — `res.json({ csrfToken: generateToken(req, res) })`. Add this endpoint manually if the orchestrator's `endpoints.json` doesn't already include it (the synthesis brief flags it as required when `auth.csrf.enabled`).
- **`requireSession` middleware** (replaces the JWT middleware on every `auth: "required"` route): if `!req.session.userId` → 401. Otherwise fetch the user with `prisma.user.findUnique({ where: { id: req.session.userId } })` and attach to `req.user` so existing handler code that references `req.user.id` keeps working.
- **Startup guard:** error and exit when `NODE_ENV === "production"` and `SESSION_SECRET` is missing. Same posture as `JWT_SECRET` under JWT.
- **`.env.example`** additions: `SESSION_SECRET` (required), `REDIS_URL` (only when `store === "redis"`), `SESSION_MAX_AGE_DAYS` (optional, commented).
- bcrypt password hashing is unchanged from the JWT story (cost from `auth.bcrypt_cost`).

## Security baseline (required)

Generate `src/security.ts` that exports a `applySecurity(app)` function called from `src/index.ts` immediately after `express.json()` registration (but BEFORE route mounting). It must:

- Apply `helmet()` with default headers.
- Apply `cors({ origin: parseAllowedOrigins(), credentials: true })` where `parseAllowedOrigins()` reads `process.env.ALLOWED_ORIGINS` as a comma-separated allowlist. Default to `["http://localhost:3000"]` when unset.
- Apply two `express-rate-limit` instances: a global limiter capped at `Number(process.env.RATE_LIMIT_MAX ?? 1000)` per 15 minutes, plus a stricter `writeLimiter` capped at `Number(process.env.RATE_LIMIT_WRITE_MAX ?? 100)` per 15 minutes that is applied per-route only to handlers with `method` in `{POST, PATCH, PUT, DELETE}`. Export `writeLimiter` so route files can attach it.
- Wire `pino-http` with `level: process.env.LOG_LEVEL ?? "info"` and `redact: ["req.headers.authorization", "req.headers.cookie", "res.headers['set-cookie']"]`. In dev (`NODE_ENV !== "production"`), use `pino-pretty` as the transport.

Add a startup guard in `src/index.ts`: if `process.env.NODE_ENV === "production"` and `ALLOWED_ORIGINS` is missing or contains `*`, `console.error` the reason and `process.exit(1)`. Do the same if `JWT_SECRET` is missing under JWT auth — production must fail fast, not boot with insecure defaults.

Dev deps: `helmet`, `express-rate-limit`, `cors`, `pino`, `pino-http`, `pino-pretty`.

Document the new env vars (`ALLOWED_ORIGINS`, `LOG_LEVEL`, `RATE_LIMIT_MAX`, `RATE_LIMIT_WRITE_MAX`) in `.env.example`. The `render-env-example.mjs` script already covers them at the project level; the `.env.example` you write inside the generated backend should include the same vars with the same comments.

## OpenAPI / Swagger UI (required)

The orchestrator emits `./openapi.json` at the repo root from `.backend-design/state/`. Copy it into the scaffold and serve a Swagger UI:

1. Copy `<repo-root>/openapi.json` → `backend/src/openapi.json` at codegen time. The file is the source of truth; do NOT hand-edit it (re-run `node <SKILL_DIR>/scripts/render-openapi.mjs` after design changes).
2. Add deps: `swagger-ui-express`, `@types/swagger-ui-express`.
3. In `src/index.ts`, after security middleware but **before** route mounts, register the docs route:
   ```ts
   import swaggerUi from "swagger-ui-express";
   import openapiDoc from "./openapi.json" with { type: "json" };

   const docsHandlers = [swaggerUi.serve, swaggerUi.setup(openapiDoc)];
   if (process.env.NODE_ENV === "production" && !process.env.OPENAPI_PUBLIC) {
     app.use("/docs", requireAuth, ...docsHandlers); // requireAuth = the JWT middleware
   } else {
     app.use("/docs", ...docsHandlers);
   }
   ```
4. Document `OPENAPI_PUBLIC` in `.env.example` (commented out; setting it to `1` in production exposes `/docs` without auth — opt-in only).

Skip this section entirely when `auth.strategy === "none"` *and* there are zero endpoints — there's nothing to document.

## Tests (required)

Generate a `tests/` directory with vitest + supertest + a real ephemeral Postgres via `@testcontainers/postgresql`. The point is to prove the scaffold works against a real DB, not just compile.

Add to dev deps: `vitest`, `supertest`, `@types/supertest`, `@testcontainers/postgresql`.

Add to `package.json` scripts:

```json
"test": "vitest run",
"test:watch": "vitest"
```

Files:

- **`vitest.config.ts`** — `globals: true`, `testTimeout: 30000`, `globalSetup: ["./tests/setup.ts"]`, `pool: "forks"`, `poolOptions: { forks: { singleFork: true } }`. Single fork avoids two containers racing for migrations.
- **`tests/setup.ts`** — `globalSetup` hook: starts a `PostgreSqlContainer`, exports `process.env.DATABASE_URL = container.getConnectionUri()`, runs `npx prisma migrate deploy` against it via `execSync`, returns a teardown that stops the container.
- **`tests/helpers.ts`** — exports `prisma` (a fresh `PrismaClient`), `app` (the Express app, importable for supertest), `truncateAll()` that issues `TRUNCATE TABLE <each table> RESTART IDENTITY CASCADE` (loop over `Object.keys(prisma)` for model names — Prisma provides a `_models` introspection on the client), and `createUserAndLogin()`. The helper's return shape branches on `auth.strategy`: for `jwt`, `{ user, token, headers: { Authorization: 'Bearer ' + token } }`; for `session`, `{ user, agent: request.agent(app), csrfToken, headers: { "X-CSRF-Token": csrfToken } }` where `agent` is supertest's persistent-cookie agent and `csrfToken` is fetched once via `agent.get('/auth/csrf-token')`.
- **`tests/auth.test.ts`** — when `auth.json.strategy === "jwt"`: signup returns 201 with a token; login returns 200 with a token; missing/invalid token → 401 on any protected route; valid token → 200. When `auth.json.strategy === "session"`: signup returns 201 and sets a `Set-Cookie: sid=...` header; a subsequent request reusing the cookie is authenticated (200); logout (`POST /auth/logout`) returns 204 and the same cookie afterwards returns 401; a POST to any mutating route without `X-CSRF-Token` returns 403; with the right token (fetched from `GET /auth/csrf-token`) returns 200/201.
- **`tests/<resource>.test.ts`** — one per non-auth scaffolded resource. For each: list returns `[]` initially; POST creates a row, returns 201 with `version: 1` and (when auth is on) `created_by === user.id`; PATCH with `If-Match: 1` increments to 2 and returns the new value; PATCH again with `If-Match: 1` returns 409 with `current_version`; DELETE returns 204; subsequent list excludes the deleted row.
- Each test file `beforeEach(truncateAll)` for full isolation.

Skip writing tests for placeholder routes (`temporary: true`) and webhook routes — they require either mocking 501 responses (low value) or fixture-signed webhook payloads (out of scope).

## README run commands

```
<PM> install
cp .env.example .env   # fill in DATABASE_URL and JWT_SECRET
<PM> prisma migrate dev --name init
<PM> dev
<PM> test              # runs the suite against a testcontainer Postgres (needs Docker)
```

## Verification (you run after generation)

1. `<PM> install` succeeds
2. `<PM> prisma generate` succeeds (no live DB needed)
3. `<PM> tsc --noEmit` passes
4. `<PM> test` passes (skip with a clear "Docker not running" note if `docker info` fails — do NOT mark the run failed in that case)
