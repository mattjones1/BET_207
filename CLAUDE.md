# BET_207 / EdgeBoard: working notes for Claude

Personal sports handicapping research platform for the NFL, FBS college football, and the NBA. **A measurable process, not a picks machine.** It never accepts or places wagers.

## Rules that always apply
- **Sign conventions:** the home margin (`homeScore − awayScore`) is the internal axis. Use only the helpers in `packages/core/src/conventions.ts`, and normalize provider signs in the adapters. nflverse `spread_line` > 0 means home favored, so it is already the home margin. The Odds API's home `point` is the home spread, so the margin is its negative.
- **A missing line or price is `null`, never 0.** Derived values stay `null` with a reason.
- **No look-ahead:** a projection for a game may use only results with `final_at <` the game's slot start.
- **Honest labels:** "closing" lines are retrospective benchmarks. The earliest captured line isn't an "opening" line. Small samples say "insufficient sample". Never claim a profitable edge. EV shows only with a real price and a calibrated σ.
- **Secrets:** the browser gets only `VITE_SUPABASE_URL` and the **publishable** key. The service role key and provider API keys live in GitHub Actions secrets and a gitignored `.env`, never in `VITE_*` variables or code.
- **Model configs are immutable.** A change creates a new version; never overwrite past predictions.
- **No fabricated data.** Demo mode uses labeled fixtures recorded from real provider responses.
- **SQL:** a schema change is a new numbered file in `supabase/migrations/`. Paste its full SQL in the reply; the user runs it in the Supabase SQL Editor.

## Layout
- `packages/core`: shared TypeScript (conventions, odds math, models, probability, backtest, sport configs, types). Runs in Node and the browser. Tests sit next to the code (`*.test.ts`).
- `packages/pipeline`: provider adapters and jobs. Run with `npm run pipeline -- <job> [--sport nfl] [--dry-run]`.
- `apps/web`: React, TypeScript, Vite, Tailwind v4, TanStack Query, and the HashRouter. All data access goes through `src/data/`.
- `supabase/migrations`: the schema and RLS. `supabase/tests/migrations.test.ts` runs them on PGlite with an auth stub.
- `docs/`: architecture, data sources, models, backtesting, and setup. `docs/decisions/` holds one file per architecture decision.

## Commands
- `npm test`: every unit and migration test. `npm run typecheck`, `npm run build`, `npm run dev` (port 5207, demo mode without env).
- Deploy: pushing `main` runs `.github/workflows/deploy.yml` to Pages at https://mattjones1.github.io/BET_207/.
