# backend-design

A [Claude Code](https://claude.com/claude-code) skill that reads an existing frontend in any modern web framework and scaffolds a matching backend in the stack of your choice.

## Supported frontends

Auto-detected via `package.json` and a couple of key files — no full-codebase scan needed:

- **Next.js** (App Router or Pages Router)
- **React** (Vite, CRA, generic SPA)
- **Vue** (SPA)
- **Nuxt** 3
- **Svelte** / **SvelteKit**
- **Angular** 17+
- **Astro**
- **SolidJS** / **SolidStart**
- **Qwik** / Qwik City
- **Remix** / React Router v7
- **Gatsby**
- **HTMX** (HTML attribute-driven)
- **Vanilla** HTML + JS

Each framework has dedicated search patterns in `prompts/frontend-patterns.md` so the inventory agents grep the right files (e.g. `.vue` for Vue, `+page.svelte` for SvelteKit, `*.component.ts` for Angular).

## What it does

1. **Inventories** every screen, component, network call, form, button, and auth surface — in parallel, writing structured JSON state.
2. **Synthesizes** entities, relationships, endpoints, an auth model, and a list of open product-intent questions **each with a recommended answer** — so you have a default to accept rather than an open prompt to stare at. Auth is auto-scaffolded when implied (auth-gated screens, token-shaped storage keys, bearer headers, or `/api/auth/*` fetches — not just when a login form exists). Every entity gets best-practice columns by default: `deleted_at` (soft delete), `version` (optimistic lock), and `created_by`/`updated_by` (audit FKs). Domain-shape patterns (e-commerce, chat, social, booking, CMS) are surfaced as Open Questions with recommended entities, never silently added.
3. **Validates** the design against invariants (every FK resolves, every endpoint has a UI trigger, every entity has a PK, etc.).
4. **Detects gaps** — missing env vars (`DATABASE_URL`, `JWT_SECRET`, OAuth/Stripe secrets, per-source webhook secrets, email provider keys, `UPLOADS_DIR`), missing auth UI, unwired buttons. Writes a separate `backend-design-next-steps.md` with prescriptive fix instructions and a copy-pasteable `backend-design.env.example` at the repo root.
5. **Reviews** — produces a human-readable `backend-design.md` (deterministically rendered from the state JSON) and pauses for your approval.
6. **Scaffolds** a runnable backend in your chosen stack once you approve.

On re-runs, a Phase 0 resumption check compares the current frontend signature (git HEAD + dirty hash, or content hash) to the prior run and short-circuits to the right step — re-running gap detection if everything's done, jumping straight to scaffolding if the design is approved, or re-doing inventory only if the frontend changed.

## Supported stacks

You pick one when you run `npx backend-design start`:

| Stack | When to use |
|-------|-------------|
| **Node.js + Express + Prisma + Postgres** | Battle-tested default. Most ubiquitous. Easy to deploy. |
| **Node.js + Fastify + Prisma + Postgres** | ~2× faster than Express. Schema validation built in. |
| **Node.js + Hono + Drizzle + Postgres** | TypeScript-first, edge-ready. Drizzle is leaner than Prisma. |
| **Next.js API routes + Prisma + Postgres** | Colocated with the frontend. Easiest Vercel deploy. |
| **Python + FastAPI + SQLAlchemy + Postgres** | Strong typing, async by default. SQLAlchemy 2 + alembic. |
| **s2ai schema only** | Emit a Mermaid `schema.mmd` for s2ai. No server scaffolded — you run s2ai yourself. |

Auth: JWT or none. All stacks use bcrypt for password hashing. (Cookie sessions are not yet implemented in any of the codegen prompts — pick JWT or scaffold sessions yourself afterwards.)

### Vibe-coder mode (opt-in)

`npx backend-design start` asks whether to scaffold placeholder endpoints for orphan UI signals (e.g. a "Become a host" button with no handler). When **on**, Phase 2 emits stub endpoints with `temporary: true` and codegen wraps them in 501 handlers that throw loudly in dev. Paths are best-guesses — the next-steps doc flags each one for review. Default is **off** (strict mode: orphan buttons go in next-steps as wire-up work, no endpoints invented).

## Platform support

macOS and Linux. The installer uses symlinks and the file-count check shells out to `find`/`wc`; Windows users should run inside WSL2.

## Install

Pick one of:

```bash
# Durable: install globally, then symlink. Survives npm cache eviction.
npm i -g backend-design
backend-design install

# Or from a clone (most stable for development):
git clone https://github.com/jwolfsohn/backend-design && cd backend-design
node bin/backend-design.mjs install
```

Either way you'll get `~/.claude/skills/backend-design` pointing at the package. Restart Claude Code (or start a new session) and the skill appears in the available-skills list.

`npx backend-design install` works but symlinks into the npx cache, which can be pruned without warning — use one of the methods above for any non-throwaway setup.

Uninstall: `backend-design uninstall`.

## Use

```bash
cd my-frontend-project
npx backend-design start      # interactive: pick stack, auth, output dir
```

Then open Claude Code in the same directory and run:

```
/backend-design
```

The skill walks through inventory, synthesis, validation, review, and code generation.

## Commands

| Command | What it does |
|---------|--------------|
| `npx backend-design install` | Symlink the skill into `~/.claude/skills/` |
| `npx backend-design uninstall` | Remove the symlink |
| `npx backend-design start` | Interactive: pick stack + auth + vibe-coder mode, write `.backend-design/config.json` |
| `npx backend-design validate` | Validate `.backend-design/state/*.json` against invariants |
| `npx backend-design gaps` | Re-detect missing env vars, unwired buttons, missing auth UI; rewrite `backend-design-next-steps.md` |
| `npx backend-design status` | Show phase progress, frontend signature, and open gap counts |
| `npx backend-design reset` | Delete `.backend-design/` and the generated docs to start fresh (asks for confirmation) |
| `npx backend-design help` | Show usage |

## State files

All design state lives under `.backend-design/`:

| File | Written by | Contents |
|------|------------|----------|
| `config.json` | `start` command | Chosen stack, auth strategy, vibe-coder mode, output dir |
| `state/screens.json` | Phase 1 Agent 1 (sonnet) | Every screen, entities displayed, data fetches, nav graph |
| `state/components.json` | Phase 1 Agent 2 (sonnet) | Every component, props, hooks, shared state |
| `state/endpoints.json` | Phase 1 Agent 3 (sonnet) + Phase 2 refine | Every API call + implied CRUD (+ placeholders in vibe-coder mode) |
| `state/forms.json` | Phase 1 Agent 4 (sonnet) | Every form, button, auth surface |
| `state/entities.json` | Phase 2 synthesis agent | Inferred Postgres tables with columns/indexes |
| `state/relationships.json` | Phase 2 synthesis agent | FK relationships with cardinalities |
| `state/auth.json` | Phase 2 synthesis agent | JWT/bcrypt config, signup/login/etc. flags |
| `state/open_questions.json` | Phase 2 synthesis agent | Product-intent ambiguities, each with the agent's recommended answer |
| `gaps.json` | Phase 2.5 (`detect-gaps.mjs`) | Open and closed gaps with severity, fix instructions, evidence |
| `checkpoint.json` | End of each phase | Phase timestamps + frontend signature for Phase 0 resumption |

At the repo root, Phase 2 / 2.5 also write:

| File | Written by | Contents |
|------|------------|----------|
| `backend-design.md` | `scripts/render-design.mjs` | Deterministic design doc — 8 sections, regenerated from state JSON each run |
| `backend-design-next-steps.md` | `scripts/detect-gaps.mjs` | Action checklist: blockers, wire-up TODOs, info items |
| `backend-design.env.example` | `scripts/render-env-example.mjs` | Copy-pasteable `.env` template with every var the design needs, commented |

Every JSON entry includes `evidence: ["file:line"]` so you can trace any decision back to the UI.

## Generated backend layout

Depends on the stack you pick. The Express stack produces:

```
backend/
  package.json
  tsconfig.json
  prisma/schema.prisma
  src/
    index.ts                # Express bootstrap
    db.ts                   # Prisma client singleton
    middleware/auth.ts      # JWT verify -> req.user
    routes/<resource>.ts    # one file per resource
    schemas/<resource>.ts   # zod request validators
  .env.example
  README.md
```

The Next.js stack adds files inside the existing project (no separate `backend/` dir) — `app/api/<resource>/route.ts` per endpoint, `lib/db.ts`, `lib/auth.ts`, `prisma/schema.prisma`. The Fastify and Hono stacks mirror the Express layout with stack-appropriate names (`plugins/`, sub-apps). The FastAPI stack uses `app/models/`, `app/routers/`, `app/schemas/` plus `alembic/`. See `prompts/codegen-*.md` for each stack's exact layout.

The `s2ai-schema` stack is different — no backend dir, no codegen. It writes a single `schema.mmd` at repo root with the inferred entities, relationships, and non-CRUD endpoints (as `%%` comments). `@dictionary` regex blocks and the `@service` auth block are left as TODO comments for you to fill in by hand before feeding the file into s2ai's own pipeline.

## Cost

Rough token budget on a medium Next.js app (~200 source files); real cost varies with repo complexity and current Anthropic pricing — treat the per-phase numbers as ballparks, not benchmarks.

| Phase | Tokens (approx) |
|-------|-----------------|
| Phase 1 — 4 parallel inventory agents (all Sonnet) | ~80K |
| Phase 2 — synthesis + validation (Sonnet) | ~25K |
| Phase 4 — codegen (Sonnet) | ~40K |
| **Total** | **~145K** |

Expect a few dollars per end-to-end run on a typical app, more on large or convoluted ones. On codebases >500 source files the `start` command warns; >1500 it refuses and asks you to scope down.

## How it works

`SKILL.md` is a runbook for Claude Code, not executable code. When the skill activates:

1. **Phase 0** — runs `scripts/checkpoint.mjs decide`. If a prior run is on disk and the frontend hasn't changed, skips ahead to whichever phase still needs work.
2. Reads `.backend-design/config.json` to know which stack to target.
3. Runs a pre-flight check (frontend detected, file count under threshold).
4. **Phase 1** — spawns four `general-purpose` subagents (Sonnet) in parallel for the frontend inventory. Each writes one JSON file. (`Explore` is read-only, so it can't be used here.)
5. **Phase 2** — spawns one `general-purpose` subagent (Sonnet) for the design synthesis — it writes `entities.json`, `relationships.json`, `auth.json` and refines `endpoints.json`. In vibe-coder mode, also emits placeholder endpoints for orphan UI signals.
6. Runs `validate.mjs` against the JSON state. Loops on errors until clean.
7. Renders `backend-design.md` from the JSON.
8. **Phase 2.5** — runs `scripts/detect-gaps.mjs` to produce `backend-design-next-steps.md` (env-var checklist, wire-up TODOs, placeholder review).
9. **Phase 3** — pauses for your approval on both docs.
10. **Phase 4** — reads the stack-specific codegen prompt from `prompts/codegen-<stack-id>.md` (prepended with `codegen-placeholders.md` if any placeholders exist), then spawns one `general-purpose` subagent (Sonnet) to scaffold the backend. Verifies the scaffold compiles before reporting done.

Each phase writes a timestamp into `checkpoint.json` so the next invocation can resume cleanly.

No custom subagent definitions, no plugins — just the built-in Claude Code agents with model pinning and stack-specific prompts.

## License

MIT
