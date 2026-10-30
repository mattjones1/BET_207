# Pipeline

`npm run pipeline -- <job> [--sport nfl|ncaaf|nba] [--seasons 2019-2025] [--current] [--dry-run]`

| Job | Source | Default scope | Cost |
|---|---|---|---|
| `sync-nfl` | nflverse games.csv and teams (no key) | every season since 1999 (`--current` for this season) | free |
| `sync-ncaaf` | CFBD `/teams/fbs`, `/games`, `/lines` | current season | 3 calls per season (of 1,000 a month) |
| `sync-nba` | BALLDONTLIE `/games` | current season | about 15 calls per season at 5 a minute (about 3 minutes) |
| `sync-odds` | The Odds API `/events` (free), then `/odds` | in-season sports with games in the next 7 days, within budget | 3 credits per sport (h2h, spreads, totals × us) |
| `export-demo` | nflverse | last 3 seasons, written to `fixtures/demo/nfl.json` | free |

- **`--dry-run`** calls the providers but writes to an in-memory store (nothing reaches Supabase).
- **Every run** writes a `pipeline_runs` row: success, failed (with the error), or skipped (with the reason). Quota readings go to `api_quota`.

## First-time backfill (after docs/SETUP.md)
```
npm run pipeline -- sync-nfl                          # ~7,500 games, ~7,400 closing lines
npm run pipeline -- sync-ncaaf --seasons 2014-2026    # ~39 CFBD calls
# NBA is slow on the free tier (5 requests a minute). Run it in GitHub Actions: Actions → Ingest data → Run workflow,
#   job: sync-nba, args: --seasons 2015-2025   (~35 minutes)
```

## Rules the jobs follow
- **Idempotent:** games upsert on (provider, provider_event_id); results on game; lines on (game, provider, type, book); odds snapshots insert-if-absent on (game, book, market, source update time).
- **Nothing is deleted.** A failed run leaves the previous data in place.
- **Odds budget** (`src/quota.ts`): usable credits = remaining − reserve (`ODDS_API_RESERVE`, default 60), spread evenly over the scheduled runs left this month. Sports with the soonest games go first. A sport is skipped when it's out of season or has no games within 7 days.
- **Event matching:** an Odds API event links to our game only when both team names resolve through `team_aliases` and the start is within 36 hours. A home/away reversal is refused, to protect spread signs. Unmatched events are listed in the run's details.
- **CFBD spread sign** is verified per line against `formattedSpread`. Disagreeing lines are skipped and reported.
