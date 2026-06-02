SolidStart.

- **Routes**: `src/routes/**/*.{tsx,ts}`. File-based.
- **Components**: `src/components/`.
- **Network calls**: `createResource`, `createAsync`, server actions (`"use server"`), API routes in `src/routes/api/**/*.ts`.
- **Forms**: `<form action={serverAction} method="post">`.

**Webhook endpoints.** Look for incoming webhook handlers in any of these locations:

- Path-based: `**/webhook/`, `**/webhooks/` — e.g. `app/api/webhook/stripe/route.ts`, `pages/api/webhooks/[provider].ts`, `src/routes/api/webhook/+server.ts`, `server/api/webhooks/`
- Signature-based: any handler that reads a `*-Signature` header (`Stripe-Signature`, `X-Hub-Signature-256`, `Svix-Signature`, `X-Slack-Signature`, etc.)

For each, set `is_webhook: true`, `webhook_source` (e.g. `stripe`, `github`, `svix` — inferred from path or header), `signature_header` (exact header name), and `triggered_by: []`. Webhooks aren't UI-triggered, so they won't appear in the network-call inventory — emit them directly so codegen scaffolds the signature verification.
