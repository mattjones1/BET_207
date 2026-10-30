# 0001: Stack, hosting, and where code runs

**Status:** accepted (October 30, 2026)

## Decision
- **Frontend:** React, TypeScript, Vite, Tailwind v4, TanStack Query, and Recharts, deployed as a static site to GitHub Pages from a **public** repo.
- **Backend:** Supabase Postgres, Auth (email and password, sign-ups off), and RLS.
- **Ingestion and official model runs:** GitHub Actions on cron and `workflow_dispatch`, running a Node CLI.
- **Modeling:** TypeScript (`@bet207/core`), shared by the pipeline and the browser. Python is kept for optional research notebooks in `research/`.

## Why
- **Free and simple:** Pages and Actions cost nothing on a public repo. Supabase handles auth and RLS so we don't run our own server.
- **Credentials:** API keys can't live in a static site, so every authenticated provider call happens in Actions.
- **TypeScript, not Python, for models:** the Model Lab needs instant what-if previews in the browser. Two implementations, TypeScript and Python, would drift. The model math (ridge solves on 32–136 teams, Elo, normal and empirical probabilities) is small enough for TypeScript.
- **HashRouter:** Pages has no rewrite rules for deep links.

## Consequences
- Heavy future work (player-level models, large simulations) can move to Python jobs in Actions that write to the same tables.
- The code is public. The data, including notes, ratings, and odds history, stays private in Supabase behind sign-in.
