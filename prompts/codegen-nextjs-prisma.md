# Codegen — Next.js API routes + Prisma + Postgres

Scaffold backend code **inside the existing Next.js project** (do not create a separate `backend/` directory). The frontend and backend share a single Next.js app — this is the monorepo / Vercel-friendly path.

Authoritative spec is in `.backend-design/state/`:

- `entities.json` → `prisma/schema.prisma` models
- `relationships.json` → Prisma `@relation` directives
- `endpoints.json` → one route handler per entry under `app/api/`
- `auth.json` → auth helper + `/api/auth/*` routes
- `config.json` → output directory (interpreted as the Next.js project root; default `.`)

## Layout (added/modified files only)

```
<next-project-root>/
  prisma/schema.prisma       # new
  app/
    api/
      <resource>/
        route.ts             # GET (list), POST (create) for /api/posts
        [id]/
          route.ts           # GET, PATCH, DELETE for /api/posts/[id]
      auth/
        signup/route.ts
        login/route.ts
        logout/route.ts
  lib/
    db.ts                    # Prisma client singleton (must avoid hot-reload duplication)
    auth.ts                  # verifyJwt(request), signJwt(payload), getCurrentUser(request)
    password.ts              # bcrypt helpers
    schemas/<resource>.ts    # zod request validators
  .env.example.add           # additions to .env.example (do not overwrite)
```

## Constraints

- Use App Router (Next.js 13+). Each `route.ts` exports named functions per HTTP method (`GET`, `POST`, etc.)
- Return `Response.json(data, { status })` from every handler
- `lib/db.ts` must guard against hot-reload duplication:
  ```ts
  const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
  export const prisma = globalForPrisma.prisma ?? new PrismaClient();
  if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
  ```
- Auth: read `Authorization: Bearer <token>` header in each protected handler via `lib/auth.ts -> getCurrentUser(request)`. Return 401 if missing/invalid.
- zod validate every request body: `const body = schema.parse(await request.json())`. On `ZodError` return 400.
- bcrypt password hashing (cost from `auth.json -> bcrypt_cost`)
- JWT per `auth.json`. Use `jose` (not `jsonwebtoken`) — it works in Edge runtime.
- Do not modify existing frontend code beyond adding new files.
- Do not implement endpoints not in `endpoints.json`. Do not invent fields.
- Append to `.env.example` if it exists, don't overwrite. Add: `DATABASE_URL`, `JWT_SECRET`.

## Mapping endpoints to file paths

- `GET /api/posts` → `app/api/posts/route.ts` → `export async function GET(request) {}`
- `POST /api/posts` → same file → `export async function POST(request) {}`
- `GET /api/posts/[id]` → `app/api/posts/[id]/route.ts` → `export async function GET(request, { params })`
- `PATCH /api/posts/[id]` → same → `export async function PATCH(request, { params })`
- `DELETE /api/posts/[id]` → same → `export async function DELETE(request, { params })`

Collapse same-path different-method endpoints into one `route.ts` file with multiple exported functions.

## README run commands (write to `BACKEND_SETUP.md` since `README.md` already exists)

```
pnpm install prisma @prisma/client bcrypt jose zod
pnpm install -D @types/bcrypt
cp .env.example .env   # ensure DATABASE_URL and JWT_SECRET are set
pnpm prisma migrate dev --name init
pnpm dev   # already wired
```

## Verification

1. `pnpm install` succeeds
2. `pnpm prisma generate` succeeds
3. `pnpm tsc --noEmit` passes (the Next.js project's own tsconfig)
