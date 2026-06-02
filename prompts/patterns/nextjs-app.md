Next.js with the App Router.

- **Routes**: `app/**/page.tsx`, `app/**/layout.tsx`, `app/**/loading.tsx`, `app/**/error.tsx`, `app/**/not-found.tsx`. File-based — no central route config.
- **API routes**: `app/api/**/route.ts` — these are existing endpoints to preserve.
- **Components**: `components/**/*.tsx`, `app/_components/**/*.tsx`, anywhere `*.tsx` is colocated.
- **Network calls**: server components with `await fetch(...)`, `"use server"` server actions, `fetch()`/`axios`/`useSWR`/`useQuery` in client components.
- **Forms**: `<form action={serverAction}>`, or controlled forms with `onSubmit`.
- **Auth hints**: `middleware.ts` (route protection), `app/api/auth/`, `lib/auth.ts`, NextAuth/Clerk imports.

**Webhook endpoints.** Look for incoming webhook handlers in any of these locations:

- Path-based: `**/webhook/`, `**/webhooks/` — e.g. `app/api/webhook/stripe/route.ts`, `pages/api/webhooks/[provider].ts`, `src/routes/api/webhook/+server.ts`, `server/api/webhooks/`
- Signature-based: any handler that reads a `*-Signature` header (`Stripe-Signature`, `X-Hub-Signature-256`, `Svix-Signature`, `X-Slack-Signature`, etc.)

For each, set `is_webhook: true`, `webhook_source` (e.g. `stripe`, `github`, `svix` — inferred from path or header), `signature_header` (exact header name), and `triggered_by: []`. Webhooks aren't UI-triggered, so they won't appear in the network-call inventory — emit them directly so codegen scaffolds the signature verification.
