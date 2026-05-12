---
name: backend-design
description: Design and scaffold a backend for an existing frontend. Activate on "/backend-design", "build a backend for this frontend", "generate the API and database for this app", "design a backend from the UI", or similar intent. The user sees two checkpoints — a reviewable design doc (endpoints, DB schema, auth), then scaffolded code after they approve.
---

# backend-design

You are about to design and scaffold a backend for an **existing frontend** in the current working directory. Supported frontends (auto-detected by the CLI): Next.js (App or Pages Router), React SPA, Vue, Nuxt, Svelte, SvelteKit, Angular 17+, Astro, SolidJS / SolidStart, Qwik, Remix / React Router v7, Gatsby, HTMX, vanilla HTML/JS. The frontend is the source of truth: every button, form, fetch call, and route in the UI implies a backend obligation. Your job is to extract those obligations, get the user's approval on the shape of the backend, and then build it in the stack they chose.

**Skill root:** locate this skill's directory once at the start. It's the directory containing this `SKILL.md`. Refer to it as `<SKILL_DIR>` below — typical values are `~/.claude/skills/backend-design` (default install) or `~/.claude/plugins/.../skills/backend-design` (plugin install). Resolve all `<SKILL_DIR>/...` references against the actual location, not the literal string.

The stack is **not fixed** — it's selected by the user via `npx backend-design start` before activating this skill, and recorded in `.backend-design/config.json`. Supported stacks:

| `stack.id` | Codegen prompt |
|------------|----------------|
| `node-express-prisma` | `prompts/codegen-node-express-prisma.md` |
| `node-fastify-prisma` | `prompts/codegen-node-fastify-prisma.md` |
| `node-hono-drizzle`   | `prompts/codegen-node-hono-drizzle.md` |
| `nextjs-prisma`       | `prompts/codegen-nextjs-prisma.md` |
| `python-fastapi`      | `prompts/codegen-python-fastapi.md` |

## Workflow

Execute **4 phases in order**. Phase 3 is a hard stop — do not start Phase 4 until the user approves the design doc.

All design state lives in **`.backend-design/state/*.json`** — one file per category, written by Phase-1 agents and the Phase-2 Plan agent. These JSON files are the **single source of truth**. The human-readable `backend-design.md` is rendered from them; the codegen agent in Phase 4 reads them directly.

A validator at `<SKILL_DIR>/validate.mjs` checks the state for invariants (FK targets exist, every endpoint has a UI trigger, every entity has a PK, etc.). Run it after each synthesis step and fix errors before continuing. If the validator emits the same error class three runs in a row, stop and surface the unfixable issues to the user — do not loop indefinitely.

---

## Phase 0 — Resumption check

Run **before** the pre-flight check. Decides whether to start fresh or skip ahead based on what was last completed.

1. **Read `.backend-design/checkpoint.json`** with the `Read` tool. If missing → fresh run; proceed to Pre-flight.
2. **Run the decision script:**
   ```bash
   node <SKILL_DIR>/scripts/checkpoint.mjs decide
   ```
   It prints one line of JSON: `{"action": "...", "reason": "...", "next_phase": ...}`. The script computes the current frontend signature (git HEAD + dirty hash if the repo is git-managed, otherwise a content hash over the source tree) and compares it to `checkpoint.frontend_signature`.
3. **Branch on `action`:**

   | `action` | What to do |
   |---|---|
   | `fresh` | No prior state. Proceed to Pre-flight → Phase 1. |
   | `resume_phase_2` | Phase 1 inventory is on disk and frontend unchanged. Skip Phase 1; proceed to Phase 2. |
   | `resume_phase_2_5` | Phase 2 synthesis on disk. Skip Phases 1+2; render `backend-design.md` from existing state, then proceed to Phase 2.5. |
   | `resume_phase_3` | Design and next-steps docs exist. Skip everything except the Phase 3 review gate — print the summary and wait for approval. |
   | `resume_phase_4` | Design approved but scaffold not generated. Skip to Phase 4 directly. |
   | `gaps_only` | Scaffold complete, frontend unchanged. Run only Phase 2.5 (`detect-gaps.mjs`) to surface any newly closed/opened items. Report and stop — do not re-scaffold. |
   | `fresh_with_gaps_preserved` | Frontend changed since the last run. Re-run from Phase 1. **Preserve** `.backend-design/gaps.json` so closure detection still works on this run. |

4. **Tell the user one line of context** (echo the `reason` field): `Resuming at Phase 4 — design approved, scaffold not yet generated.` etc.

After each subsequent phase succeeds, **update the checkpoint** via `Read` + `Write` on `.backend-design/checkpoint.json` (merge fields; never overwrite the whole file blindly):

| Phase | Fields to add |
|---|---|
| 1 | `phase_1_at: <ISO-8601 now>`, `frontend_signature: <output of `node <SKILL_DIR>/scripts/checkpoint.mjs signature`>` |
| 2 | `phase_2_at: <now>` |
| 2.5 | `phase_2_5_at: <now>` |
| 3 (user approves) | `design_approved_at: <now>` |
| 4 (verification passes) | `phase_4_at: <now>` |

The signature is captured **once at end of Phase 1** — not re-captured on later phases, because we want to detect "did the frontend change between this run and the last one," not "did the frontend change since the most recent phase."

---

## Pre-flight check

Before Phase 1:

1. **Read `.backend-design/config.json`**. If missing, tell the user:
   > Run `npx backend-design start` first to detect your frontend and pick your stack. Then re-invoke this skill.
   Stop here.

2. **Confirm to the user** in one line: `Targeting <config.stack.label> with <config.auth.strategy> auth on <config.frontend.framework> → <config.output_dir>`.

3. **Load framework patterns.** Read `<SKILL_DIR>/prompts/frontend-patterns.md`. Extract the section whose heading matches `config.frontend.patterns_key`. You will inject this section into each Phase-1 agent's prompt so they search the right files. Keep it handy — call it `<<PATTERNS>>` in the agent briefs below.

   If `patterns_key` does not match any section in `frontend-patterns.md`, stop and tell the user: "Your detected framework `<framework>` is unrecognized. Edit `.backend-design/config.json` or use `prompts/frontend-patterns.md` patterns manually."

4. **Create the state directory:**
   ```bash
   mkdir -p .backend-design/state
   ```

---

### Phase 1 — Frontend inventory

Goal: catalog **every screen, every component, every interactive element, and every relationship between them** — enough that someone could rebuild the UI from the inventory alone. Be exhaustive, not selective. Partial coverage here corrupts every later phase.

Spawn **four `general-purpose` subagents in parallel** (single message, four tool calls). Each writes a single JSON file. `general-purpose` is the correct agent type here — `Explore` is read-only and cannot use `Write`, so it can't produce the output files this phase requires.

| Agent | Model | Output file |
|-------|-------|-------------|
| 1. Screens & navigation | `sonnet` | `.backend-design/state/screens.json` |
| 2. Component tree & shared state | `sonnet` | `.backend-design/state/components.json` |
| 3. Network calls & API contracts | `sonnet` | `.backend-design/state/endpoints.json` |
| 4. Forms, buttons, auth surface | `sonnet` | `.backend-design/state/forms.json` |

Pass the `model` parameter to the `Agent` tool when spawning each agent (e.g. `Agent({ subagent_type: "general-purpose", model: "sonnet", prompt: "..." })`). All four agents run on Sonnet — Haiku is not reliable enough for the inference required (template-literal URL resolution, validation rule extraction, existing-handler detection).

Each agent **writes exactly one JSON file**. Do not let them output markdown — only the JSON. If an agent writes markdown by mistake, re-spawn it with the schema reminder.

**Agent 1 — Screens & navigation** → writes `.backend-design/state/screens.json`

> Walk every screen in this frontend. A screen = anything the user can navigate to or that takes over the viewport: a route, a modal, a drawer, a wizard step, a tab panel that swaps content, an empty state, an error state, a loading state. Do not skip "obvious" screens (404, sign-in, settings sub-pages).
>
> Use these framework-specific search patterns:
>
> <<PATTERNS>>
>
> Apply the **Routes/screens** section. Cross-reference layout files. For mobile/desktop adaptations (responsive states), treat distinct visual breakpoints as separate screens only if they expose different functionality.
>
> Write a JSON array to `.backend-design/state/screens.json` where each element is:
>
> ```json
> {
>   "id": "post-detail",
>   "path": "/posts/[id]",
>   "trigger": null,
>   "file": "app/posts/[id]/page.tsx",
>   "entities_displayed": ["Post", "Comment", "User"],
>   "children": ["PostBody", "CommentList", "CommentForm"],
>   "data_fetches": [
>     {"method": "GET", "url": "/api/posts/[id]", "consumed_at": "app/posts/[id]/page.tsx:12"},
>     {"method": "GET", "url": "/api/posts/[id]/comments", "consumed_at": "app/posts/[id]/page.tsx:18"}
>   ],
>   "nav_out": [
>     {"to": "/users/[id]", "trigger_label": "author avatar"},
>     {"to": "/posts/[id]/edit", "trigger_label": "Edit"}
>   ],
>   "auth_required": false,
>   "evidence": ["app/posts/[id]/page.tsx:1"]
> }
> ```
>
> For non-URL screens (modals, wizard steps): set `path` to `null` and fill `trigger` with the file:line and label of what opens it. Always include `evidence`. Do not output any markdown — only write the JSON file. Be exhaustive.

**Agent 2 — Component tree & shared state** → writes `.backend-design/state/components.json`

> Map every component file in this frontend. Also catalog every shared-state container (Context/Provider, Zustand/Redux/Jotai/Recoil/MobX/Pinia/Vuex/NgRx stores) and every `localStorage`/`sessionStorage`/cookie key.
>
> Use these framework-specific search patterns:
>
> <<PATTERNS>>
>
> Apply the **Components** section to find component files. For shared state, search for the idioms appropriate to the framework (e.g. Pinia `defineStore` for Vue, services + DI for Angular, Svelte stores for SvelteKit).
>
> Write JSON to `.backend-design/state/components.json` with this shape:
>
> ```json
> {
>   "components": [
>     {
>       "name": "PostCard",
>       "file": "components/PostCard.tsx",
>       "props": [{"name": "post", "type": "Post", "required": true}],
>       "renders": ["Button", "Link", "Avatar"],
>       "hooks": ["useRouter", "useAuth"],
>       "reads": ["Post.title", "Post.body", "Post.author.name"],
>       "evidence": ["components/PostCard.tsx:1"]
>     }
>   ],
>   "shared_state": {
>     "contexts": [
>       {"file": "lib/AuthContext.tsx", "name": "AuthContext", "shape": {"user": "User | null"}, "consumers": ["app/layout.tsx:5", "components/Header.tsx:12"]}
>     ],
>     "stores": [
>       {"file": "lib/cart.ts", "library": "zustand", "shape": {"items": "CartItem[]", "total": "number"}, "mutators": ["addItem", "removeItem"]}
>     ],
>     "storage_keys": [
>       {"key": "auth_token", "type": "localStorage", "evidence": ["lib/api.ts:8"]}
>     ]
>   }
> }
> ```
>
> Infer props from usage if TS types are missing. Do not stop at depth 2 — go to leaf components. Do not output markdown — only the JSON file.

**Agent 3 — Network calls & API contracts** → writes `.backend-design/state/endpoints.json`

> Find every outbound HTTP call in this frontend. Capture URL, method, request body, response shape, trigger, and any existing server-side handler (so it's preserved, not duplicated).
>
> Use these framework-specific search patterns:
>
> <<PATTERNS>>
>
> Apply the **Network calls** section. Some frameworks bundle the network call into the route file (Remix loaders, SvelteKit +page.server.ts, Astro endpoints, Nuxt server routes) — treat those as existing handlers and capture them in `existing_handler`.
>
> Write a JSON array to `.backend-design/state/endpoints.json` where each element is:
>
> ```json
> {
>   "method": "POST",
>   "path": "/api/posts",
>   "request_body": {"title": "string", "body": "string"},
>   "query": {},
>   "response": "Post",
>   "triggered_by": ["components/NewPostForm.tsx:67"],
>   "consuming_component": "app/posts/page.tsx",
>   "auth_header": "Bearer token from localStorage auth_token",
>   "existing_handler": null,
>   "is_external": false,
>   "external_origin": null,
>   "evidence": ["lib/api.ts:34"]
> }
> ```
>
> Endpoints may also carry `required_role: string | string[] | null` (default null) — set in Phase 2, not here. Leave it absent in Phase 1.
>
> **List-fetch enrichment.** For every GET that returns an array (i.e. a list endpoint), inspect the consuming screen for pagination, filter, and sort UI and capture them:
>
> ```json
> {
>   "method": "GET",
>   "path": "/api/posts",
>   "response": "Post[]",
>   "pagination": {"strategy": "cursor", "limit_param": "limit", "cursor_param": "cursor"},
>   "filterable_fields": ["status", "author_id"],
>   "sortable_fields": ["created_at", "title"]
> }
> ```
>
> Strategies: `"cursor"` (infinite scroll, "load more" button, cursor in URL), `"offset"` (numbered page links, `?page=2`), or `null` (no pagination — small fixed list, no scroll trigger). Default `limit_param: "limit"`, `cursor_param: "cursor"` (cursor strategy) or `offset_param: "offset"` (offset strategy). Filterable fields: search inputs, dropdown filters, status tabs — capture the entity column name they correspond to. Sortable fields: sortable table headers, sort dropdowns.
>
> **Distinguish user-backend calls from third-party API calls.** If the URL is an absolute URL whose origin is not the app itself — e.g. `https://api.stripe.com/...`, `https://api.openai.com/...`, `https://maps.googleapis.com/...` — set `is_external: true`, `external_origin: "<host>"`, leave `path` as the full URL, and do NOT generate a backend handler for it. Relative URLs (`/api/...`) and same-origin URLs are `is_external: false`.
>
> **Detect incoming webhooks.** If you find an existing server-side handler under `app/api/webhook/`, `pages/api/webhook/`, `src/routes/api/webhook/`, `app/api/webhooks/`, or any handler that reads a header matching `*-Signature` (e.g. `Stripe-Signature`, `X-Hub-Signature-256`), add a corresponding entry with `is_webhook: true`, `webhook_source: "<inferred-source>"` (stripe, github, etc., from path or signature header), `signature_header: "<exact header name>"`, and `triggered_by: []` (webhooks are not triggered by the UI). Include these in `endpoints.json` so codegen scaffolds the signature verification.
>
> Resolve template literals and path params where possible. If a Next.js API route handler already exists, set `existing_handler` to its file path so it's not duplicated. Do not output markdown — only the JSON file.

**Agent 4 — Forms, buttons, auth surface** → writes `.backend-design/state/forms.json`

> Inventory every form, every input, every interactive button (including those inside modals and nested components). Flag every auth-related element: signup, login, logout, password reset, email verification, OAuth, magic link, MFA, account deletion, change password, change email.
>
> Use these framework-specific search patterns:
>
> <<PATTERNS>>
>
> Apply the **Forms** and **Auth hints** sections. Form syntax varies dramatically by framework — JSX `<form onSubmit>`, Vue `<form @submit>`, Svelte `<form on:submit>`, Angular `[formGroup]`, HTMX `<form hx-post>`, Astro `<form action="/api/...">`, etc. Find them all using the patterns above.
>
> Write JSON to `.backend-design/state/forms.json` with this shape:
>
> ```json
> {
>   "forms": [
>     {
>       "id": "NewPostForm",
>       "file": "components/NewPostForm.tsx:12",
>       "purpose": "Create a new post",
>       "multipart": false,
>       "inputs": [
>         {"name": "title", "type": "text", "validation": {"required": true, "minLength": 3, "maxLength": 200}},
>         {"name": "body", "type": "textarea", "validation": {"required": true}},
>         {"name": "cover_image", "type": "file", "accept": "image/*", "validation": {"required": false, "max_size_mb": 5}}
>       ],
>       "submits_to": "POST /api/posts",
>       "on_success": "redirect to /posts/[id]",
>       "evidence": ["components/NewPostForm.tsx:12"]
>     }
>   ],
>   "standalone_buttons": [
>     {
>       "file": "components/PostCard.tsx:42",
>       "label": "Delete",
>       "action": "api_call",
>       "destructive": true,
>       "target": "DELETE /api/posts/:id",
>       "evidence": ["components/PostCard.tsx:42"]
>     }
>   ],
>   "auth_surface": {
>     "signup": {"present": true, "file": "app/signup/page.tsx"},
>     "login": {"present": true, "file": "app/login/page.tsx"},
>     "logout": {"present": true, "trigger": "components/Header.tsx:23"},
>     "password_reset": {"present": false},
>     "email_verification": {"present": false},
>     "oauth_providers": []
>   }
> }
> ```
>
> Action values: `api_call`, `navigate`, `local_state`, `open_modal`. Set `destructive: true` for Delete/Remove/Cancel.
>
> **File inputs.** For every `<input type="file">` (or `accept` attr, or framework equivalent), set `type: "file"` and capture `accept` (MIME globs) and any size validation. If the form contains any file input, set `multipart: true` at the form level — the endpoint will need to accept `multipart/form-data`. If the form uses `FormData` in JS without an `<input type="file">`, still set `multipart: true` and note the field names.
>
> Do not output markdown — only the JSON file.

---

#### Phase 1b — Cross-file self-check

After all four agents return, run the validator:

```bash
node <SKILL_DIR>/validate.mjs
```

It will fail if any of the four files are missing or unparseable, and report Phase-1 cross-file issues (endpoints without UI triggers, components referenced by screens but missing from `components.json`, etc.). Fix gaps by re-spawning the relevant agent with a tighter brief — do not paper over gaps in the synthesis step. Apply the same three-iteration cap as Phase 2.

**Checkpoint write** (end of Phase 1): merge `{ phase_1_at: <ISO now>, frontend_signature: <run `node <SKILL_DIR>/scripts/checkpoint.mjs signature`> }` into `.backend-design/checkpoint.json`.

---

### Phase 2 — Design synthesis

Spawn **one `general-purpose` subagent** with `model: "sonnet"`. It reads the four JSON files from Phase 1, infers entities and relationships, and refines endpoints. (`Plan` is read-only and cannot write files; use `general-purpose`.)

Give it this brief:

> Read all four files in `.backend-design/state/` (`screens.json`, `components.json`, `endpoints.json`, `forms.json`). They are the authoritative inventory of the React/Next.js frontend.
>
> Produce **four output artifacts**:
>
> **1. `.backend-design/state/entities.json`** — a JSON array of Postgres entities inferred from the UI. Each entity:
>
> ```json
> {
>   "name": "Post",
>   "table": "posts",
>   "fields": [
>     {"name": "id", "type": "uuid", "pk": true, "default": "gen_random_uuid()"},
>     {"name": "title", "type": "text", "required": true},
>     {"name": "body", "type": "text", "required": true},
>     {"name": "user_id", "type": "uuid", "required": true, "fk": "users.id"},
>     {"name": "created_at", "type": "timestamptz", "default": "now()"},
>     {"name": "updated_at", "type": "timestamptz", "default": "now()"}
>   ],
>   "indexes": [{"columns": ["user_id"]}, {"columns": ["created_at"]}],
>   "evidence": ["components/NewPostForm.tsx:12", "app/posts/[id]/page.tsx:1"]
> }
> ```
>
> Infer entities from: forms (input fields → columns), list/detail screens, and the `entities_displayed` field on each screen. Always include a `users` entity if `forms.json -> auth_surface.signup.present` or `login.present` is true. Use `snake_case` for table/column names. Always include `id` (uuid pk), `created_at`, `updated_at`.
>
> **2. `.backend-design/state/relationships.json`** — a JSON array:
>
> ```json
> {
>   "from": "Post",
>   "to": "User",
>   "type": "many-to-one",
>   "fk": "Post.user_id",
>   "on_delete": "cascade",
>   "evidence": ["app/posts/[id]/page.tsx:45"]
> }
> ```
>
> Cardinalities: `one-to-one`, `one-to-many`, `many-to-one`, `many-to-many`. For many-to-many, include a `join_table` field. Evidence patterns:
> - List view of X showing "by Y" → X belongs to Y (many-to-one)
> - Detail page for X rendering a list of Y → X has many Y (one-to-many)
> - Form for X with `<select>` of Y → X has FK to Y
> - Multi-select / tag input → many-to-many
> - Nested URL `/x/[xId]/y/[yId]` → Y belongs to X
>
> **3. `.backend-design/state/auth.json`** — JSON object describing auth:
>
> ```json
> {
>   "strategy": "jwt",
>   "algorithm": "HS256",
>   "expiry": "7d",
>   "secret_env": "JWT_SECRET",
>   "password_hash": "bcrypt",
>   "bcrypt_cost": 12,
>   "signup": true,
>   "email_verification": false,
>   "password_reset": false,
>   "oauth_providers": [],
>   "rbac_roles": []
> }
> ```
>
> Set fields from `forms.json -> auth_surface`. Add `rbac_roles` if `screens.json` shows admin-only pages or role-gated UI.
>
> **4. Refine `.backend-design/state/endpoints.json`** — read the existing endpoints file, then **add** implied CRUD endpoints not yet listed:
> - List view of X → `GET /x` (returns array)
> - Detail view of X → `GET /x/:id`
> - "New X" form → `POST /x`
> - "Edit X" form → `PATCH /x/:id`
> - "Delete X" button → `DELETE /x/:id`
> - Signup form → `POST /auth/signup`
> - Login form → `POST /auth/login`
> - Logout button → `POST /auth/logout` (or stateless)
>
> **Multipart endpoints.** If a form in `forms.json` has `multipart: true`, the endpoint it submits to must have `content_type: "multipart/form-data"` and `request_body` should list each non-file field by name + type plus each file field as `{ "<name>": "file", "accept": "<mime>", "max_size_mb": N }`. Other endpoints default to `content_type: "application/json"` (omit when JSON).
>
> **Path-param scoping (nested resources).** For nested URLs like `/orgs/:orgId/posts`, set `path_params` on the endpoint:
>
> ```json
> {
>   "method": "GET",
>   "path": "/api/orgs/:orgId/posts",
>   "path_params": [{"name": "orgId", "type": "uuid", "scopes_query": true, "parent_entity": "Org"}],
>   "response": "Post[]"
> }
> ```
>
> `scopes_query: true` means the handler must filter the list/detail query by this param (e.g. `WHERE org_id = :orgId`) AND check the authenticated user has access to the parent entity. Apply this to every nested list, detail, create, update, and delete. The "child" FK column name is `<parent_table>_id` by convention. Leaf params on detail routes (e.g. `:id` at the end of `/api/orgs/:orgId/posts/:id`) get `scopes_query: false` — they identify the record, not scope the query.
>
> **Auth-flow endpoints (derive from `auth.json` flags):**
> - `password_reset: true` → `POST /auth/password-reset/request` (body: `{ email }`) + `POST /auth/password-reset/confirm` (body: `{ token, new_password }`)
> - `email_verification: true` → `POST /auth/verify-email` (body: `{ token }`) + `POST /auth/verify-email/resend` (auth required)
> - Each entry in `oauth_providers` → `GET /auth/oauth/<provider>/start` + `GET /auth/oauth/<provider>/callback`
>
> All of these should have `auth: "none"` (the request is unauthenticated; the token in the body is the authenticator). Set `triggered_by` to the auth-surface evidence from `forms.json` (e.g. the "Forgot password" link's file:line).
>
> For each added endpoint, set `triggered_by` to the UI element file:line that justifies it. Add an `auth` field (`required` or `none`) to every endpoint.
>
> **RBAC.** If `auth.rbac_roles` is non-empty, derive `required_role` per endpoint:
> - If the endpoint is triggered exclusively from a screen that's clearly admin-only (e.g. path under `/admin/`, "Admin" in the screen id/label, an admin role gate visible in the component tree), set `required_role: "admin"` (use the matching role from `auth.rbac_roles`).
> - For endpoints triggered from a screen with a per-role gate, set `required_role` to the gating role.
> - For endpoints with no clear role gate, leave `required_role: null`. Don't speculate.
> - Every `required_role` value must already exist in `auth.rbac_roles` — if you'd write a role that isn't there, surface it as an Open Question instead.
>
> **Do not invent features the UI does not imply.** Do not add admin endpoints unless an admin page exists in `screens.json`. Be skeptical of speculative endpoints.
>
> **Placeholder endpoints (vibe-coder mode only).** If `config.json -> vibe_coder === true`, scan `forms.standalone_buttons[]` for entries with `action: "api_call"` whose target either is missing or doesn't appear in `endpoints.json`. For each such button, add a **placeholder endpoint** to `endpoints.json` with:
>
> ```json
> {
>   "method": "POST",
>   "path": "/api/<best-guess-from-label>",
>   "request_body": {},
>   "response": null,
>   "triggered_by": ["<button file:line>"],
>   "auth": "required",
>   "temporary": true,
>   "placeholder_reason": "Scaffolded for orphan button '<label>' at <button file:line>. Path is a best-guess; user must replace or wire up the real endpoint.",
>   "evidence": ["<button file:line>"]
> }
> ```
>
> Infer method from the button label: "Delete/Remove/Cancel" → `DELETE`; "Edit/Update/Save" → `PATCH`; everything else → `POST`. Infer auth: if any screen containing the button has `auth_required: true`, set `auth: "required"`; otherwise `auth: "none"`. Infer path from a slugified version of the label scoped under the screen's URL when possible (e.g. button "Become a host" → `/api/hosts/apply`). When in doubt, prefix with `/api/` and slugify the label. **Set `temporary: true` and `placeholder_reason` on every such endpoint** — these fields signal codegen to scaffold a 501 stub rather than a real handler. Do not invent request body fields; leave `request_body: {}`. Do not infer indices or relations from a placeholder. If `vibe_coder` is false or unset, **never** generate placeholder endpoints — flag orphan buttons as gaps in Phase 2.5 instead.
>
> **Skip external endpoints.** Endpoints with `is_external: true` are calls to third-party services (Stripe, OpenAI, etc.). Do not refine them, do not derive implied CRUD around them, and do not assign them an `auth` field. Carry them through unchanged so the design doc can list them under "External integrations".
>
> Write all four artifacts. Do not produce markdown — only JSON.

After the synthesis agent finishes, **run the validator**:

```bash
node <SKILL_DIR>/validate.mjs
```

If it exits non-zero, read the errors, fix them by editing the JSON files directly (use `Edit`), and re-run. **Do not proceed to the markdown render or Phase 3 until validation passes.** Warnings are OK to leave but should be acknowledged in Open Questions. Cap fixup attempts at **three iterations**; if the same error class persists after three passes, stop and surface the unfixable issues to the user.

If the synthesis produced **zero entities** (e.g. a marketing-only frontend with no forms or data), do not proceed to codegen. Tell the user: "No backend obligations detected — the UI doesn't imply any persistent state or API calls. Nothing to scaffold." Stop.

Once validation passes, render `backend-design.md` at repo root from the JSON. You (the orchestrator) do this with `Read` + `Write` — no agent needed. Structure:

1. **Overview** — one paragraph inferred from the UI.
2. **Entity map** — markdown list of entities and relationships with cardinalities.
3. **Data model** — one section per entity from `entities.json`, with column tables.
4. **API endpoints** — one row per endpoint from `endpoints.json` (`Method | Path | Auth | Body | Response | Triggered by`).
5. **Auth model** — rendered from `auth.json`.
6. **External integrations** — list of endpoints with `is_external: true`, grouped by `external_origin`. These are NOT in the generated backend; they document third-party services the frontend depends on.
7. **Coverage check** — table mapping every screen + every interactive element to the backend artifact that supports it. Flag unmapped UI as Open Questions.
8. **Open questions** — product-intent ambiguities only (e.g. "should followers be private by default?", "should the cart merge with server cart on login?"). **Environmental gaps (missing env vars, accounts) and wire-up gaps (orphan buttons, missing auth UI) belong in `backend-design-next-steps.md` — they're generated in Phase 2.5 below, not here.**

**Checkpoint write** (end of Phase 2): merge `{ phase_2_at: <ISO now> }` into `.backend-design/checkpoint.json`.

---

### Phase 2.5 — Gap detection & next-steps render

After `backend-design.md` is rendered and before the review gate, run the deterministic gap detector:

```bash
node <SKILL_DIR>/scripts/detect-gaps.mjs
```

It reads the state JSON, `config.json`, `./.env`, and `./package.json`; writes `.backend-design/gaps.json` and `./backend-design-next-steps.md`. No agent needed — it's a plain script, same shape as `validate.mjs`.

What it catches:

- **`missing_env_var`** — env vars required by the chosen stack/auth that aren't in `.env` (e.g. `DATABASE_URL` for Postgres stacks, `JWT_SECRET` when auth is JWT, `STRIPE_WEBHOOK_SECRET` for Stripe webhooks, `<PROVIDER>_CLIENT_ID` / `_SECRET` per OAuth provider).
- **`missing_auth_ui`** — `auth.json` has signup/login but `forms.auth_surface` shows the frontend has no signup/login form. Also: screens marked `auth_required: true` while no auth surface exists.
- **`unwired_button`** — `forms.standalone_buttons[]` entries with `action: "api_call"` whose target doesn't match any endpoint. The script does not invent a path — it surfaces the button as a decision the user must make.
- **`external_account_unconfirmed`** — Supabase / Stripe / OpenAI references detected via `package.json` deps or `is_external` endpoint origins. Informational only.

The script re-detects from scratch every run and diffs against the persisted `gaps.json` using `(type, evidence_file, specifier)` as the natural key. Gaps the user has closed since the last run show up under "Recently closed" in the next-steps doc.

After it finishes, surface a one-line summary to the user: `<N> blocker(s) · <M> wire-up(s) · <K> info item(s)`.

**Checkpoint write** (end of Phase 2.5): merge `{ phase_2_5_at: <ISO now> }` into `.backend-design/checkpoint.json`.

---

### Phase 3 — Review gate (do not skip)

After Phase 2.5 completes:

1. Print a short summary to the user: entity count, table count, endpoint count, whether auth is included, count of UI elements covered vs. flagged in the coverage check, count of open questions, and `<N> blocker(s) · <M> wire-up(s) · <K> info item(s)` from `gaps.json`.
2. Tell the user: "Review `./backend-design.md` (the design itself) AND `./backend-design-next-steps.md` (what you need to do before this runs). Let me know to proceed, or describe any changes."
3. **Stop.** Do not call any more tools. Wait for the user's next message.

If the user asks for design edits, make them directly to `backend-design.md` (use the `Edit` tool — do not spawn an agent for small edits). If the user asks for a substantial redesign, re-spawn the Phase 2 Plan agent with the revised requirements. **Do not hand-edit `backend-design-next-steps.md`** — it's regenerated by `detect-gaps.mjs`. If the user closes a gap (e.g. sets an env var, adds an auth form), re-run `node <SKILL_DIR>/scripts/detect-gaps.mjs` instead.

Only proceed to Phase 4 when the user gives explicit approval ("looks good", "proceed", "ship it", "go", etc.). Blockers in `gaps.json` are not hard gates for Phase 4 (codegen can still run with a missing `DATABASE_URL`), but warn the user that the scaffold won't boot until they're resolved.

**Checkpoint write** (on user approval): merge `{ design_approved_at: <ISO now> }` into `.backend-design/checkpoint.json` before starting Phase 4.

---

### Phase 4 — Code scaffolding

The codegen prompt is **stack-specific**. Read `.backend-design/config.json` to get `stack.id`, then read the matching prompt file from `<SKILL_DIR>/prompts/`:

| `stack.id`            | Prompt file to read |
|-----------------------|---------------------|
| `node-express-prisma` | `<SKILL_DIR>/prompts/codegen-node-express-prisma.md` |
| `node-fastify-prisma` | `<SKILL_DIR>/prompts/codegen-node-fastify-prisma.md` |
| `node-hono-drizzle`   | `<SKILL_DIR>/prompts/codegen-node-hono-drizzle.md` |
| `nextjs-prisma`       | `<SKILL_DIR>/prompts/codegen-nextjs-prisma.md` |
| `python-fastapi`      | `<SKILL_DIR>/prompts/codegen-python-fastapi.md` |

Use `Read` to load the relevant prompt file. **If any endpoint in `endpoints.json` has `temporary: true`**, also `Read` `<SKILL_DIR>/prompts/codegen-placeholders.md` and concatenate it ahead of the stack-specific prompt. Spawn **one `general-purpose` subagent** with `model: "sonnet"` and pass the assembled prompt:

> The authoritative spec is in `.backend-design/state/*.json`. The user has chosen stack `<config.stack.id>` (<config.stack.label>) with auth strategy `<config.auth.strategy>` and output directory `<config.output_dir>`.
>
> Use this brief:
>
> <pasted contents of codegen-placeholders.md, only if any endpoint has temporary: true>
>
> <pasted contents of the codegen-*.md file>

After the agent finishes, run the **stack-specific verification commands** listed at the bottom of the codegen prompt file. For Node stacks: `<PM> install`, ORM-specific generate command, `<PM> tsc --noEmit`. For Python: `pip install -e .` (or `uv pip install -e .`), `alembic check`, import smoke test.

**Startup smoke test (Node stacks).** After the static checks pass, run a startup smoke test to catch errors that `tsc` doesn't see (missing env vars, plugin order, runtime imports):

```bash
cd <output_dir>
JWT_SECRET=test DATABASE_URL=postgresql://postgres:postgres@localhost:5432/none \
  timeout 8 <PM> dev 2>&1 | tee /tmp/bd-smoke.log &
SMOKE_PID=$!
sleep 6
kill $SMOKE_PID 2>/dev/null || true
grep -Eqi "listen(ing)?|started server|ready" /tmp/bd-smoke.log || {
  echo "Startup smoke test failed — server did not announce 'listening' within 6s."
  cat /tmp/bd-smoke.log
  exit 1
}
```

The DB host is intentionally unreachable; Prisma/Drizzle connect lazily on the first request, so startup should still announce "listening". If your stack instead opens a connection at boot, swap in a real local Postgres or skip this step and document why.

**Startup smoke test (Python/FastAPI).** Run `python -c "from app.main import app"` (already in the verification list). This catches model/router import errors at the import level, which is the most common failure mode.

If a verification step fails, classify before fixing:
- **Local mistakes** (typo, missing import, wrong type) — fix directly with `Edit`. Budget ≤5 such edits.
- **Structural issues** (missing files, route/schema mismatch, multiple TypeScript errors across files) — re-spawn the codegen agent with a focused follow-up brief that quotes the failing output. Budget at most one re-spawn.
- If both budgets are exhausted, stop and report the remaining failures to the user rather than declaring success.

Do not declare the task complete until verification passes.

**Checkpoint write** (end of Phase 4): merge `{ phase_4_at: <ISO now> }` into `.backend-design/checkpoint.json`.

Then report to the user: stack used, output directory, entity count, endpoint count, and the next-step command from the codegen prompt's "README run commands" section.

---

## Rules

- **Do not skip Phase 3.** The user must see and approve the design doc before any backend code is written. This is the whole point of the skill.
- **Frontend is the source of truth.** Never add endpoints, tables, or fields the UI doesn't imply. If you think the UI is missing something obvious (e.g., login form but no signup form), surface it in the "Open questions" section instead of silently adding it.
- **Respect the chosen stack.** `.backend-design/config.json` records the user's choice. Do not deviate — if they picked `python-fastapi`, do not generate TypeScript. If `config.json` is missing, tell them to run `npx backend-design start` first.
- **Don't touch the frontend** unless `stack.framework === "nextjs"`. For the Next.js stack, you may add files under `app/api/`, `lib/`, and `prisma/` in the existing project. For all other stacks, write only to `config.output_dir` (default `./backend`), `./backend-design.md`, and `./.backend-design/`.
- **State JSON is the source of truth.** Codegen reads from `.backend-design/state/*.json`, not from `backend-design.md`. If the user edits the markdown during review, you must mirror their edits into the JSON files (or have them edit JSON directly) before proceeding to Phase 4.
- **Run the validator at every synthesis step.** After Phase 1 (4 inventory files) and after Phase 2 (entities/relationships/auth). Never proceed past errors.
- **One review gate, not many.** Don't pepper the user with `AskUserQuestion` calls during Phase 1 or 2 unless something is genuinely ambiguous about their *intent* for the skill (not about the UI — that goes in Open Questions in the design doc).
