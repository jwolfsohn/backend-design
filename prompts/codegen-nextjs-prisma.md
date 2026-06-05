# Codegen — Next.js API routes + Prisma + Postgres

Scaffold backend code **inside the existing Next.js project** (do not create a separate `backend/` directory). The frontend and backend share a single Next.js app — this is the monorepo / Vercel-friendly path.

**If `auth.json.strategy === "none"`:** skip everything auth-related — do not create `lib/auth.ts`, `lib/password.ts`, the `app/api/auth/*` routes, or the `User` entity unless it appears in `entities.json` for a non-auth reason. Do not add `JWT_SECRET` to `.env.example`. Protected handlers should not exist (every endpoint should have `auth: "none"` already, post-Phase-2).

**If `auth.json.strategy === "session"`:** follow the "Cookie sessions + CSRF" section below instead of the JWT path. Mutually exclusive with `jwt`.

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
- **Placeholder endpoints** (any endpoint where `temporary: true`): scaffold per the rules in the "Placeholder endpoint scaffolding" section prepended above. Do NOT call `prisma`, run zod validation, or apply the auth middleware on placeholder routes.
- **Inferred endpoints** (`inferred_from_signal: "<signal>"`): scaffold the route the same way as a normal endpoint, but add a TODO at the top of the handler: `// TODO: no UI wires up to this endpoint; inferred from <signal>. Add the form or remove the endpoint.` Common for auth endpoints when `auth.json.inferred_from` is `auth_required_screen`, `token_storage_key`, `auth_header`, or `auth_path`.
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

## Best-practice column semantics

Every entity in `entities.json` carries `deleted_at`, `version`, and (when a `users` entity exists) `created_by`, `updated_by`. Handlers must respect them:

- **Soft delete (`deleted_at`)**: every list and detail Prisma query adds `where: { deleted_at: null, ... }`. `DELETE` handlers do `prisma.<model>.update({ where: { id }, data: { deleted_at: new Date() } })` instead of `delete()`. No restore route.
- **Optimistic locking (`version`)**: PATCH handlers read `request.headers.get("if-match")`. If present, parse to integer and add `version: <parsedInt>` to the Prisma `where` clause; catch the Prisma `P2025` error (record not found) and respond 409 `Response.json({ error: "version_conflict", current_version: <current> }, { status: 409 })` after re-fetching. Absent header → `data: { ..., version: { increment: 1 } }`. Single-record responses include `version`.
- **Audit columns (`created_by`, `updated_by`)**: in POST handlers set both to `(await getCurrentUser(request)).id`. In PATCH set `updated_by` only. Endpoints with `auth: "none"` omit both.
- **Partial unique indexes for soft-deletable entities**: prefer Prisma `@@index([col], where: { deleted_at: null })` or a raw SQL migration if Prisma's version doesn't express partial uniques natively. Document the manual migration in `BACKEND_SETUP.md`.
- **Placeholder routes (`temporary: true`)** never touch the DB.
- **Webhook routes** typically have no authenticated user; leave `created_by`/`updated_by` as NULL when writes target audit-equipped entities.

## Mapping endpoints to file paths

- `GET /api/posts` → `app/api/posts/route.ts` → `export async function GET(request) {}`
- `POST /api/posts` → same file → `export async function POST(request) {}`
- `GET /api/posts/[id]` → `app/api/posts/[id]/route.ts` → `export async function GET(request, { params })`
- `PATCH /api/posts/[id]` → same → `export async function PATCH(request, { params })`
- `DELETE /api/posts/[id]` → same → `export async function DELETE(request, { params })`

Collapse same-path different-method endpoints into one `route.ts` file with multiple exported functions.

## Cookie sessions + CSRF (when `auth.strategy === "session"`)

Replaces JWT-specific instructions above. Mutually exclusive with `jwt`.

- **Skip** `lib/auth.ts`'s JWT verify/sign helpers (`jose`). Generate `lib/session.ts` instead.
- **Deps:** `iron-session` (Next.js's de facto session library — works in Edge and Node runtimes, no jose-vs-jsonwebtoken footgun).
- **`Session` Prisma model** when `auth.store === "postgres"` (from `entities.json`). When `auth.store === "redis"`, install `redis` and wire a thin adapter at `lib/session-store-redis.ts`.
- **Session config** in `lib/session.ts`:
  ```ts
  import { getIronSession } from "iron-session";
  export type SessionData = { userId?: string };
  export const sessionOptions = {
    password: process.env.SESSION_SECRET!,
    cookieName: "sid",
    cookieOptions: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax" as const,
      maxAge: Number(process.env.SESSION_MAX_AGE_DAYS ?? 7) * 24 * 60 * 60,
    },
  };
  export async function getSession() {
    return getIronSession<SessionData>(await cookies(), sessionOptions);
  }
  ```
  When `auth.store !== "cookie"`, store only `{ sid }` in the cookie and look up the session blob from Postgres/Redis using the `Session` table; cap cookie size below 4 KB even with encryption overhead.
- **CSRF:** `iron-session` does not ship a CSRF middleware. Add `lib/csrf.ts` implementing the double-submit cookie pattern:
  ```ts
  export async function requireCsrfToken(request: Request) {
    const header = request.headers.get("x-csrf-token");
    const cookie = (await cookies()).get("csrf")?.value;
    if (!header || !cookie || header !== cookie) {
      throw new Response(JSON.stringify({ error: "csrf_invalid" }), { status: 403 });
    }
  }
  ```
  Call `await requireCsrfToken(request)` at the top of every mutating handler (POST/PATCH/DELETE) **except** webhooks. Also extend `middleware.ts` to set a `csrf` cookie (random 32 bytes hex) for any request that doesn't have one yet.
- **Endpoints to generate:**
  - `POST /api/auth/signup` — hash, insert, `session.userId = user.id; await session.save();`, return user JSON.
  - `POST /api/auth/login` — verify, set userId, save, return user.
  - `POST /api/auth/logout` — `session.destroy(); return new Response(null, { status: 204 })`.
  - `GET /api/auth/csrf-token` — returns the current `csrf` cookie value as `{ csrfToken }`. Also `Set-Cookie: csrf=...` if missing.
- **`getCurrentUser()`** (replaces JWT version): reads `session.userId`, fetches the user row, returns it or null. Mutating routes still call `requireCsrfToken()` first, then `getCurrentUser()`; non-mutating routes call only `getCurrentUser()`.
- **Startup guard** in `lib/db.ts`: throw at module load when `NODE_ENV === "production"` and `SESSION_SECRET` is missing.
- **`.env.example.add`:** add `SESSION_SECRET`, `REDIS_URL` (only when `store === "redis"`), `SESSION_MAX_AGE_DAYS` (optional, commented).

## Security baseline (required)

Add `middleware.ts` at the project root (Next.js convention) that:

- Validates the `Origin` header against `process.env.ALLOWED_ORIGINS` (comma-separated allowlist). Reject mismatched origins on non-GET requests with `new NextResponse(null, { status: 403 })`. Default to `["http://localhost:3000"]` when unset.
- Applies a rate limiter. If `process.env.UPSTASH_REDIS_URL` is set, use `@upstash/ratelimit` with `slidingWindow(Number(process.env.RATE_LIMIT_MAX ?? 1000), "15 m")` and a tighter window for write methods. Otherwise fall back to a small in-memory `Map<ip, { count, resetAt }>` limiter scoped to the same numbers — leave a `// TODO: swap for @upstash/ratelimit on Vercel; in-memory limiter resets per cold start` comment.
- Configures the `matcher` to only run on `/api/:path*`.

Add `lib/security.ts` exporting `securityHeaders()` returning a `Headers` object with CSP (`default-src 'self'`), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Strict-Transport-Security: max-age=31536000; includeSubDomains`. Every API route handler calls `Object.assign(response.headers, securityHeaders())` before returning, or uses `Response.json(data, { status, headers: securityHeaders() })`.

Startup guard in `lib/db.ts` or `middleware.ts`: if `process.env.NODE_ENV === "production"` and `ALLOWED_ORIGINS` is missing or contains `*`, throw at module load — Next.js will surface it at boot.

Dev deps to add: `@upstash/ratelimit` (optional, gated on the env var).

Document new env vars (`ALLOWED_ORIGINS`, `LOG_LEVEL`, `RATE_LIMIT_MAX`, `RATE_LIMIT_WRITE_MAX`, `UPSTASH_REDIS_URL`) in `.env.example` (or `.env.example.add` per the existing file-preservation rule).

Logging: use the platform default (Next.js / Vercel auto-collects stdout). Document `LOG_LEVEL` in `BACKEND_SETUP.md` even though there's no logger library — handlers should `console.log({ level, msg, ...ctx })` in JSON so log aggregators can parse.

## OpenAPI / Swagger UI (required)

The orchestrator emits `./openapi.json` at the repo root. Serve it from `public/` and add a docs page:

1. Copy `<repo-root>/openapi.json` → `public/openapi.json` at codegen time (Next.js serves files under `public/` as static assets at the URL of the same name → `/openapi.json`).
2. Add deps: `swagger-ui-react`, `@types/swagger-ui-react`.
3. Create `app/api-docs/page.tsx` (avoid `app/docs/...` so it doesn't collide with any existing docs route):
   ```tsx
   "use client";
   import "swagger-ui-react/swagger-ui.css";
   import SwaggerUI from "swagger-ui-react";
   export const dynamic = "force-dynamic";
   export default function ApiDocsPage() {
     return <SwaggerUI url="/openapi.json" />;
   }
   ```
4. **Gate in production.** When `auth.strategy === "jwt"`, also create `app/api-docs/layout.tsx` that calls `getCurrentUser()` from `lib/auth.ts` and `redirect("/login")` when `process.env.NODE_ENV === "production"` AND `process.env.OPENAPI_PUBLIC` is unset AND the user is unauthenticated.
5. Document `OPENAPI_PUBLIC` in `.env.example.add` (commented out; default = require auth in production).

Skip when `auth.strategy === "none"` and there are zero endpoints. If `app/api-docs/page.tsx` already exists (user-authored), write `app/api-docs/page.generated.tsx` per the existing never-overwrite rule.

## Tests (required)

Generate a `tests/` directory with vitest + `@testcontainers/postgresql`. Test the route handlers directly — Next.js route files export pure functions (`GET`, `POST`, `PATCH`, `DELETE`) that take a `Request` and return a `Response`, so there's no HTTP layer to mock.

Add to dev deps: `vitest`, `@testcontainers/postgresql`.

Add to `package.json` scripts:

```json
"test": "vitest run",
"test:watch": "vitest"
```

Files:

- **`vitest.config.ts`** — `globals: true`, `testTimeout: 30000`, `globalSetup: ["./tests/setup.ts"]`, `pool: "forks"`, `poolOptions: { forks: { singleFork: true } }`.
- **`tests/setup.ts`** — starts `PostgreSqlContainer`, sets `process.env.DATABASE_URL`, runs `npx prisma migrate deploy`. Also sets `process.env.JWT_SECRET = "test-secret"` so `lib/auth.ts` works.
- **`tests/helpers.ts`** — exports `prisma`, `truncateAll()`, and `signupAndLogin()` that imports `POST` from `app/api/auth/signup/route.ts` and `app/api/auth/login/route.ts`, invokes them with a `new Request(...)`, and returns `{ user, token }`.
- **`tests/auth.test.ts`** — under `auth.json.strategy === "jwt"`, import the auth route handlers directly, invoke with `new Request("http://test/api/auth/signup", { method: "POST", body: JSON.stringify({ email, password }), headers: { "content-type": "application/json" } })`. Assert response shape. Under `strategy === "session"`: capture the `set-cookie` header from the signup response, replay it as `cookie:` on the next request to assert authenticated access; assert logout clears it; assert mutating routes without `X-CSRF-Token` → 403 and with the right token → 200/201. Mock `cookies()` from `next/headers` with `vi.mock("next/headers", ...)` so iron-session can read/write during tests.
- **`tests/<resource>.test.ts`** — one per non-auth resource. Import the route handlers, invoke with hand-built `Request` objects. For routes with `[id]`, pass the `{ params: { id } }` second argument: `await GET(req, { params: Promise.resolve({ id: "..." }) })` (Next.js 15+ async params).
- `beforeEach(truncateAll)`.

Skip tests for placeholder routes and webhook routes.

## README run commands (write to `BACKEND_SETUP.md` since `README.md` already exists)

Use `config.pkg_manager` (`<PM>`) from `.backend-design/config.json` — default `pnpm`.

```
<PM> install prisma @prisma/client bcryptjs jose zod
<PM> install -D @types/bcryptjs vitest @testcontainers/postgresql
cp .env.example .env   # ensure DATABASE_URL and JWT_SECRET are set
<PM> prisma migrate dev --name init
<PM> dev               # already wired
<PM> test              # runs the suite against a testcontainer Postgres (needs Docker)
```

## Verification

1. `<PM> install` succeeds
2. `<PM> prisma generate` succeeds
3. `<PM> tsc --noEmit` passes (the Next.js project's own tsconfig)
4. `<PM> test` passes (skip with "Docker not running" note if `docker info` fails)
