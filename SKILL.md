---
name: backend-design
description: Analyze an existing frontend (Next.js, React, Vue, Nuxt, Svelte, SvelteKit, Angular, Astro, Solid, Qwik, Remix, Gatsby, HTMX, or vanilla HTML/JS) and scaffold a matching backend in the user's chosen stack (Express+Prisma, Fastify+Prisma, Hono+Drizzle, Next.js API routes, or FastAPI). Activate on "/backend-design", "build a backend for this frontend", "generate the API and database for this app", "design a backend from the UI", or similar intent. Two-step output — first a reviewable design doc (endpoints, DB schema, auth), then scaffolded code after the user approves.
---

# backend-design

You are about to design and scaffold a backend for an **existing frontend** in the current working directory. The frontend can be in any modern web framework — the CLI detects it automatically. The frontend is the source of truth: every button, form, fetch call, and route in the UI implies a backend obligation. Your job is to extract those obligations, get the user's approval on the shape of the backend, and then build it in the stack they chose.

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

A validator at `~/.claude/skills/backend-design/validate.mjs` checks the state for invariants (FK targets exist, every endpoint has a UI trigger, every entity has a PK, etc.). Run it after each synthesis step and fix errors before continuing.

---

## Pre-flight check

Before Phase 1:

1. **Read `.backend-design/config.json`**. If missing, tell the user:
   > Run `npx backend-design start` first to detect your frontend and pick your stack. Then re-invoke this skill.
   Stop here.

2. **Confirm to the user** in one line: `Targeting <config.stack.label> with <config.auth.strategy> auth on <config.frontend.framework> → <config.output_dir>`.

3. **Load framework patterns.** Read `~/.claude/skills/backend-design/prompts/frontend-patterns.md`. Extract the section whose heading matches `config.frontend.patterns_key`. You will inject this section into each Phase-1 agent's prompt so they search the right files. Keep it handy — call it `<<PATTERNS>>` in the agent briefs below.

   If `patterns_key` does not match any section in `frontend-patterns.md`, stop and tell the user: "Your detected framework `<framework>` is unrecognized. Edit `.backend-design/config.json` or use `prompts/frontend-patterns.md` patterns manually."

4. **Create the state directory:**
   ```bash
   mkdir -p .backend-design/state
   ```

---

### Phase 1 — Frontend inventory

Goal: catalog **every screen, every component, every interactive element, and every relationship between them** — enough that someone could rebuild the UI from the inventory alone. Be exhaustive, not selective. Partial coverage here corrupts every later phase.

Spawn **four `Explore` subagents in parallel** (single message, four tool calls). Each writes a single JSON file. Pin the model per agent to control cost — Agents 3 and 4 are mechanical and can run on Haiku.

| Agent | Model | Output file | Breadth |
|-------|-------|-------------|---------|
| 1. Screens & navigation | `sonnet` | `.backend-design/state/screens.json` | very thorough |
| 2. Component tree & shared state | `sonnet` | `.backend-design/state/components.json` | very thorough |
| 3. Network calls & API contracts | `haiku` | `.backend-design/state/endpoints.json` | very thorough |
| 4. Forms, buttons, auth surface | `haiku` | `.backend-design/state/forms.json` | very thorough |

Pass the `model` parameter to the `Agent` tool when spawning each agent (e.g. `Agent({ subagent_type: "Explore", model: "haiku", prompt: "..." })`).

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
>   "evidence": ["lib/api.ts:34"]
> }
> ```
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
>       "inputs": [
>         {"name": "title", "type": "text", "validation": {"required": true, "minLength": 3, "maxLength": 200}},
>         {"name": "body", "type": "textarea", "validation": {"required": true}}
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
> Action values: `api_call`, `navigate`, `local_state`, `open_modal`. Set `destructive: true` for Delete/Remove/Cancel. Do not output markdown — only the JSON file.

---

#### Phase 1b — Cross-file self-check

After all four agents return, before moving on:

1. Confirm all four JSON files exist and parse: `for f in screens components endpoints forms; do node -e "JSON.parse(require('fs').readFileSync('.backend-design/state/$f.json'))" || echo "FAIL: $f.json"; done`
2. Spot-check: does every network call in `endpoints.json` have a matching `triggered_by` element that exists in `forms.json` (a form or button)? Does every component named in `screens[].children` appear in `components.json`?
3. If you find gaps, re-spawn the relevant agent with a tighter brief. Do not paper over gaps in the synthesis step.

---

### Phase 2 — Design synthesis

Spawn **one `Plan` subagent** with `model: "sonnet"`. It reads the four JSON files from Phase 1, infers entities and relationships, refines endpoints, and writes more JSON files plus the human-readable design doc.

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
> For each added endpoint, set `triggered_by` to the UI element file:line that justifies it. Add an `auth` field (`required` or `none`) to every endpoint.
>
> **Do not invent features the UI does not imply.** Do not add admin endpoints unless an admin page exists in `screens.json`. Be skeptical of speculative endpoints.
>
> Write all four artifacts. Do not produce markdown — only JSON.

After the Plan agent finishes, **run the validator**:

```bash
node ~/.claude/skills/backend-design/validate.mjs
```

If it exits non-zero, read the errors, fix them by editing the JSON files directly (use `Edit`), and re-run. **Do not proceed to the markdown render or Phase 3 until validation passes.** Warnings are OK to leave but should be acknowledged in Open Questions.

Once validation passes, render `backend-design.md` at repo root from the JSON. You (the orchestrator) do this with `Read` + `Write` — no agent needed. Structure:

1. **Overview** — one paragraph inferred from the UI.
2. **Entity map** — markdown list of entities and relationships with cardinalities.
3. **Data model** — one section per entity from `entities.json`, with column tables.
4. **API endpoints** — one row per endpoint from `endpoints.json` (`Method | Path | Auth | Body | Response | Triggered by`).
5. **Auth model** — rendered from `auth.json`.
6. **Coverage check** — table mapping every screen + every interactive element to the backend artifact that supports it. Flag unmapped UI as Open Questions.
7. **Open questions** — anything ambiguous, plus all validator warnings.

---

### Phase 3 — Review gate (do not skip)

After Phase 2 completes:

1. Print a short summary of `backend-design.md` to the user: entity count, table count, endpoint count, whether auth is included, count of UI elements covered vs. flagged in the coverage check, and the count of open questions.
2. Tell the user: "The design doc is at `./backend-design.md`. Review it and let me know to proceed, or describe any changes."
3. **Stop.** Do not call any more tools. Wait for the user's next message.

If the user asks for edits, make them directly to `backend-design.md` (use the `Edit` tool — do not spawn an agent for small edits). If the user asks for a substantial redesign, re-spawn the Phase 2 Plan agent with the revised requirements.

Only proceed to Phase 4 when the user gives explicit approval ("looks good", "proceed", "ship it", "go", etc.).

---

### Phase 4 — Code scaffolding

The codegen prompt is **stack-specific**. Read `.backend-design/config.json` to get `stack.id`, then read the matching prompt file from this skill's `prompts/` directory:

| `stack.id`            | Prompt file to read |
|-----------------------|---------------------|
| `node-express-prisma` | `~/.claude/skills/backend-design/prompts/codegen-node-express-prisma.md` |
| `node-fastify-prisma` | `~/.claude/skills/backend-design/prompts/codegen-node-fastify-prisma.md` |
| `node-hono-drizzle`   | `~/.claude/skills/backend-design/prompts/codegen-node-hono-drizzle.md` |
| `nextjs-prisma`       | `~/.claude/skills/backend-design/prompts/codegen-nextjs-prisma.md` |
| `python-fastapi`      | `~/.claude/skills/backend-design/prompts/codegen-python-fastapi.md` |

Use `Read` to load the relevant prompt file. Spawn **one `general-purpose` subagent** with `model: "sonnet"` and pass that file's contents as the prompt, prefixed with:

> The authoritative spec is in `.backend-design/state/*.json`. The user has chosen stack `<config.stack.id>` (<config.stack.label>) with auth strategy `<config.auth.strategy>` and output directory `<config.output_dir>`.
>
> Use this brief:
>
> <pasted contents of the codegen-*.md file>

After the agent finishes, run the **stack-specific verification commands** listed at the bottom of the codegen prompt file. For Node stacks: `pnpm install`, ORM-specific generate command, `pnpm tsc --noEmit`. For Python: `pip install -e .`, `alembic check`, import smoke test.

If any verification step fails, fix it directly with `Edit` (these are usually small mistakes — typos, missing imports). Do not declare the task complete until verification passes.

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
