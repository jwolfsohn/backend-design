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

## README run commands

Substitute `<PM>` with `config.pkg_manager` (`pnpm` / `npm` / `yarn` / `bun`). For `npm`, prefix scripts with `npm run` (e.g. `npm run dev`); the others run scripts directly.

```
<PM> install
cp .env.example .env           # fill in DATABASE_URL and JWT_SECRET
<PM> drizzle-kit generate      # produce migration files from schema
<PM> drizzle-kit migrate       # apply migrations to db
<PM> dev
```

(Alternative for prototyping: `<PM> drizzle-kit push` syncs schema → db with no migrations dir. Use `generate` + `migrate` for anything you'd commit.)

## Verification

1. `<PM> install` succeeds
2. `<PM> drizzle-kit generate` succeeds (no live DB needed)
3. `<PM> tsc --noEmit` passes
