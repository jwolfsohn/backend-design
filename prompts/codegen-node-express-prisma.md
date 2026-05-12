# Codegen — Node.js + Express + Prisma + Postgres

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
- zod on every request body. Validation failure → 400 `{ error: "<zod message>" }`
- bcrypt password hashing (cost from `auth.json -> bcrypt_cost`)
- JWT per `auth.json` (algorithm, expiry, secret from `process.env[auth.secret_env]`)
- Dev script: `tsx watch src/index.ts`
- Use `pnpm` in the README
- Do not implement endpoints not in `endpoints.json`. Do not invent fields not in `entities.json`.

## README run commands

```
pnpm install
cp .env.example .env   # fill in DATABASE_URL and JWT_SECRET
pnpm prisma migrate dev --name init
pnpm dev
```

## Verification (you run after generation)

1. `pnpm install` succeeds
2. `pnpm prisma generate` succeeds (no live DB needed)
3. `pnpm tsc --noEmit` passes
