---
name: backend-design
description: Design and scaffold a backend for an existing frontend. Activate on "/backend-design", "build a backend for this frontend", "generate the API and database for this app", "design a backend from the UI", or similar intent. The user sees two checkpoints — a reviewable design doc (endpoints, DB schema, auth), then scaffolded code after they approve.
---

# backend-design

You are about to design and scaffold a backend for an **existing frontend** in the current working directory. Supported frontends (auto-detected by the CLI): Next.js (App or Pages Router), React SPA, Vue, Nuxt, Svelte, SvelteKit, Angular 17+, Astro, SolidJS / SolidStart, Qwik, Remix / React Router v7, Gatsby, HTMX, vanilla HTML/JS. The frontend is the source of truth: every button, form, fetch call, and route in the UI implies a backend obligation. Your job is to extract those obligations, get the user's approval on the shape of the backend, and then build it in the stack they chose.

**Skill root:** locate this skill's directory once at the start. It's the directory containing this `SKILL.md`. Refer to it as `<SKILL_DIR>` below — typical values are `<project>/.claude/skills/backend-design` (project-local install — the default for `npx backend-design start`), `~/.claude/skills/backend-design` (global install via `backend-design install`), or `~/.claude/plugins/.../skills/backend-design` (plugin install). Resolve all `<SKILL_DIR>/...` references against the actual location, not the literal string.

The stack is **not fixed** — it's selected by the user via `npx backend-design start` before activating this skill, and recorded in `.backend-design/config.json`. Supported stacks:

| `stack.id` | Codegen prompt |
|------------|----------------|
| `node-express-prisma` | `prompts/codegen-node-express-prisma.md` |
| `node-fastify-prisma` | `prompts/codegen-node-fastify-prisma.md` |
| `node-hono-drizzle`   | `prompts/codegen-node-hono-drizzle.md` |
| `nextjs-prisma`       | `prompts/codegen-nextjs-prisma.md` |
| `python-fastapi`      | `prompts/codegen-python-fastapi.md` |
| `s2ai-schema`         | _(no prompt — Phase 4 runs `scripts/render-s2ai-schema.mjs` to emit `./schema.mmd` only)_ |

## Workflow

Execute the phases in order: Pre-flight → Phase 1 (inventory) → Phase 2 (synthesis) → Phase 2.5 (gap detection) → Phase 2.6 (skeptic pass) → Phase 3 (review gate) → Phase 4 (codegen). Phase 3 is a hard stop — do not start Phase 4 until the user approves the design doc.

All design state lives in **`.backend-design/state/*.json`** — one file per category, written by Phase-1 agents and the Phase-2 synthesis agent. These JSON files are the **single source of truth**. The human-readable `backend-design.md` is rendered from them by `scripts/render-design.mjs`; the codegen agent in Phase 4 reads them directly.

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
   | `resume_phase_2_5` | Phase 2 synthesis on disk. Skip Phases 1+2; run `node <SKILL_DIR>/scripts/render-design.mjs` to regenerate `backend-design.md` from existing state, then proceed to Phase 2.5. Never hand-render — the script is the source of truth. |
   | `resume_phase_2_6` | Phase 2.5 gap detection on disk but skeptic pass not yet run. Skip Phases 1+2+2.5; proceed directly to Phase 2.6 (skeptic pass), then re-render the design doc, then Phase 3. |
   | `resume_phase_3` | Design, next-steps doc, and skeptic findings exist. Skip everything except the Phase 3 review gate — print the summary and wait for approval. |
   | `resume_phase_4` | Design approved but scaffold not generated. Skip to Phase 4 directly. |
   | `gaps_only` | Scaffold complete, frontend unchanged. Run `node <SKILL_DIR>/scripts/detect-gaps.mjs`, then `node <SKILL_DIR>/scripts/render-env-example.mjs`, then `node <SKILL_DIR>/scripts/render-openapi.mjs` to refresh `./backend-design-next-steps.md`, `./backend-design.env.example`, and `./openapi.json`. Report and stop — do not re-scaffold or re-render the design doc. |
   | `fresh_with_gaps_preserved` | Frontend changed since the last run. Re-run from Phase 1. **Preserve** `.backend-design/gaps.json` so closure detection still works on this run. |

4. **Tell the user one line of context** (echo the `reason` field): `Resuming at Phase 4 — design approved, scaffold not yet generated.` etc. For `gaps_only`, say something like `Scaffold already generated and frontend unchanged — refreshing ./backend-design-next-steps.md and ./backend-design.env.example only.` so it's clear no design or codegen work is being repeated.

After each subsequent phase succeeds, **update the checkpoint** via `Read` + `Write` on `.backend-design/checkpoint.json` (merge fields; never overwrite the whole file blindly):

| Phase | Fields to add |
|---|---|
| 1 | `phase_1_at: <ISO-8601 now>`, `frontend_signature: <output of `node <SKILL_DIR>/scripts/checkpoint.mjs signature`>` |
| 2 | `phase_2_at: <now>` |
| 2.5 | `phase_2_5_at: <now>` |
| 2.6 | `phase_2_6_at: <now>` |
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

3. **Resolve framework patterns file.** The patterns live at `<SKILL_DIR>/prompts/patterns/<patterns_key>.md` — one small file per framework, drop-in for the `<<PATTERNS>>` slot. **Do not read it yourself.** The Phase 1 subagents will each `Read` it directly; the orchestrator only needs the path. Call this path `<<PATTERNS_FILE>>` below.

   If `<SKILL_DIR>/prompts/patterns/<patterns_key>.md` does not exist, stop and tell the user: "Your detected framework `<framework>` is unrecognized. Edit `.backend-design/config.json` to set `frontend.patterns_key` to one of the files in `prompts/patterns/`."

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

The four agents and their brief files:

| Agent | Brief file | Output file |
|---|---|---|
| 1. Screens & navigation | `<SKILL_DIR>/prompts/inventory/screens.md` | `.backend-design/state/screens.json` |
| 2. Component tree & shared state | `<SKILL_DIR>/prompts/inventory/components.md` | `.backend-design/state/components.json` |
| 3. Network calls & API contracts | `<SKILL_DIR>/prompts/inventory/endpoints.md` | `.backend-design/state/endpoints.json` |
| 4. Forms, buttons, auth surface | `<SKILL_DIR>/prompts/inventory/forms.md` | `.backend-design/state/forms.json` |

The orchestrator does NOT need to read these brief files. Spawn each subagent with the prompt template below — substituting the brief file path and output file path — and let the subagent `Read` both its brief and the patterns file directly. This keeps the orchestrator's context lean.

**Prompt template** (use verbatim, four times, varying only `<BRIEF>` and `<OUTPUT>`):

> Read `<<PATTERNS_FILE>>` first — it has the framework-specific search patterns you'll need.
> Then read `<BRIEF>` for your inventory instructions and JSON schema.
> Then walk the frontend and write your output to `<OUTPUT>`. Do not output markdown — only the JSON file.

**Cache-friendly prompt ordering** (do not skip): the prompt template above puts the **stable, shared** `<<PATTERNS_FILE>>` read instruction first, then the per-agent brief, then dynamic config. This ordering lets Anthropic's prompt cache reuse the shared prefix across all four parallel subagents — repeated runs cost a fraction of the first. Preserve this order when editing.

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
> Produce **five output artifacts**:
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
> Infer entities from: forms (input fields → columns), list/detail screens, and the `entities_displayed` field on each screen. Use `snake_case` for table/column names.
>
> **Always include a `users` entity if auth is implied.** Auth is implied when ANY of the following hold (the strongest signal wins, in this priority order):
>
> 1. `forms.json -> auth_surface.signup.present === true` → `inferred_from: "signup_form"`
> 2. `forms.json -> auth_surface.login.present === true` → `inferred_from: "login_form"`
> 3. Any screen in `screens.json` has `auth_required: true` → `inferred_from: "auth_required_screen"`
> 4. Any `components.json -> shared_state.storage_keys[].key` matches `/token|jwt|auth|session/i` → `inferred_from: "token_storage_key"`
> 5. Any endpoint in `endpoints.json` has a non-null `auth_header` → `inferred_from: "auth_header"`
> 6. Any `screens[].data_fetches[].url` targets `/api/auth/*` → `inferred_from: "auth_path"`
>
> When auth is implied without a UI form (signals 3–6), still emit the `users` entity, set `auth.json -> signup: true` and `auth.json -> inferred_from: "<signal-name>"`, and emit `POST /auth/signup` / `POST /auth/login` / `POST /auth/logout`. Set `triggered_by` on each auth endpoint to the file:line of the winning signal so the existing "every endpoint has a UI trigger" invariant in `validate.mjs` is satisfied. `detect-gaps.mjs` will still raise `missing_auth_ui` as a blocker — that's correct; the user needs the UI even though the backend is built.
>
> **Best-practice columns on every entity** (in addition to `id`, `created_at`, `updated_at`):
>
> - `{"name": "deleted_at", "type": "timestamptz", "required": false, "default": null}` — soft delete. List/detail queries will filter `WHERE deleted_at IS NULL`; `DELETE` sets this column instead of removing the row.
> - `{"name": "version", "type": "integer", "required": true, "default": "1"}` — optimistic lock. PATCH handlers increment by 1; if an `If-Match` header is present they compare first and 409 on mismatch.
> - If (and only if) a `users` entity exists AND the entity in question is not the `users` entity itself: `{"name": "created_by", "type": "uuid", "required": false, "fk": "users.id"}` and `{"name": "updated_by", "type": "uuid", "required": false, "fk": "users.id"}`. Self-referential audit FKs on `users` create chicken-and-egg insert problems — skip them there.
>
> Webhook event logs, append-only audit tables, and any entity the agent reasonably judges has no concept of an actor or soft-delete may omit `deleted_at`/`version`/`created_by`/`updated_by`. When in doubt, include them — `validate.mjs` warns if they're missing but does not error.
>
> **Session entity (cookie sessions only).** When `config.auth.strategy === "session"` AND `config.auth.store === "postgres"`, emit a `Session` entity alongside `users`:
>
> ```json
> {
>   "name": "Session",
>   "table": "sessions",
>   "fields": [
>     {"name": "id", "type": "text", "pk": true},
>     {"name": "user_id", "type": "uuid", "fk": "users.id"},
>     {"name": "expires_at", "type": "timestamptz", "required": true},
>     {"name": "data", "type": "jsonb"},
>     {"name": "created_at", "type": "timestamptz", "default": "now()"}
>   ],
>   "indexes": [{"columns": ["user_id"]}, {"columns": ["expires_at"]}],
>   "evidence": ["config.auth.strategy === 'session' && store === 'postgres'"]
> }
> ```
>
> Do **NOT** add the best-practice columns (`deleted_at`, `version`, `created_by`, `updated_by`) to `Session` — session rows are server-managed, ephemeral, deleted hard on logout/expiry, and have no concept of an "actor" beyond the user the FK already names. The validator's exception list covers this. When `store === "redis"` do not emit `Session` (the validator will error if you do).
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
> **3. `.backend-design/state/auth.json`** — JSON object describing auth. **JWT shape:**
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
> **Cookie session shape** (when `config.auth.strategy === "session"` — pre-set by the CLI in `config.json`, never inferred from the UI):
>
> ```json
> {
>   "strategy": "session",
>   "store": "postgres",
>   "cookie": { "name": "sid", "httpOnly": true, "secure": true, "sameSite": "lax", "maxAgeDays": 7 },
>   "csrf": { "enabled": true, "header_name": "X-CSRF-Token" },
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
> Copy `store`, `cookie`, and `csrf` shapes verbatim from the above when the strategy is session. The `cookie.secure` flag is interpreted "true in production" by codegen (`process.env.NODE_ENV === "production"`); leave the literal `true` in `auth.json`. When `strategy === "session"`, `POST /auth/logout` is **meaningful** — it destroys the server-side session row (Postgres) or key (Redis) — not the JWT-strategy no-op. Add a `triggered_by` evidence pointer to the logout button (or, if the UI doesn't have one yet, the screen whose presence implies authenticated sessions) so the validator's "every endpoint has a UI trigger" invariant holds.
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
> Infer method from the button label: "Delete/Remove" → `DELETE`; "Edit/Update/Save" → `PATCH`; everything else → `POST`. Treat "Cancel" as `POST` only if the button is clearly destructive (e.g. "Cancel subscription"); ambiguous labels like "Cancel" inside a modal typically just close the dialog and should not become endpoints. **Always set `auth: "none"` on placeholders**, even when the origin screen is auth-gated — codegen strips auth middleware from placeholder routes anyway ([codegen-placeholders.md](prompts/codegen-placeholders.md)), so setting `required` would mislead readers of `backend-design.md`. The user re-adds auth when they replace the stub. Infer path from a slugified version of the label scoped under the screen's URL when possible (e.g. button "Become a host" → `/api/hosts/apply`). When in doubt, prefix with `/api/` and slugify the label. **Set `temporary: true` and `placeholder_reason` on every such endpoint** — these fields signal codegen to scaffold a 501 stub rather than a real handler. Do not invent request body fields; leave `request_body: {}`. Do not infer indices or relations from a placeholder. If `vibe_coder` is false or unset, **never** generate placeholder endpoints — flag orphan buttons as gaps in Phase 2.5 instead.
>
> **Skip external endpoints.** Endpoints with `is_external: true` are calls to third-party services (Stripe, OpenAI, etc.). Do not refine them, do not derive implied CRUD around them, and do not assign them an `auth` field. Carry them through unchanged so the design doc can list them under "External integrations".
>
> **Domain pattern pass.** Before writing `open_questions.json`, scan `screen.id`, `screen.path`, `component.name`, and `endpoint.path` (all lowercased, joined into one corpus) for these keyword classes. A class triggers only when **≥2 distinct tokens** match — single-token matches generate too many false positives.
>
> | Class | Tokens (substring match) | Recommended entities |
> |---|---|---|
> | `ecommerce` | `cart`, `checkout`, `product`, `price`, `sku`, `order`, `basket` | `OrderLineItem`, `Inventory`, `Address`, `Payment` |
> | `chat` | `message`, `conversation`, `thread`, `chat`, `inbox`, `dm` | `Conversation`, `Message`, `Participant` |
> | `social` | `post`, `comment`, `like`, `follow`, `feed`, `friend`, `react`, `reaction` | `Like`, `Follow`, `Notification` |
> | `booking` | `reserve`, `listing`, `book`, `availability`, `slot`, `check_in`, `check_out`, `guest`, `stay` | `Booking`, `Availability` |
> | `cms` | `article`, `blog`, `tag`, `category`, `draft`, `publish`, `revision` | `Tag`, `ArticleTag` (join), `Revision` |
>
> For each triggered class, write **one** entry in `open_questions.json` with `id: "domain-<class>-entities"`, evidence file:lines from the matching screens/components, and an opinionated recommendation tied to v1 cadence. **Do not** add these entities to `entities.json` — the user accepts or rejects in Phase 3. Example:
>
> ```json
> {
>   "id": "domain-ecommerce-entities",
>   "title": "E-commerce signals detected — scaffold deeper entities?",
>   "question": "Cart + checkout + price tokens are present in the UI. Should the backend include OrderLineItem, Inventory, Address, and Payment entities now, or wait until each is wired to real UI?",
>   "context": "Tokens matched: cart (components/CartDrawer.tsx:14), checkout (app/checkout/page.tsx:1), price (components/PriceTag.tsx:8). Only an Order entity was inferred from the visible checkout form.",
>   "recommendation": "Scaffold OrderLineItem and Address for v1 — they're load-bearing for any real order. Defer Inventory and Payment until a payment provider is picked (each has heavy provider coupling).",
>   "evidence": ["components/CartDrawer.tsx:14", "app/checkout/page.tsx:1", "components/PriceTag.tsx:8"]
> }
> ```
>
> **5. `.backend-design/state/open_questions.json`** — a JSON array of **product-intent ambiguities** that the design surfaces but cannot resolve from the UI alone. These are the questions where the codebase doesn't have a single right answer and the human has to choose. **Each question must include a recommendation** — your honest best-practice opinion given what you observed in the frontend — so the user has a default to accept rather than a question they have to answer cold. Schema:
>
> ```json
> [
>   {
>     "id": "reserve-button-behavior",
>     "title": "Reserve button behavior",
>     "question": "Today the Reserve button only fires alert('Reserved!'). Do you want this backend to scaffold a bookings table and POST /api/bookings now, or stay read-only until the booking UI exists?",
>     "context": "The form's date/guests inputs imply a minimal booking { listing_id, check_in, check_out, guests, user_id } shape — but user_id requires auth, which the UI also lacks.",
>     "recommendation": "Stay read-only for v1. Scaffolding bookings before the booking UI + auth exist tends to go stale fast. Add bookings in a follow-up once the user actually navigates the reservation flow.",
>     "evidence": ["components/Reserve.tsx:34"]
>   }
> ]
> ```
>
> Surface 3–8 questions for a typical app. Look for: (a) buttons/forms that fire alerts/console.logs (stub UI hinting at unbuilt features), (b) missing admin/CRUD UI that the data model implies, (c) search/filter UI that's wired to nothing, (d) static display strings that look like they should be derived from a real backend (e.g. `distance`, `dates`), (e) auth gaps the design depends on but the UI doesn't reflect. **Do NOT include**: env vars, missing accounts, or orphan wire-ups — those live in `backend-design-next-steps.md`. Recommendations should be opinionated and time-aware ("for v1", "until X exists"). If no real product-intent ambiguities exist, write an empty array `[]` — don't pad.
>
> Write all five artifacts. Do not produce markdown — only JSON.

After the synthesis agent finishes, **run the validator**:

```bash
node <SKILL_DIR>/validate.mjs
```

If it exits non-zero, read the errors, fix them by editing the JSON files directly (use `Edit`), and re-run. **Do not proceed to the markdown render or Phase 3 until validation passes.** Warnings are OK to leave but should be acknowledged in Open Questions. Cap fixup attempts at **three iterations**; if the same error class persists after three passes, stop and surface the unfixable issues to the user.

If the synthesis produced **zero entities** (e.g. a marketing-only frontend with no forms or data), do not proceed to codegen. Tell the user: "No backend obligations detected — the UI doesn't imply any persistent state or API calls. Nothing to scaffold." Stop.

Once validation passes, render `backend-design.md` at repo root **deterministically** via the script:

```bash
node <SKILL_DIR>/scripts/render-design.mjs
```

The script reads the state JSON and writes the markdown. Do not hand-render this file — runs become non-deterministic and diffs become noisy. The script emits these 8 sections:

1. **Overview** — one paragraph inferred from the UI.
2. **Entity map** — markdown list of entities and relationships with cardinalities.
3. **Data model** — one section per entity from `entities.json`, with column tables.
4. **API endpoints** — one row per endpoint from `endpoints.json` (`Method | Path | Auth | Body | Response | Triggered by`), with placeholders called out separately.
5. **Auth model** — rendered from `auth.json`.
6. **External integrations** — endpoints with `is_external: true`, grouped by `external_origin`. NOT scaffolded; documentation only.
7. **Coverage check** — every screen × data fetch, plus unwired buttons.
8. **Open questions** — product-intent ambiguities only (e.g. "should new accounts be email-verified?"). Environmental gaps (env vars) and wire-up gaps (orphan buttons) belong in `backend-design-next-steps.md` — generated in Phase 2.5.

If the user asks for design edits in Phase 3, edit the underlying state JSON (with `Edit`) and re-run `render-design.mjs`. Do not hand-edit `backend-design.md` — your edits will be overwritten next time the script runs.

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

**Then render the env template** so the user has a copy-pasteable `.env` to fill in:

```bash
node <SKILL_DIR>/scripts/render-env-example.mjs
```

This writes `./backend-design.env.example` at the repo root with every env var the design requires (DATABASE_URL, JWT_SECRET, webhook secrets per source, OAuth `<PROVIDER>_CLIENT_ID/SECRET`, email provider options, UPLOADS_DIR, NODE_ENV/PORT). Each var has a one-line comment explaining what it's for and where to get the value. The user can `cp backend-design.env.example .env` and fill in the blanks.

**Exception:** for the `s2ai-schema` stack, `render-env-example.mjs` returns without writing — there is no server to configure, so don't surface a "wrote env template" message. `detect-gaps.mjs` also skips its `missing_env_var` checks for this stack; the remaining `unwired_button`, `missing_auth_ui`, and `external_account_unconfirmed` gaps still apply and are still surfaced in `backend-design-next-steps.md`.

**Then render the OpenAPI spec** so consumers can preview the API contract without booting the backend:

```bash
node <SKILL_DIR>/scripts/render-openapi.mjs
```

This writes `./openapi.json` at the repo root — OpenAPI 3.1 with one operation per endpoint, a top-level `webhooks` block for incoming webhooks, and `components.schemas` per entity. The Phase 4 codegen prompts copy this file into the scaffolded backend so the Swagger UI at `/docs` serves the same contract design-time reviewers see. Placeholder endpoints (`temporary: true`) and external endpoints (`is_external: true`) are skipped — the spec describes the real contract, not stubs. The `s2ai-schema` stack also skips this step (no server, no API to document).

**Checkpoint write** (end of Phase 2.5): merge `{ phase_2_5_at: <ISO now> }` into `.backend-design/checkpoint.json`.

---

### Phase 2.6 — Skeptic pass

Spawn **one `general-purpose` subagent** with `model: "sonnet"`. This agent re-reads the synthesized design from an adversarial stance and surfaces concrete-pattern concerns as additional Open Questions. It runs after gap detection so it can also see `gaps.json`. It does NOT pause for input — the user sees its findings in the design doc at the Phase 3 review gate.

Spawn it with this prompt (do NOT read the brief yourself — the subagent reads it directly, keeping the orchestrator's context lean):

> Read `<SKILL_DIR>/prompts/skeptic.md` for your full brief and output schema. Then run the skeptic pass against `.backend-design/state/*.json`, `.backend-design/config.json`, and `.backend-design/gaps.json`. Write your augmented array to `.backend-design/state/open_questions.json` and your raw findings to `.backend-design/state/skeptic_findings.json`. Cap output at 8 questions.

After the skeptic agent finishes:

1. Re-run the validator (`node <SKILL_DIR>/validate.mjs`) to ensure the appended questions are well-formed.
2. Re-render the design doc so the new findings appear in the Open Questions section: `node <SKILL_DIR>/scripts/render-design.mjs`.
3. Report a one-line summary to the user: `Skeptic pass: <N> finding(s) — see Open Questions in backend-design.md.`

If the skeptic agent writes zero findings, that's a valid outcome — small or simple designs frequently have nothing concrete to flag. Don't re-spawn to "find something."

**Checkpoint write** (end of Phase 2.6): merge `{ phase_2_6_at: <ISO now> }` into `.backend-design/checkpoint.json`.

---

### Phase 3 — Review gate (do not skip)

After Phase 2.5 completes:

1. Read `.backend-design/state/design-summary.json` (emitted by `render-design.mjs` alongside the markdown — ~500 bytes of pre-computed counts) and `.backend-design/gaps.json`. **Do not read `backend-design.md`** — it's for the user, not for the model summary step. Print a short summary to the user using fields from these two files: entity count, table count, endpoint count, whether auth is included (`auth_enabled`), `coverage_check.covered` vs. `coverage_check.flagged`, `open_question_count` (split as `<X> product-intent · <Y> skeptic-pass` using `skeptic_count` from the same summary file), and `<N> blocker(s) · <M> wire-up(s) · <K> info item(s)` from `gaps.json`.
2. Tell the user: "Four files are ready for review: `./backend-design.md` (the design, including a recommended answer to every open question), `./backend-design-next-steps.md` (env vars, wire-up TODOs, accounts to set up), `./backend-design.env.example` (copy to `.env` and fill in), and `./openapi.json` (OpenAPI 3.1 contract — load it into Stoplight, Swagger Editor, or `npx openapi-typescript` to preview before scaffolding). Let me know to proceed, or describe any changes."
3. **Stop.** Do not call any more tools. Wait for the user's next message.

If the user asks for design edits, edit the underlying state JSON (e.g. `.backend-design/state/entities.json`) with `Edit`, then **re-run** `node <SKILL_DIR>/scripts/render-design.mjs` AND `node <SKILL_DIR>/scripts/render-openapi.mjs` so both the design doc and the OpenAPI spec stay in sync with the state. **Never hand-edit `backend-design.md` or `openapi.json` directly** — they're overwritten by the renderers. For substantial redesigns, re-spawn the Phase 2 synthesis agent with the revised requirements. **Do not hand-edit `backend-design-next-steps.md`** either — it's regenerated by `detect-gaps.mjs`. If the user closes a gap (e.g. sets an env var, adds an auth form), re-run `node <SKILL_DIR>/scripts/detect-gaps.mjs` instead.

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
| `s2ai-schema`         | _(no prompt — see schema-only branch below)_ |

**Schema-only branch.** If `config.stack.id === "s2ai-schema"`, **do not spawn a codegen agent**. Instead run:

```bash
node <SKILL_DIR>/scripts/render-s2ai-schema.mjs
```

It reads `.backend-design/state/*.json` and writes `./schema.mmd` at the repo root (the chosen `output_dir` is ignored for this stack). No verification commands apply — there is no compile step, no startup smoke test. Report to the user: file path, entity count, relationship count, and how many non-CRUD endpoints were emitted as commented hints. Skip directly to the Phase 4 checkpoint write. The user supplies `@dictionary` regex blocks and the `@service` auth block by hand, then runs s2ai's own `make` pipeline against the file.

Determine whether placeholders apply: scan `.backend-design/state/endpoints.json` for any endpoint with `temporary: true`. **Do not read the codegen prompt yourself** — pass its path to the subagent and let it read directly. Spawn **one `general-purpose` subagent** with `model: "sonnet"` and the following prompt (substitute the bracketed values):

> The authoritative spec is in `.backend-design/state/*.json`. Stack: `<config.stack.id>` (<config.stack.label>), auth strategy: `<config.auth.strategy>`, output directory: `<config.output_dir>`.
>
> Read `<SKILL_DIR>/prompts/codegen-<config.stack.id>.md` for your scaffolding brief and follow it exactly. The brief now includes a `## Tests (required)` section and a `## Security baseline` section — implement both. After scaffolding, run the **verification commands** listed at the bottom of that file (Node stacks: `<PM> install`, ORM generate, `<PM> tsc --noEmit`, `<PM> test`; Python: `pip install -e .`, `alembic check`, import smoke, `pytest`). Tests run against a real ephemeral Postgres via testcontainers — Docker must be running on the host. If Docker is not available, report it and skip the test step rather than failing the whole verification. Report any other failures.
>
> When done, output the exact "README run commands" section verbatim from the codegen brief — the orchestrator forwards it to the user.
>
> [Include this line ONLY when any endpoint has `temporary: true`:] Also read `<SKILL_DIR>/prompts/codegen-placeholders.md` — it overrides the brief for endpoints marked `temporary: true` (scaffold them as 501 stubs, strip auth, leave bodies empty).

This keeps the codegen prompt content (6–9 KB) out of the orchestrator's context — the subagent reads, scaffolds, verifies, and reports back the run commands.

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

Then report to the user: stack used, output directory, entity count, endpoint count, and the run commands the subagent reported back from the codegen brief's "README run commands" section.

---

## Rules

- **Do not skip Phase 3.** The user must see and approve the design doc before any backend code is written. This is the whole point of the skill.
- **Frontend is the source of truth for product behavior.** Never invent endpoints, tables, or fields that represent product features the UI doesn't imply (e.g. don't add an admin dashboard's endpoints unless an admin page exists; don't add a notifications feed unless the UI shows one). **Best-practice infrastructure is scaffolded automatically** — auth from non-UI signals (`auth_required` screens, token storage keys, bearer headers), soft-delete (`deleted_at`), optimistic-lock (`version`), and audit columns (`created_by`/`updated_by`) on every entity. **Domain patterns** (e-commerce, chat, social, booking, CMS keyword hits) go through Open Questions with recommendations — surfaced for the user to accept or reject, never silently added. If the UI is missing something obvious (e.g., login form but no signup form), surface it in Open Questions instead of silently adding it.
- **Respect the chosen stack.** `.backend-design/config.json` records the user's choice. Do not deviate — if they picked `python-fastapi`, do not generate TypeScript. If `config.json` is missing, tell them to run `npx backend-design start` first.
- **Don't touch the frontend** unless `stack.framework === "nextjs"`. For the Next.js stack, you may add files under `app/api/`, `lib/`, and `prisma/` in the existing project. For all other stacks, write only to `config.output_dir` (default `./backend`), `./backend-design.md`, and `./.backend-design/`. **Exception:** `s2ai-schema` writes a single file `./schema.mmd` at the repo root regardless of `output_dir`.
- **State JSON is the source of truth.** Codegen reads from `.backend-design/state/*.json`. `backend-design.md` is rendered deterministically from the JSON by `scripts/render-design.mjs` — any hand-edits to it will be overwritten. When the user wants design changes, edit the JSON and re-render.
- **Run the validator at every synthesis step.** After Phase 1 (4 inventory files) and after Phase 2 (entities/relationships/auth). Never proceed past errors.
- **One review gate, not many.** Don't pepper the user with `AskUserQuestion` calls during Phase 1 or 2 unless something is genuinely ambiguous about their *intent* for the skill (not about the UI — that goes in Open Questions in the design doc).
