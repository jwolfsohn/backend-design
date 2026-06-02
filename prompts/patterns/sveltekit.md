SvelteKit.

- **Routes**: `src/routes/**/+page.svelte`, `src/routes/**/+layout.svelte`, `src/routes/**/+error.svelte`. File-based.
- **Data loaders**: `+page.ts` (universal), `+page.server.ts` (server-only), `+layout.{ts,server.ts}`.
- **Server endpoints**: `src/routes/**/+server.ts` — existing API to preserve.
- **Components**: `src/lib/**/*.svelte`, `src/lib/components/**/*.svelte`.
- **Network calls**: `load` functions, `fetch` (server-aware), form `actions` in `+page.server.ts`.
- **Forms**: `<form method="POST" use:enhance>` for progressive enhancement.
- **Auth hints**: `src/hooks.server.ts` (request hooks), `src/lib/server/auth.ts`, `Lucia` or `@auth/sveltekit`.

**Webhook endpoints.** Look for incoming webhook handlers in any of these locations:

- Path-based: `**/webhook/`, `**/webhooks/` — e.g. `app/api/webhook/stripe/route.ts`, `pages/api/webhooks/[provider].ts`, `src/routes/api/webhook/+server.ts`, `server/api/webhooks/`
- Signature-based: any handler that reads a `*-Signature` header (`Stripe-Signature`, `X-Hub-Signature-256`, `Svix-Signature`, `X-Slack-Signature`, etc.)

For each, set `is_webhook: true`, `webhook_source` (e.g. `stripe`, `github`, `svix` — inferred from path or header), `signature_header` (exact header name), and `triggered_by: []`. Webhooks aren't UI-triggered, so they won't appear in the network-call inventory — emit them directly so codegen scaffolds the signature verification.
