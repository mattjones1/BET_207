# Data sources (verified October 30, 2026)

| Source | Use | Access | Gotchas |
|---|---|---|---|
| **The Odds API** v4 | Live spreads, totals, and moneylines by book | Free plan: 500 credits a month. `GET /v4/sports/{key}/odds?regions=us&markets=h2h,spreads,totals&oddsFormat=american` | Cost = markets × regions. `/sports` and `/events` are free, and empty responses are free. Quota headers: `x-requests-remaining`, `x-requests-used`, `x-requests-last`. **Historical odds are paid-only.** The bookmaker-level `last_update` is deprecated; use the market-level one. Sport keys: `americanfootball_nfl`, `americanfootball_ncaaf`, `basketball_nba`. |
| **nflverse** `games.csv` | NFL schedule, results, rest, venue, and closing lines with prices | Free, no key, CC-BY-4.0. https://github.com/nflverse/nfldata/raw/master/data/games.csv | **`spread_line` > 0 means the home team is favored** (it equals the market home margin). `result` = home − away. `location` is Home or Neutral. Lines cover every season from 1999; spread and total prices from at least 2018. These are **closing lines** (a retrospective benchmark). `gametime` is Eastern time. |
| **CollegeFootballData** | FBS schedule, results, lines, stats | Free key: 1,000 calls a month. Bearer auth. `X-CallLimit-Remaining` header | One call per season per endpoint. **Verify the `/lines` spread sign against `formattedSpread` before use**; coverage varies by provider and season. |
| **BALLDONTLIE** | NBA teams, games, scores | Free: 5 requests a minute. Header `Authorization: <key>` (no "Bearer"). `GET /v1/games?seasons[]=&per_page=100&cursor=` | The free tier has no odds, box scores, injuries, or advanced stats. No neutral-site flag (stored as `null`, unknown). |

**NBA market backtesting is forward-only** (the user's decision): no free source of historical NBA lines exists. Accuracy backtests use free results now; market comparisons accumulate from our own snapshots.
