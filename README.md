# backend-design

A [Claude Code](https://claude.com/claude-code) skill that reads an existing React/Next.js frontend and generates a matching Node.js + Express + Postgres backend.

## What it does

Point it at a frontend codebase and it:

1. **Inventories** every screen, component, network call, form, button, and auth surface — in parallel, writing structured JSON state.
2. **Synthesizes** entities, relationships, endpoints, and an auth model from the inventory.
3. **Validates** the design against invariants (every FK resolves, every endpoint has a UI trigger, every entity has a PK, etc.).
4. **Reviews** — produces a human-readable `backend-design.md` and pauses for your approval.
5. **Scaffolds** a runnable Express + TypeScript + Prisma + Postgres backend under `./backend/` once you approve.

The skill targets a fixed stack — Express, Prisma, Postgres, JWT, zod, bcrypt, TypeScript — so the output is predictable and idiomatic.

## Install

### Via npm (recommended)

```bash
npx backend-design install
```

This symlinks the package into `~/.claude/skills/backend-design`. Restart Claude Code (or start a new session) and the skill appears in the available-skills list.

To uninstall: `npx backend-design uninstall`.

### From source

```bash
git clone https://github.com/jwolfsohn/backend-design.git ~/code/backend-design
ln -s ~/code/backend-design ~/.claude/skills/backend-design
```

## Use

From a directory containing a React/Next.js frontend, in Claude Code:

```
/backend-design
```

Or just describe the intent:

> Build a backend for this frontend.

The skill walks you through pre-flight checks, parallel inventory, synthesis, validation, review, and code generation.

## Commands

| Command | What it does |
|---------|--------------|
| `npx backend-design install` | Symlink the skill into `~/.claude/skills/` |
| `npx backend-design uninstall` | Remove the symlink |
| `npx backend-design validate` | Validate `.backend-design/state/*.json` in the current directory against invariants |

The validator is also invoked automatically by the skill at every synthesis step.

## State files

All design state lives under `.backend-design/state/` as JSON — these are the single source of truth.

| File | Written by | Contents |
|------|------------|----------|
| `screens.json` | Phase 1 Agent 1 (sonnet) | Every screen with file, entities displayed, data fetches, nav graph |
| `components.json` | Phase 1 Agent 2 (sonnet) | Every component, props, hooks, plus shared state (contexts, stores, storage keys) |
| `endpoints.json` | Phase 1 Agent 3 (haiku) | Every network call discovered, then refined by Phase 2 with implied CRUD |
| `forms.json` | Phase 1 Agent 4 (haiku) | Every form, every standalone button, auth surface |
| `entities.json` | Phase 2 Plan agent | Inferred Postgres tables with columns, types, indexes |
| `relationships.json` | Phase 2 Plan agent | FK relationships with cardinalities and on-delete behavior |
| `auth.json` | Phase 2 Plan agent | JWT/bcrypt config, signup/login/etc. flags |

Every JSON entry includes `evidence: ["file:line"]` so you can trace any decision back to the UI.

## What gets generated

After approval, you get `backend/`:

```
backend/
  package.json              # express, prisma, bcrypt, jsonwebtoken, cors, zod, tsx
  tsconfig.json
  prisma/schema.prisma      # tables from entities.json + relationships.json
  src/
    index.ts                # express bootstrap
    db.ts                   # prisma client singleton
    middleware/auth.ts      # JWT verify -> req.user
    routes/                 # one file per resource (from endpoints.json)
    schemas/                # zod validators (from endpoints[].request_body)
  .env.example              # DATABASE_URL, JWT_SECRET
  README.md                 # run instructions
```

Run it:

```bash
cd backend
pnpm install
cp .env.example .env       # fill in DATABASE_URL and JWT_SECRET
pnpm prisma migrate dev --name init
pnpm dev
```

## Stack assumptions

| Layer        | Choice                        |
|--------------|-------------------------------|
| Runtime      | Node.js 20+, TypeScript strict|
| Framework    | Express 4                     |
| Database     | Postgres via Prisma           |
| Auth         | JWT (HS256), 7-day expiry     |
| Passwords    | bcrypt, cost 12               |
| Validation   | zod on every request body     |
| Package mgr  | pnpm                          |

This is opinionated on purpose. If you need a different stack, fork and edit `SKILL.md`.

## Cost

Token usage on a medium Next.js app (~200 source files):

- Phase 1 (4 parallel inventory agents): ~80K tokens (Agents 3 & 4 on Haiku, 1 & 2 on Sonnet)
- Phase 2 (synthesis + validation): ~25K tokens
- Phase 4 (codegen): ~40K tokens

Rough total: ~$1-3 per run on the default model mix. On larger codebases (>500 files) the skill will warn you and offer to scope down before starting.

## How it works under the hood

`SKILL.md` is a runbook for Claude Code, not executable code. When the skill activates, Claude:

1. Runs a pre-flight check (frontend present, file count under threshold).
2. Spawns four `Explore` subagents in parallel for the frontend inventory — each writes one JSON file. Agents 3 & 4 use Haiku; 1 & 2 use Sonnet.
3. Spawns one `Plan` subagent (Sonnet) for the design synthesis — it writes `entities.json`, `relationships.json`, `auth.json` and refines `endpoints.json`.
4. Runs `validate.mjs` against the JSON state. Loops on errors until clean.
5. Renders `backend-design.md` from the JSON and pauses for your approval.
6. Spawns one `general-purpose` subagent (Sonnet) to scaffold the backend, reading the JSON files directly. Verifies the scaffold compiles before reporting done.

No custom subagent definitions, no plugins — just the built-in Claude Code agents being given specific prompts with model pinning.

## License

MIT
