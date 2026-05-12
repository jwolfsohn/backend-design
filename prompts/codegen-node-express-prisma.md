# Codegen — Node.js + Express + Prisma + Postgres

**Write every file under `config.output_dir`** from `.backend-design/config.json` (default `./backend`). The layout below uses `backend/` as the placeholder — substitute the real value.

**If `auth.json.strategy === "none"`:** skip everything auth-related — do not create `middleware/auth.ts`, `lib/jwt.ts`, `lib/password.ts`, the `/auth/*` routes, or the `User` entity unless it appears in `entities.json` for a non-auth reason. Do not add `JWT_SECRET` to `.env.example`. No endpoint may use the auth middleware. The validator will reject any endpoint with `auth: "required"` under this strategy.

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

## README run commands

```
<PM> install
cp .env.example .env   # fill in DATABASE_URL and JWT_SECRET
<PM> prisma migrate dev --name init
<PM> dev
```

## Verification (you run after generation)

1. `<PM> install` succeeds
2. `<PM> prisma generate` succeeds (no live DB needed)
3. `<PM> tsc --noEmit` passes
