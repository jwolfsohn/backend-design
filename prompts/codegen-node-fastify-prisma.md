# Codegen — Node.js + Fastify + Prisma + Postgres

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
- `preHandler: [fastify.authenticate]` on routes where `endpoints[].auth === "required"`. The `authenticate` decorator wraps `request.jwtVerify()` and attaches `request.user`.
- bcrypt password hashing (cost from `auth.json -> bcrypt_cost`)
- Dev script: `tsx watch src/index.ts`
- Use `pnpm` in the README
- Do not implement endpoints not in `endpoints.json`. Do not invent fields.

## README run commands

```
pnpm install
cp .env.example .env   # fill in DATABASE_URL and JWT_SECRET
pnpm prisma migrate dev --name init
pnpm dev
```

## Verification

1. `pnpm install` succeeds
2. `pnpm prisma generate` succeeds
3. `pnpm tsc --noEmit` passes
