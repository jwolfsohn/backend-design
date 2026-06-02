# Codegen — Node.js + Hono + Drizzle + Postgres

**Write every file under `config.output_dir`** from `.backend-design/config.json` (default `./backend`). The layout below uses `backend/` as the placeholder — substitute the real value.

**If `auth.json.strategy === "none"`:** skip everything auth-related — do not create `middleware/auth.ts`, `lib/jwt.ts`, `lib/password.ts`, the `/auth/*` routes, or the `User` entity unless it appears in `entities.json` for a non-auth reason. Do not add `JWT_SECRET` to `.env.example`. No route may read `c.get('user')`.

Scaffold a TypeScript backend. Authoritative spec is in `.backend-design/state/`:

- `entities.json` → `src/db/schema.ts` Drizzle table definitions
- `relationships.json` → Drizzle `relations()` calls + FK definitions on the column
- `endpoints.json` → one Hono route per entry
- `auth.json` → JWT middleware and `/auth/*` routes
- `config.json` → output directory

## Layout

```
backend/
  package.json
  tsconfig.json
  drizzle.config.ts
  src/
    index.ts            # Hono app, mounts routes, exports default for node-server
    db/
      schema.ts         # pgTable() definitions + relations()
      client.ts         # drizzle(postgres(DATABASE_URL))
    middleware/
      auth.ts           # JWT verify -> c.set("user", payload)
    routes/
      <resource>.ts     # one Hono sub-app per resource
    schemas/
      <resource>.ts     # zod validators (use @hono/zod-validator)
    lib/
      jwt.ts            # hono/jwt sign/verify
      password.ts       # bcrypt
  .env.example
  README.md
```

## Constraints

- TypeScript `"strict": true`
- Hono with `@hono/node-server` adapter and `@hono/zod-validator`
- Drizzle ORM: `drizzle-orm`, `drizzle-kit`, `postgres` (postgres.js driver)
- Drizzle schema in `src/db/schema.ts` using `pgTable()`. Generate from `entities.json`:
  - `uuid` → `uuid('...').primaryKey().defaultRandom()`
  - `text` → `text('...')`
  - `timestamptz` → `timestamp('...', { withTimezone: true }).defaultNow()`
  - FKs: `.references(() => otherTable.id, { onDelete: 'cascade' })`
- For each relationship in `relationships.json`, also emit a `relations()` definition for typed joins
- Drizzle migrations via `drizzle-kit`. Include `drizzle.config.ts` pointing at the schema file.
- Routes: one Hono sub-app per resource, mounted via `app.route('/posts', postsRoute)`
- Use `zValidator('json', schema)` middleware on every route with a body
- **Multipart endpoints**: use `await c.req.parseBody()` (Hono handles multipart natively). Validate MIME / size manually against the spec's `accept` / `max_size_mb`. Same `lib/storage.ts` stub pattern.
- **Placeholder endpoints** (any endpoint where `temporary: true`): scaffold per the rules in the "Placeholder endpoint scaffolding" section prepended above. Do NOT use `zValidator`, attach the auth middleware, or call Drizzle on placeholder routes.
- **Webhook endpoints** (`is_webhook: true`): do NOT use `zValidator('json')` — use `await c.req.text()` (or `arrayBuffer()`) to get the raw body for signature verification. Read `signature_header` via `c.req.header(...)`, verify against `process.env.<WEBHOOK_SOURCE>_WEBHOOK_SECRET`, return 401/200. Add the env var to `.env.example`.
- Auth middleware sets `c.set('user', payload)`; protected routes check `c.get('user')`
- **RBAC**: for routes with `required_role`, add a `requireRole(role)` middleware that runs after the auth middleware and returns `c.json({ error: 'forbidden' }, 403)` on mismatch. User table must include a `role: text` column.
- **List endpoints**: same pagination/filter/sort semantics. Use `zValidator('query', schema)` to validate query string. Build the Drizzle query with `.where(and(...))` from the present filters and `.orderBy(asc|desc(table[col]))` from the whitelisted sort.
- **Nested-resource scoping**: same as Express — `.where(eq(table.<parent>_id, c.req.param('<paramName>')))` plus a parent-access check first; 404 on no access.
- bcrypt password hashing (cost from `auth.json -> bcrypt_cost`)
- **Extended auth flows** (per `auth.json` flags): `password_reset` table (Drizzle `pgTable`) + `/auth/password-reset/{request,confirm}`; `email_verified_at` column on User + `/auth/verify-email`; OAuth `start`/`callback` per provider. `lib/email.ts` stub logs to stdout. Add per-provider `<PROVIDER>_CLIENT_ID` / `_SECRET` to `.env.example`.
- JWT via `hono/jwt` with the algorithm/secret/expiry from `auth.json`
- Dev script: `tsx watch src/index.ts`
- Use `config.pkg_manager` from `.backend-design/config.json` (default `pnpm`) for every README command and any `package.json` scripts you generate. Refer to it as `<PM>` below.
- Do not implement endpoints not in `endpoints.json`. Do not invent fields.

## Best-practice column semantics

Every entity in `entities.json` carries `deleted_at`, `version`, and (when a `users` entity exists) `created_by`, `updated_by`. Handlers must respect them in Drizzle:

- **Soft delete (`deleted_at`)**: list/detail queries combine `isNull(<table>.deleted_at)` with any other filters via `and(...)`. `DELETE /<resource>/:id` runs `db.update(<table>).set({ deleted_at: new Date() }).where(eq(<table>.id, id))` instead of `db.delete(...)`. No restore endpoint.
- **Optimistic locking (`version`)**: PATCH uses ``db.update(<table>).set({ ..., version: sql`${<table>.version} + 1` }).where(eq(<table>.id, id)).returning()``. If the request has an `If-Match` header, parse to integer and add `eq(<table>.version, <parsedInt>)` to the `where`; if the returning array is empty, respond 409 with `{ error: "version_conflict", current_version: <current> }` after a re-fetch. Every single-record response includes `version`.
- **Audit columns (`created_by`, `updated_by`)**: in POST handlers set both to `c.get('user').id`. In PATCH set `updated_by` only. Endpoints with `auth: "none"` omit both.
- **Partial unique indexes for soft-deletable entities**: use Drizzle's `uniqueIndex('<table>_<col>_active_unique').on(<table>.<col>).where(sql\`deleted_at IS NULL\`)` in place of a column-level `.unique()`. Required so re-creating a soft-deleted row doesn't collide.
- **Placeholder routes (`temporary: true`)** never touch the DB.
- **Webhook routes** typically have no `c.get('user')`; if their write targets entities with audit columns, leave `created_by`/`updated_by` as NULL.

## Security baseline (required)

In `src/index.ts`, apply these middlewares to the root Hono app (before route mounts):

- `secureHeaders()` from `hono/secure-headers` with defaults.
- `cors()` from `hono/cors` with `origin: parseAllowedOrigins()` (comma-separated allowlist from `process.env.ALLOWED_ORIGINS`, default `["http://localhost:3000"]`).
- `rateLimiter` from `hono-rate-limiter` with `windowMs: 15 * 60 * 1000`, `limit: Number(process.env.RATE_LIMIT_MAX ?? 1000)`. Apply a second instance with the tighter `RATE_LIMIT_WRITE_MAX` limit only to routes whose handlers are POST/PATCH/PUT/DELETE (attach it as additional middleware in the per-resource sub-app).
- `logger()` from `hono/logger` for request logs. Wrap with a JSON formatter when `NODE_ENV === "production"` and pretty when in dev. Honor `LOG_LEVEL` to gate verbose logs.

Startup guard at the top of `src/index.ts`: if `process.env.NODE_ENV === "production"` and `ALLOWED_ORIGINS` is missing or contains `*`, `console.error` and `process.exit(1)`. Same for missing `JWT_SECRET` under JWT.

Dev deps: `hono-rate-limiter`.

Document new env vars (`ALLOWED_ORIGINS`, `LOG_LEVEL`, `RATE_LIMIT_MAX`, `RATE_LIMIT_WRITE_MAX`) in `.env.example`.

## Tests (required)

Generate a `tests/` directory with vitest + `@testcontainers/postgresql`. Use `app.fetch(new Request(...))` for in-process requests — no need for supertest, Hono runs natively on Web Fetch.

Add to dev deps: `vitest`, `@testcontainers/postgresql`.

Add to `package.json` scripts:

```json
"test": "vitest run",
"test:watch": "vitest"
```

Files:

- **`vitest.config.ts`** — same as the other Node stacks.
- **`tests/setup.ts`** — starts `PostgreSqlContainer`, sets `process.env.DATABASE_URL`, runs `npx drizzle-kit push` (faster than migrate for tests), returns teardown.
- **`tests/helpers.ts`** — exports the `app` (default export from `src/index.ts`), the Drizzle `db`, `truncateAll()` that loops over `Object.values(schema)` and issues `TRUNCATE`, and `createUserAndLogin()` that fetches `POST /auth/signup` via `app.fetch()` and returns `{ user, token, headers }`.
- **`tests/auth.test.ts`** — only when `auth.json.strategy === "jwt"`. Same shape as the Express stack.
- **`tests/<resource>.test.ts`** — one per non-auth scaffolded resource. Wrap each request as `await app.fetch(new Request("http://test/posts", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", ...auth } }))`. Cover the same five shapes (list-empty, create with `version: 1`, PATCH-with-If-Match-1 → 2, stale-If-Match → 409, DELETE → 204).
- `beforeEach(truncateAll)`.

Skip tests for placeholder routes and webhook routes.

## README run commands

Substitute `<PM>` with `config.pkg_manager` (`pnpm` / `npm` / `yarn` / `bun`). For `npm`, prefix scripts with `npm run` (e.g. `npm run dev`); the others run scripts directly.

```
<PM> install
cp .env.example .env           # fill in DATABASE_URL and JWT_SECRET
<PM> drizzle-kit generate      # produce migration files from schema
<PM> drizzle-kit migrate       # apply migrations to db
<PM> dev
<PM> test                      # runs the suite against a testcontainer Postgres (needs Docker)
```

(Alternative for prototyping: `<PM> drizzle-kit push` syncs schema → db with no migrations dir. Use `generate` + `migrate` for anything you'd commit.)

## Verification

1. `<PM> install` succeeds
2. `<PM> drizzle-kit generate` succeeds (no live DB needed)
3. `<PM> tsc --noEmit` passes
4. `<PM> test` passes (skip with "Docker not running" note if `docker info` fails)
