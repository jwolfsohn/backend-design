Remix / React Router v7 (data mode).

- **Routes**: `app/routes/**/*.tsx`. File-based. Dot-separated nested routes (e.g. `app/routes/posts.$id.tsx`).
- **Components**: `app/components/`, `app/lib/`.
- **Network calls**: `loader` and `action` exports in each route file. Fetcher calls via `useFetcher()`.
- **Forms**: `<Form method="post">` from `@remix-run/react` (or `react-router`).
- **Auth hints**: `app/services/auth.server.ts`, `app/sessions.server.ts`, cookie-based sessions.

**Webhook endpoints.** Look for incoming webhook handlers in any of these locations:

- Path-based: `**/webhook/`, `**/webhooks/` — e.g. `app/api/webhook/stripe/route.ts`, `pages/api/webhooks/[provider].ts`, `src/routes/api/webhook/+server.ts`, `server/api/webhooks/`
- Signature-based: any handler that reads a `*-Signature` header (`Stripe-Signature`, `X-Hub-Signature-256`, `Svix-Signature`, `X-Slack-Signature`, etc.)

For each, set `is_webhook: true`, `webhook_source` (e.g. `stripe`, `github`, `svix` — inferred from path or header), `signature_header` (exact header name), and `triggered_by: []`. Webhooks aren't UI-triggered, so they won't appear in the network-call inventory — emit them directly so codegen scaffolds the signature verification.
