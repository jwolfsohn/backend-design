# Codegen — Node.js + Fastify + Prisma + Postgres

**Write every file under `config.output_dir`** from `.backend-design/config.json` (default `./backend`). The layout below uses `backend/` as the placeholder — substitute the real value.

**If `auth.json.strategy === "none"`:** skip everything auth-related — do not create `plugins/auth.ts`, `lib/password.ts`, the `/auth/*` routes, or the `User` entity unless it appears in `entities.json` for a non-auth reason. Do not register `@fastify/jwt`. Do not add `JWT_SECRET` to `.env.example`. No endpoint may use `preHandler: [fastify.authenticate]`.

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

## README run commands

```
<PM> install
cp .env.example .env   # fill in DATABASE_URL and JWT_SECRET
<PM> prisma migrate dev --name init
<PM> dev
```

## Verification

1. `<PM> install` succeeds
2. `<PM> prisma generate` succeeds
3. `<PM> tsc --noEmit` passes
