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

Before Phase 1, do a 30-second sanity check: confirm there is actually a React or Next.js frontend in the current directory (`package.json` with `react` or `next` as a dep, or an `app/`/`pages/` directory). If you don't see one, stop and ask the user where the frontend lives.

---

### Phase 1 — Frontend inventory

Goal: catalog **every screen, every component, every interactive element, and every relationship between them** — enough that someone could rebuild the UI from the inventory alone. Be exhaustive, not selective. Partial coverage here corrupts every later phase.

Spawn **four `Explore` subagents in parallel** (single message, four tool calls). Use the prompts below verbatim, fill in the working directory. Tell every agent breadth `very thorough`.

**Agent 1 — Screens & navigation** (breadth: very thorough)

> Walk every screen in this React/Next.js frontend. A screen = anything the user can navigate to or that takes over the viewport: a route, a modal, a drawer, a wizard step, a tab panel that swaps content, an empty state, an error state, a loading state. Do not skip "obvious" screens (404, sign-in, settings sub-pages). For each screen return:
>
> - **URL path** — or the trigger if not URL-based (e.g. "modal opened from PostCard.tsx:42 'Share' button")
> - **File path** of the top-level component
> - **Direct child components used** (one level deep)
> - **Entities displayed** — the kinds of data shown (e.g. "list of posts with author name and comment count", "single user profile with their orders")
> - **Data fetches** — every `getServerSideProps`, `getStaticProps`, `loader`, server component fetch, `useEffect`+fetch, `useSWR`, `useQuery`. Capture URL, method, and where each response is consumed.
> - **Outbound navigation** — every `<Link>`, `router.push`, `redirect()`, `<a href=`, button-that-navigates. Capture destination route.
> - **Auth gate** — does the screen require login? Look for middleware redirects, `<RequireAuth>` wrappers, `getServerSideProps` auth checks, `auth()` calls.
>
> Search `app/`, `pages/`, `src/pages/`, `src/app/`, and any `react-router` / `tanstack-router` configs. Inventory layout files (`layout.tsx`, `_app.tsx`, `_layout.tsx`) and what they wrap.
>
> Return markdown with one `##` section per screen, plus a final `## Navigation graph` section listing every screen → screen edge with the trigger (button label, link text).

**Agent 2 — Component tree & shared state** (breadth: very thorough)

> Map the full component composition for this React/Next.js frontend. For every component file under `src/`, `components/`, `app/`, `pages/`, `ui/`, return:
>
> - **File path**
> - **Component name(s) exported**
> - **Props interface** — every prop name, type (from TS), required/optional. If untyped, infer from usage.
> - **Components it renders** — child components in JSX, with the props it passes them. This is the composition edge.
> - **Hooks it uses** — including custom hooks. Note `useContext`, `useStore`, `useSelector`, `useAtom`, `useQuery`, `useMutation`.
> - **Data it reads or mutates** — what entities/fields does this component touch, even just for display?
>
> Then separately catalog **shared state**:
> - Every React `Context` provider (file, value shape, consumers)
> - Every Zustand / Redux / Jotai / Recoil / MobX store (file, state shape, mutators)
> - Every `localStorage` / `sessionStorage` / cookie key the app reads or writes (search `localStorage.`, `sessionStorage.`, `document.cookie`, `cookies()` from `next/headers`)
>
> Return markdown. Include a final `## Component composition tree` section as a nested list rooted at each top-level screen, going all the way to leaf components. Do not stop at depth 2.

**Agent 3 — Network calls & API contracts** (breadth: very thorough)

> Find every outbound HTTP call in this React/Next.js frontend. Search for: `fetch(`, `axios.`, `ky.`, `useSWR`, `useQuery`, `useMutation`, `<form action=`, `<Form action=`, server actions (`"use server"`), and any existing `app/api/*` or `pages/api/*` handlers. For each call return:
>
> - **file:line**
> - **HTTP method**
> - **URL or URL pattern** (resolve template literals and path params where you can)
> - **Request body shape** (from TS interfaces, zod schemas, or inferred from the object literal passed in)
> - **Query params**
> - **Response shape** consumed by the caller (from TS types or destructuring)
> - **Trigger** — button click (which button, file:line), page load, form submit, polling interval
> - **Consuming component** — where the response data ends up rendered
> - **Auth header pattern** — does the call attach a token? From where (cookie, header, context)?
>
> Also list every existing Next.js API route handler (`app/api/*/route.ts`, `pages/api/*.ts`) with its current implementation summary — those are endpoints to preserve or migrate, not duplicate.
>
> Return a markdown table with the columns above, followed by a `## Auth header summary` section.

**Agent 4 — Forms, buttons, and auth surface** (breadth: very thorough)

> Inventory every form, input, and interactive button in this React/Next.js frontend. Include forms inside modals, in nested components, on settings pages — be exhaustive.
>
> For each form:
> - file:line, form name/purpose
> - Every input: `name`, type, placeholder, default value, validation rules (zod/yup schema reference, HTML `required`/`pattern`/`minLength`/`maxLength`/`min`/`max`)
> - Submit target (URL or handler function)
> - Success/error UI behavior (redirect, toast, inline error)
>
> For each interactive button **not inside a form** (anything with `onClick`, `onPress`, `formAction`):
> - file:line, label text, parent component
> - What the handler does — call an API, navigate, mutate local state, open a modal
> - Flag destructive actions (Delete, Remove, Cancel subscription) explicitly
>
> Separately flag every screen, form, or button related to **auth**: signup, login, logout, password reset, email verification, OAuth provider buttons, magic link, MFA/TOTP, account deletion, change password, change email.
>
> Return markdown grouped by: `## Forms`, `## Standalone buttons`, `## Auth surface`.

---

#### Phase 1b — Relationship synthesis (you, not an agent)

After all four agents return, **do not just concatenate their output and stop.** Read all four reports yourself and write a synthesis file at `./.backend-design/inventory.md` containing:

1. The four raw agent reports (verbatim).
2. A new top section: **`# Inferred entity relationships`**.

For the entity relationships section, identify the entities the UI implies (User, Post, Comment, Order, etc.) and map how they relate. Evidence patterns:

- A list view of X showing "by Y" → X belongs to Y (one-to-many)
- A detail page for X that renders a list of Y → X has many Y
- A form for X with a `<select>` of Y → X has FK to Y
- A multi-select / tag input → many-to-many (needs a join table)
- Nested URL `/x/:xId/y/:yId` → Y belongs to X
- Component props passing `xId` and `yId` together → likely related
- A "profile" or "account" screen → entity belongs to User

For each relationship, **cite the file:line evidence**. Be explicit about cardinality (1:1, 1:N, N:N) and which side owns the FK. Group ambiguous cases under a `## Ambiguous relationships` subsection — those become Open Questions in Phase 2, not silent assumptions.

This synthesis is the single most important artifact of Phase 1. Phase 2 design quality is bounded by the quality of this map.

Before moving to Phase 2, do a self-check pass:
- Does every screen from Agent 1 appear in the navigation graph?
- Does every component rendered in JSX appear in Agent 2's tree?
- Does every network call from Agent 3 map to a triggering button/form from Agent 4?
- Does every entity in the relationship map have a backing screen or form?

If any of those checks fail, re-spawn the relevant agent with a tighter brief before continuing.

---

### Phase 2 — Design synthesis

Spawn **one `Plan` subagent**. Give it the entire `.backend-design/inventory.md` from Phase 1 (which now includes the relationship synthesis) plus this brief:

> You are designing the backend for a React/Next.js frontend. The full UI inventory follows, ending with an `# Inferred entity relationships` section — treat that section as authoritative for the data model. Produce `backend-design.md` at the repo root with these sections in this order:
>
> 1. **Overview** — one paragraph summarizing what the app does, inferred from the UI.
> 2. **Entity map** — restate the entity relationships from the inventory as a quick reference. ASCII or markdown list, showing cardinalities. This anchors the data model.
> 3. **Data model** — every Postgres table with columns, types, nullability, defaults, foreign keys, and indexes. Drive tables from the entity map + the forms (input fields → columns) + list/detail views (a posts index implies a `posts` table) + auth flows (always include `users` if signup or login exists). Use `snake_case`. Always include `id` (uuid, pk), `created_at`, `updated_at`. For every FK, name the relationship and on-delete behavior (`cascade` for owned children, `restrict` otherwise).
> 4. **API endpoints** — one row per endpoint. Columns: `Method | Path | Auth | Request body (zod) | Response | Maps to frontend call`. Include every network call from the inventory **plus** implied CRUD (a list view of X implies `GET /x`; an edit form for X implies `PATCH /x/:id`; a "Delete X" button implies `DELETE /x/:id`). Every entry in the API table must cite either a network call file:line or a UI element file:line that justifies it.
> 5. **Auth model** — JWT details (claims, expiry, refresh strategy if needed), password hashing, signup flow (email verification yes/no), login flow, logout flow, password reset flow if signup exists. RBAC roles if the UI shows multiple user types (admin pages, etc.).
> 6. **Coverage check** — a table mapping every screen and every interactive element from Phase 1 to the backend artifact(s) that support it. One row per UI element. If a UI element has no backend mapping, either justify why (purely client-side) or flag it as an Open Question.
> 7. **Open questions** — anything ambiguous. Example: "Frontend has a 'Share' button at PostCard.tsx:42 that doesn't call any API. Should this be `POST /posts/:id/share` or purely client-side Web Share?" Be concrete; cite file:line. Pull in everything from the `## Ambiguous relationships` section of the inventory.
>
> Do not invent features the UI does not imply. Do not add admin endpoints unless an admin page exists. Be skeptical of speculative endpoints.

The Plan agent writes `backend-design.md` to the repo root.

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

Spawn **one `general-purpose` subagent** with this brief, after pasting the full contents of the approved `backend-design.md` into the prompt:

> Scaffold a Node.js + Express + Postgres backend from the design doc below. Constraints:
>
> - Use TypeScript with `"strict": true`.
> - Use Prisma for the ORM. Generate `prisma/schema.prisma` from the data model section — one Prisma model per table, with the exact columns and relations specified.
> - Use Express 4 with these middlewares: `cors`, `express.json()`, a JWT auth middleware that reads `Authorization: Bearer <token>` and attaches `req.user`, and a global error handler that returns `{ error: string }` with the right status code.
> - Validate every request body with zod. Put schemas under `src/schemas/`. On validation failure return 400 with `{ error: "<zod message>" }`.
> - One route file per resource under `src/routes/`. Mount them in `src/index.ts`.
> - Hash passwords with bcrypt (cost 12). Sign JWTs with HS256, 7-day expiry, secret from `process.env.JWT_SECRET`.
> - Do not implement endpoints that aren't in the design doc. Do not invent fields. If the design doc is ambiguous on a detail, pick the simpler option and add a `TODO:` comment.
> - Include a `.env.example` with `DATABASE_URL` and `JWT_SECRET`.
> - Include a `README.md` with these exact commands to run:
>   ```
>   pnpm install
>   cp .env.example .env   # then fill in DATABASE_URL and JWT_SECRET
>   pnpm prisma migrate dev --name init
>   pnpm dev
>   ```
> - The dev script should use `tsx watch src/index.ts`.
>
> Target directory: `./backend/`. Do not modify the existing frontend code.

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
- **One review gate, not many.** Don't pepper the user with `AskUserQuestion` calls during Phase 1 or 2 unless something is genuinely ambiguous about their *intent* for the skill (not about the UI — that goes in Open Questions in the design doc).
