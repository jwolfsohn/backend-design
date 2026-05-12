# Codegen — Next.js API routes + Prisma + Postgres

Scaffold backend code **inside the existing Next.js project** (do not create a separate `backend/` directory). The frontend and backend share a single Next.js app — this is the monorepo / Vercel-friendly path.

**If `auth.json.strategy === "none"`:** skip everything auth-related — do not create `lib/auth.ts`, `lib/password.ts`, the `app/api/auth/*` routes, or the `User` entity unless it appears in `entities.json` for a non-auth reason. Do not add `JWT_SECRET` to `.env.example`. Protected handlers should not exist (every endpoint should have `auth: "none"` already, post-Phase-2).

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
- **RBAC**: when an endpoint has `required_role`, the handler also calls `requireRole(user, role)` (export from `lib/auth.ts`) which returns a 403 `Response` if the user's role doesn't match. The User model needs a `role: String` field.
- **List endpoints**: parse query params from `request.nextUrl.searchParams` (or `new URL(request.url)`). Same cursor/offset semantics and `{data, next_cursor}` / `{data, total}` response shapes. Whitelist filter and sort params against the endpoint spec.
- **Nested-resource scoping**: read the param from the `{ params }` arg (`export async function GET(request, { params }: { params: { orgId: string } })`), verify parent access first (404 on no access), then add the FK filter to the Prisma query.
- zod validate every request body: `const body = schema.parse(await request.json())`. On `ZodError` return 400.
- **Multipart endpoints**: use `await request.formData()` (built into Web Fetch). Pull file fields via `formData.get('<name>') as File`, check `file.size` and `file.type` against the spec. `lib/storage.ts` stub with `saveFile(file, key)` that writes to `public/uploads/` and leaves a `// TODO: swap for S3/R2/Vercel Blob`.
- **Webhook endpoints** (`is_webhook: true`): read `await request.text()` for the raw body (do NOT use `request.json()` until after signature verification), read the `signature_header`, verify against `process.env.<WEBHOOK_SOURCE>_WEBHOOK_SECRET`. Return `new Response(null, { status: 401 })` on invalid, `Response.json({ ok: true })` on valid. Add the env var to `.env.example`.
- Password hashing with `bcryptjs` (pure JS, not native `bcrypt`). The native `bcrypt` package needs build tools at install time and breaks on Vercel/Edge. Cost from `auth.json -> bcrypt_cost`.
- **Extended auth flows** (per `auth.json` flags): `password_reset` Prisma model + `app/api/auth/password-reset/request/route.ts` and `app/api/auth/password-reset/confirm/route.ts`; `email_verified_at` field on User + `app/api/auth/verify-email/route.ts`; OAuth `start`/`callback` per provider under `app/api/auth/oauth/<provider>/`. `lib/email.ts` stub logs to console. Add per-provider `<PROVIDER>_CLIENT_ID` / `_SECRET` to `.env.example`.
- JWT per `auth.json`. Use `jose` (not `jsonwebtoken`) — it works in Edge runtime.
- Do not modify existing frontend code beyond adding new files.
- **Never overwrite a user-authored file.** Before writing any file under `app/api/`, `lib/`, or `prisma/`, check whether the target path exists. If it does:
  - For `app/api/<resource>/route.ts` and `lib/*.ts` files: write a sibling `<name>.generated.ts` instead (e.g. `route.generated.ts`, `db.generated.ts`).
  - For `prisma/schema.prisma`: if it exists, write `prisma/schema.generated.prisma` and tell the user to diff and merge by hand.
  - Track every skipped target in a `BACKEND_GENERATED.md` report at the project root with two sections: "Files written" and "Files skipped (existing kept; .generated sibling written) — review and merge". Surface this in the final orchestrator report too.
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

Use `config.pkg_manager` (`<PM>`) from `.backend-design/config.json` — default `pnpm`.

```
<PM> install prisma @prisma/client bcryptjs jose zod
<PM> install -D @types/bcryptjs
cp .env.example .env   # ensure DATABASE_URL and JWT_SECRET are set
<PM> prisma migrate dev --name init
<PM> dev   # already wired
```

## Verification

1. `<PM> install` succeeds
2. `<PM> prisma generate` succeeds
3. `<PM> tsc --noEmit` passes (the Next.js project's own tsconfig)
