# Architecture

```
 Providers                 Pipeline (GitHub Actions / local CLI)           Supabase (Postgres + Auth + RLS)        Browser (GitHub Pages)
 ─────────                 ────────────────────────────────────            ────────────────────────────────        ──────────────────────
 nflverse games.csv ──┐    adapters: fetch → validate (zod) → normalize    shared: sports, teams, games, results,  React app, publishable key,
 CollegeFootballData ─┼──▶ jobs: schedules, results, odds, ratings,   ──▶   odds snapshots, lines, model runs,  ◀── reads via RLS (signed-in only)
 BALLDONTLIE ─────────┤    projections, backtests (service_role key)       ratings, projections, backtests        Model Lab previews run the same
 The Odds API ────────┘    quota manager, retries, pipeline_runs log       private: notes, saved games, settings   @bet207/core engine in a Worker
```

- **One engine.** `@bet207/core` holds the conventions, odds math, models, and backtesting. The pipeline (Node) and the browser (Web Worker) import the same code, so a Model Lab preview matches production.
- **Writes.** The pipeline writes shared data with the service role key, which bypasses RLS and exists only in GitHub secrets and the local `.env`. The browser writes only rows it owns: notes, saved games, settings, and user model configs and preview runs.
- **Idempotency.** Every external row has a natural unique key (`provider` + `provider_event_id` for games; game + book + market + `source_updated_at` for odds), and jobs upsert. Running a job twice changes nothing.
- **Provenance.** Each record keeps its provider, provider id, `retrieved_at`, `source_updated_at`, and completeness.
- **Routing.** A HashRouter, because GitHub Pages can't rewrite deep links.

Decision records live in `docs/decisions/`.
