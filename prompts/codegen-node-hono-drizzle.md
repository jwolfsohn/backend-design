# Codegen — Node.js + Hono + Drizzle + Postgres

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
- Auth middleware sets `c.set('user', payload)`; protected routes check `c.get('user')`
- bcrypt password hashing (cost from `auth.json -> bcrypt_cost`)
- JWT via `hono/jwt` with the algorithm/secret/expiry from `auth.json`
- Dev script: `tsx watch src/index.ts`
- Use `pnpm` in the README
- Do not implement endpoints not in `endpoints.json`. Do not invent fields.

## README run commands

```
pnpm install
cp .env.example .env       # fill in DATABASE_URL and JWT_SECRET
pnpm drizzle-kit push      # apply schema to db
pnpm dev
```

## Verification

1. `pnpm install` succeeds
2. `pnpm drizzle-kit generate` succeeds (no live DB needed)
3. `pnpm tsc --noEmit` passes
