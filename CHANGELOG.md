# Changelog

All notable changes to **backend-design** are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- **Auto-install is now project-local, not global.** `npx backend-design start` symlinks the skill into `<cwd>/.claude/skills/backend-design` on first run instead of `~/.claude/skills/`. The skill is scoped to the project you're scaffolding for, doesn't pollute your global skills, and is cleaned up when you `rm -rf` the project. The explicit `backend-design install` command still writes globally for users who want the skill across every project, and `ensureInstalled` checks both paths so an existing global install is honored over creating a duplicate project-local one.
- **`uninstall` now removes both** the global symlink at `~/.claude/skills/backend-design` and any project-local one at `<cwd>/.claude/skills/backend-design`.
- **Clearer post-install messaging.** The "Next step" block at the end of `start` now distinguishes between a fresh install (skill just registered — need a new Claude Code session to pick it up) and an existing install (just run `/backend-design` in your current session). The accurate guidance — "skills load at session startup, not live" — replaces the previous vague "restart Claude Code" hint.

## [0.12.0] — 2026-06-05

Packaging and onboarding polish — README restructure, install flow collapse, banner.

### Added
- **Auto-registered skill on first `start`.** `npx backend-design start` now checks `~/.claude/skills/backend-design` at the top of the command and silently symlinks the package into place if it isn't there. New users go from four copy-pastes (`npm i -g`, `backend-design install`, `cd`, `start`) to two (`cd`, `npx backend-design start`). The `install` command is preserved as an explicit opt-in for durable installs that survive npx cache eviction.
- **`docs/banner.png`** — pixel-art project banner (1600×400, 2× retina, ~27 kB). Bundled in the published tarball so it renders on the npm package page, not just GitHub.
- **README badges** (npm version, monthly downloads, Node engine, MIT license) under the banner.

### Changed
- **README structure.** Banner + tagline + badges + a two-line **Quick start** are now the first thing on the page. The deep "Install" section was rewritten as **Durable install (optional)** and moved below "How it works". Net effect: the first install command is at roughly line ~20 instead of line ~108.
- **`help` output** drops the explicit `install` line from the "Typical flow" block (it's now implicit).

## [0.11.0] — 2026-06-02

Bundles a connected sprint of work that landed together: cookie sessions + CSRF, the OpenAPI 3.1 contract with stack-native Swagger UI, the Phase 2.6 skeptic pass, generated tests + a security baseline for every scaffold, and the new inference policies (auth from non-UI signals, best-practice columns by default, domain-pattern detection). The previous 0.8.0, 0.9.0, and 0.10.0 tags were rolled into this release rather than left as separate same-day bumps.

### Added
- **Cookie sessions** as a third auth strategy alongside `jwt` and `none`. `npx backend-design start` adds a "Cookie session (Postgres-backed, with CSRF)" option; picking it follows up with a second prompt for the session store (`postgres` default — uses the existing `DATABASE_URL`, no new infra — or `redis` via `SESSION_STORE=redis` + `REDIS_URL`). Real logout (destroys the row), revocable from the DB, XSS-resistant when `httpOnly: true`.
- **CSRF protection** scaffolded in every session-strategy backend. Mutating requests must send `X-CSRF-Token` (fetched from `GET /auth/csrf-token`). Per stack:
  - Express: `express-session` + `connect-pg-simple` (or `connect-redis`) + `csrf-csrf` (the maintained replacement for the deprecated `csurf`).
  - Fastify: `@fastify/session` + `@fastify/csrf-protection`.
  - Hono: `hono-sessions` + `hono/csrf` middleware.
  - Next.js: `iron-session` (cookie-encrypted by default, with a thin DB/Redis adapter when `store !== "cookie"`) + a `lib/csrf.ts` helper for mutating route handlers.
  - FastAPI: `starsessions` + `fastapi-csrf-protect`.
- **`Session` entity** added to synthesis when `auth.strategy === "session"` AND `auth.store === "postgres"` (the validator forbids it when `store === "redis"`). The validator skips best-practice-column checks for `Session` rows.
- **OpenAPI 3.1 generation.** New `scripts/render-openapi.mjs` reads `.backend-design/state/*.json` and emits `./openapi.json` at the repo root, including incoming webhooks as a first-class top-level `webhooks` block (`webhook_source` + `signature_header` documented per provider). Component schemas are emitted per entity with field-type mapping (`uuid → string format:uuid`, `timestamptz → string format:date-time`, etc.); `pk`, `version`, `created_at`/`updated_at`, `deleted_at`, and `created_by`/`updated_by` are marked `readOnly` (and nullable where appropriate). `securitySchemes.bearerAuth` is emitted only when `auth.strategy === "jwt"`; placeholder endpoints (`temporary: true`) and external endpoints (`is_external: true`) are skipped.
- **Swagger UI in every codegen stack:**
  - Express: `swagger-ui-express` serves `src/openapi.json` at `/docs`.
  - Fastify: `@fastify/swagger` + `@fastify/swagger-ui` in `static` mode at `/docs`.
  - Hono: `@hono/swagger-ui` mounted on the static spec at `/docs`.
  - Next.js: static `public/openapi.json` + `app/api-docs/page.tsx` with `swagger-ui-react`.
  - FastAPI: native `/docs` and `/redoc` (Pydantic-driven, more accurate); the orchestrator's `./openapi.json` is still emitted at the repo root for design-time reviewers, and `BACKEND_SETUP.md` documents the two-spec model.
- **Phase 2.6 — Skeptic pass.** A `general-purpose` Sonnet subagent reviews the synthesized design against four adversarial axes (security, scalability/data integrity, multi-tenancy, operability) and appends findings to `open_questions.json` with `category: "skeptic"`. Capped at 8 questions per run; only fires when concrete patterns match (IDOR-shaped path params, missing list indexes, missing org scoping, missing health endpoints, etc.). Surfaces under a dedicated "Skeptic-pass findings" sub-heading in the design doc.
- **Generated tests** for every codegen stack — vitest + supertest + `@testcontainers/postgresql` for Node stacks; pytest + httpx + `testcontainers[postgres]` for FastAPI. Tests cover signup → login → protected flow plus per-resource list/create/PATCH-with-`If-Match`/409-conflict/soft-delete on a real ephemeral Postgres.
- **Security baseline** in every codegen stack:
  - Node stacks: helmet (or `@fastify/helmet` / `hono/secure-headers`), tighter rate limits on writes (`RATE_LIMIT_WRITE_MAX`), CORS allowlist via `ALLOWED_ORIGINS` (refuses `*` in production), structured request logging via pino.
  - Next.js: `middleware.ts` at project root with CORS allowlist and an in-memory rate limiter that swaps to `@upstash/ratelimit` when `UPSTASH_REDIS_URL` is set.
  - FastAPI: `slowapi` rate limiting, security headers middleware, `CORSMiddleware` allowlist, `structlog` for JSON logs in production.
- **Inference policy: auth from non-UI signals.** Phase 2 infers a `users` entity + `/auth/*` endpoints when ANY of these hold even without a login/signup form: `auth_required` screens, token-shaped storage keys, bearer headers, or `/api/auth/*` fetches. The strongest signal is recorded in `auth.json -> inferred_from` and surfaced in `backend-design.md` and `backend-design-next-steps.md` so the user can either add the missing UI or remove the inferring signal.
- **Best-practice columns by default** on every entity: `deleted_at` (soft delete), `version` (optimistic lock), and `created_by` / `updated_by` (audit FKs to the auth entity). Codegen handlers honor them — list/detail queries filter `deleted_at IS NULL`, `DELETE` soft-deletes, `PATCH` increments `version` and 409s on `If-Match` mismatch, partial unique indexes replace column-level UNIQUE on soft-deletable entities.
- **Domain pattern pass.** Scans screen IDs, paths, component names, and endpoint paths for keyword clusters (ecommerce, chat, social, booking, cms). When ≥2 distinct tokens match a class, emits one Open Question recommending deeper entities — never silently added.
- **Per-framework patterns files** at `prompts/patterns/<patterns_key>.md`, one small file per framework. Phase 1 subagents `Read` the patterns file path directly instead of having ~300 lines inlined into every spawn — preserves prompt-cache hits across the four parallel agents.
- `OPENAPI_PUBLIC` env var to opt into exposing `/docs` without auth in production. Default behavior gates `/docs` behind the existing auth middleware.
- New env vars surfaced by `render-env-example.mjs` and `detect-gaps.mjs`: `SESSION_SECRET`, `REDIS_URL`, `SESSION_MAX_AGE_DAYS`, `ALLOWED_ORIGINS`, `LOG_LEVEL`, `RATE_LIMIT_MAX`, `RATE_LIMIT_WRITE_MAX`, and (for Next.js) optional `UPSTASH_REDIS_URL`.
- New `prompts/next-steps-templates.md` entries: `missing_env_var:SESSION_SECRET`, `missing_env_var:REDIS_URL`.
- `CHANGELOG.md` (this file) and a `## Design choices` section in `README.md`.
- `docs/demo.md` — script for recording the README demo gif.
- `docs/example-ci.yml` — drop-in GitHub Actions workflow example (Postgres service container + validate + tsc + test; commented-out Python/FastAPI variant at the bottom).

### Changed
- `validate.mjs` accepts `auth.strategy === "session"` and validates the matching `auth.store` invariants. `findAuthEntityName` is hardcoded to exclude `Session` from auth-entity candidates so it never gets misclassified.
- `validate.mjs` accepts `category` and `axis` fields on open-question entries without warning; checks the `version` field shape (`type: integer`, `required: true`, `default: 1`); resolves FKs by `table` name (not entity name); emits warnings (not errors) when entities lack the new best-practice columns so old state files keep passing while migration is incremental.
- `bin/backend-design.mjs` AUTH_OPTIONS gains the `session` entry plus a follow-up store prompt that persists to `config.json -> auth.store`. `status` surfaces skeptic-finding counts alongside open gap counts, and `OpenAPI: ./openapi.json (N paths, M webhooks)` when the file exists.
- `npx backend-design gaps` re-renders `./openapi.json` alongside `./backend-design.env.example` so design and contract stay in sync after edits.
- `render-design.mjs` partitions Open Questions by `category` (synthesis questions render first, skeptic-pass findings under a labeled sub-heading) and surfaces `auth.inferred_from` as a transparency receipt in the Auth model section.
- `detect-gaps.mjs` reworded `missing_auth_ui` blocker to call out `inferred_from` when auth was scaffolded from a non-UI signal.
- `render-s2ai-schema.mjs` adds `@nullable @indexed` to `deleted_at`, `@autoGenerate` to `version`.
- SKILL.md Phase 2.5 runs `render-openapi.mjs` immediately after `render-env-example.mjs`. Phase 3 review-gate language now points the user at four artifacts (design, next-steps, env example, OpenAPI spec).

### Extracted
- Phase 1 inventory briefs moved from inline blockquotes in `SKILL.md` to `prompts/inventory/{screens,components,endpoints,forms}.md`. Orchestrator passes brief paths to subagents instead of pasting ~300 lines per spawn.
- `render-design.mjs` emits `.backend-design/state/design-summary.json` (counts + coverage check + auth status) so the Phase 3 summary step reads pre-computed JSON instead of re-parsing the markdown.

### Documentation
- README: hosting matrix for Postgres (Neon / Supabase / Railway / Fly / RDS / local Docker) under Design Choices.
- README: explicit `## What it doesn't do (yet)` section covering jobs/queues, WebSockets, multi-DB, and GraphQL — each with the rationale.
- README: "Synthesizes" summary line gains the "ships an OpenAPI 3.1 contract" and "session backend with CSRF" lines; the cookie-sessions and OpenAPI bullets are removed from "What it doesn't do (yet)" now that both ship.

## [0.7.0] — 2026-02-15

### Added
- **`s2ai-schema` stack.** New stack that emits a single `schema.mmd` (Mermaid) at repo root for s2ai's own pipeline. No backend dir, no codegen agent — Phase 4 just runs `scripts/render-s2ai-schema.mjs`. `@dictionary` regex blocks and the `@service` auth block are left as TODO comments for the user to fill in.

## [0.6.0] — 2026-01-12

### Added
- **Deterministic design doc.** `backend-design.md` is now rendered by `scripts/render-design.mjs` from the state JSON — no more agent-authored markdown. Runs produce stable diffs between invocations.
- **Env template.** `scripts/render-env-example.mjs` writes `backend-design.env.example` at repo root with every env var the design needs (DATABASE_URL, JWT_SECRET, per-source webhook secrets, OAuth `<PROVIDER>_CLIENT_ID/SECRET`, email provider options, `UPLOADS_DIR`, runtime).
- **Recommendations on every open question.** The synthesis agent's `open_questions.json` schema now requires a `recommendation` field — users get a default to accept rather than an open prompt to answer cold.

### Changed
- Tightened resumption logic: Phase 0 now distinguishes `fresh`, `fresh_with_gaps_preserved`, `resume_phase_2`, `resume_phase_2_5`, `resume_phase_3`, `resume_phase_4`, and `gaps_only` — preserves `gaps.json` across re-runs so closures are tracked.

## [0.5.0] — 2025-12-08

### Added
- **Vibe-coder mode.** Opt-in via `npx backend-design start`. When on, Phase 2 emits placeholder endpoints (`temporary: true`) for orphan UI signals (e.g. a "Become a host" button with no handler). Codegen wraps them in 501 stubs that throw loudly in dev. Default is off (strict mode).
- **Gap detection.** New `scripts/detect-gaps.mjs` writes `.backend-design/gaps.json` and `./backend-design-next-steps.md` covering missing env vars, missing auth UI, unwired buttons, and unverified external accounts. Diffs against the prior `gaps.json` to surface "Recently closed" gaps.
- **Phase 0 resumption.** Frontend signature (git HEAD + dirty hash, or content hash for non-git repos) is recorded at the end of Phase 1. Re-runs short-circuit to whichever phase still needs work — re-running gap detection only if everything's done, jumping straight to scaffolding if the design is approved, or re-doing inventory only if the frontend changed.

## [0.4.1] — 2025-11-01

### Fixed
- `bin` paths in `package.json` no longer start with `./` — npm silently strips them, which broke `npx backend-design`. Added a `prepublishOnly` guard so it can't regress.

## [0.4.0] — 2025-10-22

### Added
- Validator covers more state-consistency invariants (FK resolution, endpoint UI triggers, PK presence, role gating against `auth.rbac_roles`).
- Agent orchestration tightened — Phase 1 and Phase 2 now reliably re-spawn the right agent on validation failures rather than papering over gaps downstream.

## [0.3.0] — 2025-09-30

### Added
- Auto-detect any modern frontend stack via `package.json` + key files: Next.js (App/Pages), React (Vite/CRA), Vue, Nuxt, Svelte, SvelteKit, Angular 17+, Astro, SolidJS / SolidStart, Qwik, Remix / React Router v7, Gatsby, HTMX, vanilla HTML/JS.

## [0.2.0] — 2025-09-12

### Added
- Interactive CLI (`npx backend-design start`) — pick stack, auth strategy, output directory; writes `.backend-design/config.json`.

## [0.1.0] — 2025-08-30

### Added
- Initial release. SKILL.md runbook, JSON state schema, validator, model pinning, CLI installer.

[Unreleased]: https://github.com/jwolfsohn/backend-design/compare/v0.11.0...HEAD
[0.11.0]: https://github.com/jwolfsohn/backend-design/compare/v0.7.0...v0.11.0
[0.7.0]: https://github.com/jwolfsohn/backend-design/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/jwolfsohn/backend-design/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/jwolfsohn/backend-design/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/jwolfsohn/backend-design/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/jwolfsohn/backend-design/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/jwolfsohn/backend-design/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/jwolfsohn/backend-design/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/jwolfsohn/backend-design/releases/tag/v0.1.0
