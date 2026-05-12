# backend-design

A [Claude Code](https://claude.com/claude-code) skill that reads an existing React/Next.js frontend and generates a matching Node.js + Express + Postgres backend.

## What it does

Point it at a frontend codebase and it:

1. **Inventories** every route, fetch/axios call, form, button, and auth surface.
2. **Designs** a backend — Postgres schema, REST endpoints, JWT auth model — and writes it to `backend-design.md` for you to review.
3. **Pauses** so you can edit the design.
4. **Scaffolds** a runnable Express + TypeScript + Prisma + Postgres backend under `./backend/` once you approve.

The skill targets a fixed stack — Express, Prisma, Postgres, JWT, zod, bcrypt, TypeScript — so the output is predictable and idiomatic.

## Install

```bash
git clone https://github.com/<you>/backend-design.git ~/code/backend-design
ln -s ~/code/backend-design ~/.claude/skills/backend-design
```

Restart Claude Code (or start a new session). The skill should appear in the available-skills list.

## Use

From a directory containing a React/Next.js frontend, in Claude Code:

```
/backend-design
```

Or just describe the intent:

> Build a backend for this frontend.

The skill will walk you through the 4 phases described above.

## What gets generated

After approval, you'll have a `backend/` directory with:

```
backend/
  package.json              # express, prisma, bcrypt, jsonwebtoken, cors, zod, tsx
  tsconfig.json
  prisma/schema.prisma      # tables from the design doc
  src/
    index.ts                # express bootstrap
    db.ts                   # prisma client singleton
    middleware/auth.ts      # JWT verify -> req.user
    routes/                 # one file per resource
    schemas/                # zod request validators
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

## How it works under the hood

`SKILL.md` is a runbook for Claude Code, not executable code. When the skill activates, Claude:

- Spawns three `Explore` subagents in parallel for the frontend inventory.
- Spawns one `Plan` subagent for the design synthesis.
- Stops and waits for your approval.
- Spawns one `general-purpose` subagent to scaffold the backend, then verifies the scaffold compiles before reporting done.

No custom subagent definitions, no plugins — just the built-in Claude Code agents being given specific prompts.

## License

MIT
