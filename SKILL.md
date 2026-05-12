---
name: backend-design
description: Analyze an existing React/Next.js frontend and produce a matching Node.js + Express + Postgres backend. Activate on "/backend-design", "build a backend for this frontend", "generate the API and database for this app", "design a backend from the UI", or similar intent. Two-step output — first a reviewable design doc (endpoints, DB schema, auth), then scaffolded TypeScript code after the user approves.
---

# backend-design

You are about to design and scaffold a backend for an **existing React/Next.js frontend** that lives in the current working directory. The frontend is the source of truth: every button, form, fetch call, and route in the UI implies a backend obligation. Your job is to extract those obligations, get the user's approval on the shape of the backend, and then build it.

The target backend stack is fixed:

- **Runtime**: Node.js 20+ with TypeScript
- **Framework**: Express
- **Database**: Postgres via Prisma
- **Auth**: JWT (HS256) with bcrypt password hashing
- **Validation**: zod on every request body
- **Package manager**: pnpm

Do not deviate from this stack unless the user explicitly asks.

## Workflow

You will execute **4 phases in order**. Phase 3 is a hard stop — do not start Phase 4 until the user approves the design doc.

All design state lives in **`.backend-design/state/*.json`** — one file per category, written by Phase-1 agents and Phase-2 Plan agent. These JSON files are the **single source of truth**. The human-readable `backend-design.md` is rendered from them; the codegen agent in Phase 4 reads them directly.

A validator script at `~/.claude/skills/backend-design/validate.mjs` checks the state for invariants (FK targets exist, every endpoint has a UI trigger, every entity has a PK, etc.). Run it after each synthesis step and fix any errors before continuing.

---

## Pre-flight check

Before Phase 1:

1. **Frontend present?** Confirm `package.json` lists `react` or `next` as a dep, or there's an `app/` / `pages/` / `src/app/` / `src/pages/` directory. If not, stop and ask the user where the frontend lives.

2. **Codebase size.** Run:
   ```bash
   find . -type f \( -name "*.tsx" -o -name "*.jsx" -o -name "*.ts" -o -name "*.js" \) \
     -not -path "*/node_modules/*" -not -path "*/.next/*" \
     -not -path "*/dist/*" -not -path "*/build/*" -not -path "*/.git/*" | wc -l
   ```
   If the count is **over 500**, warn the user: "This frontend has N source files; a full run will cost roughly \$5–15 in API tokens and ~10 minutes. Want me to scope down to a subdirectory (e.g. only `app/`)?" Wait for an answer before proceeding. Over 1500 files, refuse unless the user scopes down — the result will be noisy.

3. **Create the state directory:**
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

> Walk every screen in this React/Next.js frontend. A screen = anything the user can navigate to or that takes over the viewport: a route, a modal, a drawer, a wizard step, a tab panel that swaps content, an empty state, an error state, a loading state. Do not skip "obvious" screens (404, sign-in, settings sub-pages). Search `app/`, `pages/`, `src/pages/`, `src/app/`, `react-router` / `tanstack-router` configs, and layout files (`layout.tsx`, `_app.tsx`, `_layout.tsx`).
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

> Map every component file under `src/`, `components/`, `app/`, `pages/`, `ui/`. Also catalog every React Context, every Zustand/Redux/Jotai/Recoil/MobX store, and every `localStorage`/`sessionStorage`/cookie key (search `localStorage.`, `sessionStorage.`, `document.cookie`, `cookies()` from `next/headers`).
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

> Find every outbound HTTP call: `fetch(`, `axios.`, `ky.`, `useSWR`, `useQuery`, `useMutation`, `<form action=`, server actions (`"use server"`), plus every existing `app/api/*` or `pages/api/*` handler.
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

Spawn **one `general-purpose` subagent** with `model: "sonnet"`. Its source of truth is the JSON files in `.backend-design/state/`, **not** the markdown doc. The markdown is for humans; the JSON is for codegen.

Brief:

> Scaffold a Node.js + Express + Postgres backend. The authoritative spec is in `.backend-design/state/` — read these files first:
>
> - `entities.json` — drives `prisma/schema.prisma` (one Prisma model per entity, exact columns/types/indexes)
> - `relationships.json` — drives Prisma `@relation` directives and FK on-delete behavior
> - `endpoints.json` — one route handler per entry, exactly as specified (method, path, auth, request body, response). Do not add endpoints that aren't in this file.
> - `auth.json` — drives the auth middleware and `/auth/*` routes
>
> Constraints:
>
> - TypeScript with `"strict": true`.
> - Prisma. Generate `prisma/schema.prisma` directly from `entities.json` + `relationships.json` — one Prisma model per entity, exact columns and `@relation` directives.
> - Express 4 with: `cors`, `express.json()`, a JWT auth middleware reading `Authorization: Bearer <token>` and attaching `req.user`, a global error handler returning `{ error: string }` with the right status.
> - Validate every request body with zod, generated from each endpoint's `request_body` field. Schemas under `src/schemas/`. Validation failure → 400 with `{ error: "<zod message>" }`.
> - One route file per resource under `src/routes/`. Mount in `src/index.ts`.
> - bcrypt password hashing (cost from `auth.json -> bcrypt_cost`). JWT signing per `auth.json` (algorithm, expiry, secret from `process.env[auth.secret_env]`).
> - **Do not implement endpoints that aren't in `endpoints.json`. Do not invent fields not in `entities.json`.** If a spec field is ambiguous, pick the simpler option and add a `TODO:` comment citing the JSON path.
> - `.env.example` with `DATABASE_URL` and `JWT_SECRET`.
> - `README.md` with:
>   ```
>   pnpm install
>   cp .env.example .env   # fill in DATABASE_URL and JWT_SECRET
>   pnpm prisma migrate dev --name init
>   pnpm dev
>   ```
> - Dev script: `tsx watch src/index.ts`.
>
> Target directory: `./backend/`. Do not modify frontend code.

After the agent finishes, do a quick verification pass yourself:

1. `cd backend && pnpm install` — must succeed.
2. `pnpm prisma generate` — must succeed (catches schema syntax errors without needing a live DB).
3. `pnpm tsc --noEmit` — must pass type check.

If any step fails, fix it directly (use `Edit`, not a new agent — these are usually small mistakes). Do not declare the task complete until all three pass.

Then report to the user: directory created, table count, endpoint count, and the next-step command (`cd backend && pnpm install && ...`).

---

## Rules

- **Do not skip Phase 3.** The user must see and approve the design doc before any backend code is written. This is the whole point of the skill.
- **Frontend is the source of truth.** Never add endpoints, tables, or fields the UI doesn't imply. If you think the UI is missing something obvious (e.g., login form but no signup form), surface it in the "Open questions" section instead of silently adding it.
- **No alternate stacks.** Express + Prisma + Postgres + JWT + zod. If the user asks for FastAPI or Drizzle or sessions instead of JWTs, tell them this skill targets the fixed stack and ask if they want to proceed anyway or use a different approach.
- **Don't touch the frontend.** This skill writes only to `./backend/`, `./backend-design.md`, and `./.backend-design/`.
- **State JSON is the source of truth.** Codegen reads from `.backend-design/state/*.json`, not from `backend-design.md`. If the user edits the markdown during review, you must mirror their edits into the JSON files (or have them edit JSON directly) before proceeding to Phase 4.
- **Run the validator at every synthesis step.** After Phase 1 (4 inventory files) and after Phase 2 (entities/relationships/auth). Never proceed past errors.
- **One review gate, not many.** Don't pepper the user with `AskUserQuestion` calls during Phase 1 or 2 unless something is genuinely ambiguous about their *intent* for the skill (not about the UI — that goes in Open Questions in the design doc).
