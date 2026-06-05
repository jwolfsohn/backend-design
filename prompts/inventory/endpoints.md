Find every outbound HTTP call in this frontend. Capture URL, method, request body, response shape, trigger, and any existing server-side handler (so it's preserved, not duplicated).

Use the framework-specific search patterns from the patterns file given to you (read it first). Apply its **Network calls** bullets. Some frameworks bundle the network call into the route file (Remix loaders, SvelteKit +page.server.ts, Astro endpoints, Nuxt server routes) — treat those as existing handlers and capture them in `existing_handler`.

Write a JSON array to `.backend-design/state/endpoints.json` where each element is:

```json
{
  "method": "POST",
  "path": "/api/posts",
  "request_body": {"title": "string", "body": "string"},
  "query": {},
  "response": "Post",
  "triggered_by": ["components/NewPostForm.tsx:67"],
  "consuming_component": "app/posts/page.tsx",
  "auth_header": "Bearer token from localStorage auth_token",
  "existing_handler": null,
  "is_external": false,
  "external_origin": null,
  "evidence": ["lib/api.ts:34"]
}
```

Endpoints may also carry `required_role: string | string[] | null` (default null) and `content_type: "multipart/form-data" | "application/json"` — both are set in Phase 2, not here. Leave them absent in Phase 1.

**List-fetch enrichment.** For every GET that returns an array (i.e. a list endpoint), inspect the consuming screen for pagination, filter, and sort UI and capture them:

```json
{
  "method": "GET",
  "path": "/api/posts",
  "response": "Post[]",
  "pagination": {"strategy": "cursor", "limit_param": "limit", "cursor_param": "cursor"},
  "filterable_fields": ["status", "author_id"],
  "sortable_fields": ["created_at", "title"]
}
```

Strategies: `"cursor"` (infinite scroll, "load more" button, cursor in URL), `"offset"` (numbered page links, `?page=2`), or `null` (no pagination — small fixed list, no scroll trigger). Default `limit_param: "limit"`, `cursor_param: "cursor"` (cursor strategy) or `offset_param: "offset"` (offset strategy). Filterable fields: search inputs, dropdown filters, status tabs — capture the entity column name they correspond to. Sortable fields: sortable table headers, sort dropdowns.

**Distinguish user-backend calls from third-party API calls.** If the URL is an absolute URL whose origin is not the app itself — e.g. `https://api.stripe.com/...`, `https://api.openai.com/...`, `https://maps.googleapis.com/...` — set `is_external: true`, `external_origin: "<host>"`, leave `path` as the full URL, and do NOT generate a backend handler for it. Relative URLs (`/api/...`) and same-origin URLs are `is_external: false`.

**Detect incoming webhooks.** If you find an existing server-side handler under `app/api/webhook/`, `pages/api/webhook/`, `src/routes/api/webhook/`, `app/api/webhooks/`, or any handler that reads a header matching `*-Signature` (e.g. `Stripe-Signature`, `X-Hub-Signature-256`), add a corresponding entry with `is_webhook: true`, `webhook_source: "<inferred-source>"` (stripe, github, etc., from path or signature header), `signature_header: "<exact header name>"`, and `triggered_by: []` (webhooks are not triggered by the UI). Include these in `endpoints.json` so codegen scaffolds the signature verification.

**Endpoints inferred from non-UI signals.** When an endpoint exists in the design because the inventory inferred it from a non-UI signal — not because the UI calls it — set `inferred_from_signal: "<signal-name>"` and leave `triggered_by: []`. This is the auth-endpoint convention when `auth.json.inferred_from` is `auth_required_screen`, `token_storage_key`, `auth_header`, or `auth_path` (see SKILL.md auth signals 3–6). Signal names match the `auth.json.inferred_from` vocabulary. Example:

```json
{
  "method": "POST",
  "path": "/api/auth/signup",
  "auth": "none",
  "request_body": { "email": "string", "password": "string" },
  "response": "User",
  "triggered_by": [],
  "inferred_from_signal": "auth_required_screen"
}
```

The `inferred_from_signal` field satisfies the validator's "every endpoint has a UI trigger" invariant the same way `is_webhook: true` does for webhooks. Use it instead of pointing `triggered_by` at a signal's file:line — the latter fakes a UI trigger and misleads readers of the rendered design.

Resolve template literals and path params where possible. If a Next.js API route handler already exists, set `existing_handler` to its file path so it's not duplicated. Do not output markdown — only the JSON file.
