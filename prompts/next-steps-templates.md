# next-steps templates

Instructional copy for `backend-design-next-steps.md`, keyed by gap-type or `gap-type:specifier`. Loaded by `scripts/detect-gaps.mjs`.

**Lookup order**: `<type>:<specifier>` (exact) → `<type>` (generic fallback).
**Placeholders**: `{label}`, `{file}`, `{evidence}`, `{var}`, `{service}` — substituted at render time. Unsubstituted placeholders are left as-is.

## missing_env_var:DATABASE_URL

**Why**: The backend opens a Postgres connection at boot. Without `DATABASE_URL`, the server won't start.

**How**: Add a connection string to `.env`:
```
DATABASE_URL=postgresql://user:password@host:5432/dbname
```
Don't have a Postgres yet? Pick one:
- **Neon** (free, fastest): https://neon.tech → create project → copy the connection string from the dashboard.
- **Supabase** (free, includes auth UI later if you want it): https://supabase.com → New project → Project Settings → Database → Connection string.
- **Local with Docker**: `docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:16`, then `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres`.

Verify with: `psql "$DATABASE_URL" -c 'select 1'`.

## missing_env_var:JWT_SECRET

**Why**: User tokens are signed with this. Without it, no one can stay logged in across requests.

**How**: Generate one and paste it into `.env`:
```bash
echo "JWT_SECRET=$(openssl rand -base64 32)" >> .env
```
Don't share this value publicly. Don't commit `.env` (the generated `.gitignore` covers it).

## missing_env_var:STRIPE_SECRET_KEY

**Why**: Your design includes Stripe — the backend needs the secret key to make API calls.

**How**: Get it from https://dashboard.stripe.com/apikeys → "Secret key". Use the **test** key (starts with `sk_test_`) until you're ready to take real payments. Add to `.env`:
```
STRIPE_SECRET_KEY=sk_test_...
```

## missing_env_var:STRIPE_WEBHOOK_SECRET

**Why**: Webhook handlers verify the `Stripe-Signature` header against this. Without it, the verification stub will reject every event.

**How**: For local dev, run `stripe listen --forward-to localhost:3000/api/webhooks/stripe` — the CLI prints a `whsec_...` value. Paste into `.env`:
```
STRIPE_WEBHOOK_SECRET=whsec_...
```
For production, get the value from https://dashboard.stripe.com/webhooks after you create the endpoint.

## missing_env_var:EMAIL_PROVIDER

**Why**: Your auth flow includes password reset and/or email verification, so the generated backend's `lib/email.ts` stub needs a real provider to send mail. Without one, reset/verification tokens will be created but never delivered — users will be stuck.

**How**: Pick one provider and add its key to `.env`:

| Provider | Get a key | Free tier |
|---|---|---|
| **Resend** (recommended for new projects) | https://resend.com/api-keys | 3,000/mo |
| **SendGrid** | https://app.sendgrid.com/settings/api_keys | 100/day |
| **Mailgun** | https://app.mailgun.com/app/sending/domains | 5,000/mo for 3 months |
| **Postmark** (best deliverability) | https://account.postmarkapp.com/api_tokens | 100/mo |
| **Generic SMTP** | Your existing mail server | n/a |

Then edit `lib/email.ts` in the generated backend to call your provider's SDK instead of `console.log`-ing. Or ask Claude: *"Wire `lib/email.ts` to use Resend with the RESEND_API_KEY from env."*

## missing_env_var:UPLOADS_DIR

**Why**: Your design includes multipart endpoints that accept file uploads. The codegen scaffolds a `lib/storage.ts` stub that writes to disk under `UPLOADS_DIR`. If unset, it defaults to `./uploads/` — fine for local dev, but you'll want object storage (S3/R2/etc.) for production.

**How**: For local dev, you can leave this unset and `./uploads/` will be used. To set explicitly, add to `.env`:
```
UPLOADS_DIR=./uploads
```

For production, replace the `lib/storage.ts` stub with an S3/R2 implementation rather than relying on local disk (containers and serverless runtimes have ephemeral filesystems). Ask Claude: *"Swap `lib/storage.ts` from local disk to S3 using the AWS SDK v3."*

## missing_env_var

**Why**: This environment variable is referenced by your generated backend but not set in `.env`.

**How**: Add `{var}=...` to `.env`. If you're not sure what value goes here, search for it in the generated backend code — the comment near each reference usually explains what it's for.

## missing_auth_ui

**Why**: Your design has signup/login endpoints (see `backend-design.md` → Auth model) but the frontend has no forms that submit to them. No user can ever sign up, so authenticated screens will be unreachable in practice.

**How**: Two paths:
1. **Add the forms** — ask Claude: *"Scaffold signup and login pages for this frontend. POST to /api/auth/signup and /api/auth/login. Store the returned JWT in localStorage under the key 'auth_token'. Redirect to / on success."*
2. **Drop auth from the design** — if you don't actually want users, edit `.backend-design/state/auth.json` and set `signup: false, login: false`, then re-run `/backend-design`. Any screens marked `auth_required: true` will need to be made public.

## unwired_button

**Why**: The "{label}" button at `{file}` is interactive but has no working handler — currently it either calls `alert()`, does nothing, or navigates nowhere. The skill won't invent an endpoint for it; you need to decide what it does.

**How**: Pick one:
1. **It should open a form** → sketch the form in the frontend first. Re-run `/backend-design` and the skill will pick up the new form + generate the endpoint.
2. **It should trigger an immediate action** → wire the `onClick` to a `fetch()` call. Ask Claude: *"Wire up the '{label}' button at `{file}` to call POST /api/<your-path> with the right body. Send the JWT from localStorage as the Authorization header."*
3. **It should navigate** → replace the handler with a router link (`<Link href="...">`, `router.push(...)`, etc.).

If it shouldn't do anything, delete the button.

## placeholder_endpoint

**Why**: Vibe-coder mode scaffolded `{endpoint}` from an orphan UI signal at `{trigger}` — the frontend has a button that implies a backend call, but the path and method are the skill's **best guess**. The generated handler returns 501 in production and throws in dev, so calling it will fail loudly.

**How**: Three paths, pick one:
1. **Replace with a real implementation** — open the generated handler file, delete the placeholder body, write the real one. Then remove `"temporary": true` from this entry in `.backend-design/state/endpoints.json` and re-run `npx backend-design gaps` to close this item.
2. **Change the path or method** — if `{endpoint}` should be something different (e.g. `PUT /api/listings/:id/host-status` rather than what was guessed), edit `endpoints.json` to match what you want, then re-scaffold by running `/backend-design` again.
3. **Delete it** — if the button shouldn't trigger an API call at all, remove the endpoint from `endpoints.json` AND fix the button in the frontend.

Don't ship a frontend that calls a placeholder path to production — paths are throwaway by design.

## external_account_unconfirmed:supabase

**Why**: You have `@supabase/supabase-js` in `package.json` but the skill can't verify you have a Supabase project set up.

**How**: If you haven't already:
1. Sign up at https://supabase.com.
2. Create a new project.
3. Copy the project URL and anon key from Project Settings → API into your frontend env (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` or your framework's equivalent).

If you're using Supabase only for Postgres and want this skill's backend to own auth, you can ignore Supabase auth — the connection string from Supabase works as `DATABASE_URL`.

## external_account_unconfirmed:stripe

**Why**: Your frontend or design references Stripe. You'll need a Stripe account to get API keys.

**How**: Sign up at https://stripe.com (free, only charges per transaction). Then:
1. Get test API keys from https://dashboard.stripe.com/test/apikeys.
2. Install the Stripe CLI: https://stripe.com/docs/stripe-cli.
3. Use `stripe listen` for local webhook testing.

## external_account_unconfirmed:openai

**Why**: Your frontend or design calls `api.openai.com`. You'll need an OpenAI account and an API key.

**How**:
1. Sign up at https://platform.openai.com.
2. Add a payment method (OpenAI doesn't have a free tier for API access).
3. Create a key at https://platform.openai.com/api-keys → paste into `.env` as `OPENAI_API_KEY`.

## external_account_unconfirmed

**Why**: Your design references the external service `{service}`. The skill can't verify you have an account set up.

**How**: Check the service's documentation for sign-up and API-key setup. Add the resulting credentials to `.env`.
