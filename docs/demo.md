# Recording the README demo

The README references `docs/demo.gif`. Re-record any time the workflow visibly changes (Phase numbers, new gates, new artifacts).

## Setup

- Use a public sample frontend so viewers can run the exact same commands. Suggested: a Next.js or React starter with a handful of screens (auth, list, detail, create).
- Resize the terminal to **120 cols × 36 rows** — wider lines wrap in the GIF and read poorly on mobile.
- Use a high-contrast theme. Dark backgrounds compress better in GIF.
- Clean shell prompt — strip any user/host/git information that adds visual noise. A `$ ` prompt is ideal.

## Script (6 steps, ~45 seconds end-to-end)

```bash
# 1. Start in any modern frontend project.
cd ~/code/some-sample-frontend

# 2. Detect frontend + pick a stack. Walk through the interview live —
#    Express+JWT+vibe-coder-off is the quickest path.
npx backend-design start

# 3. Open Claude Code, run the skill.
claude  # then type: /backend-design

# 4. The skill prints a summary at Phase 3:
#    "X entities, Y endpoints, JWT auth, N open questions, M blockers."
#    Pause on the design doc for ~3 seconds so a viewer can read the headline.

# 5. Approve ("looks good"), then watch Phase 4 scaffold + run tests.

# 6. Boot the generated backend and curl an endpoint to prove it works.
cd backend
cp ../backend-design.env.example .env
# fill in DATABASE_URL + JWT_SECRET (1Password / openssl rand)
pnpm install && pnpm prisma migrate dev --name init
pnpm dev &
curl -s -X POST localhost:3000/auth/signup -H 'content-type: application/json' \
  -d '{"email":"demo@x.com","password":"hunter12"}'
```

## Recording

- **asciinema** (preferred, smaller files, sharper text): `asciinema rec demo.cast`. Convert to gif with [`agg`](https://github.com/asciinema/agg): `agg --theme github-dark --speed 1.5 demo.cast demo.gif`.
- **QuickTime + ffmpeg fallback**: screen-record a tight crop, then `ffmpeg -i demo.mov -vf "fps=12,scale=900:-1:flags=lanczos" -loop 0 demo.gif`.

Target output: **≤ 4 MB**, **≤ 50 seconds**, **≥ 900 px wide**. Anything larger gets compressed by GitHub's renderer and looks worse.

## Drop the gif

Save the final file to `docs/demo.gif`. No README change needed — the existing `![backend-design demo](docs/demo.gif)` link picks it up automatically.
