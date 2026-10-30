# Models

All model code is in `packages/core/src/models/`. The pipeline, the backtest, and the browser (Model Lab, demo) share it.

## Margin-of-victory ratings (`fit.ts`)
This is a weighted ridge regression on the home-margin axis:

```
c·tanh(margin/c) = r_home − r_away + h·[not neutral] + β·clamp(restHome − restAway, ±cap)/cap + ε
weights   w = decayPerWeek^(weeks old)
penalty   priorGames·Σ(r − prior)² + hfaStrength·(h − hfa)² + restStrength·β²
```

- **Priors** are last season's final ratings × `carryover`, centered (`RatingEngine.priorsFor`). Early in a season, a team's rating leans on its prior.
- **Blowouts** are soft-capped by `marginCap`.
- **Neutral sites** get no home term. An unknown site (NBA free tier) is treated as a home game, and the explanation says "assumed".
- **The rest term** is scaled to [−1, 1], so `β` is the points for a full rest edge.
- **Look-ahead guard:** `fitRatings` throws if given a result with `finalAt ≥ asOf`.

## Totals (experimental)
A points ridge model with two observations per game:

- `homePts = μ + off_home + def_away + η/2`
- `awayPts = μ + off_away + def_home − η/2`

The projected total is `2μ + off_h + def_a + off_a + def_h`, and the parts are shown exactly. This model is labeled experimental: on NFL 2012–2025 its error is clearly worse than the market's (13.0 vs 10.5 points per game).

## Elo (`elo.ts`)
- An independent rating, using pre-game ratings only, so every Elo projection is out of sample.
- K-factor, home advantage in Elo points, and a margin-of-victory multiplier with favorite dampening.
- Ratings regress toward 1500 each season.
- Margin projection = Elo difference ÷ `eloPerPoint`.
- Elo is **not blended** with the MOV ratings. The backtest reports a 50/50 blend only for comparison.

## Projections and explanations (`engine.ts`)
- `homeMargin = rating gap + home term + rest term`. These parts sum exactly, and the game page shows them.
- **Status:**
  - `insufficient`: a team has no games and no prior;
  - `experimental`: under `minGames` games this season;
  - otherwise `ok`.

## Probabilities (`probability.ts`, `calibration.ts`)
- **Normal(σ)**, with a continuity correction for pushes on whole-number lines.
- **Disagreement-fitted logistic:** a fit of P(cover) against |edge| on earlier seasons' graded games.
- **Selection:** the backtest picks the method with the best out-of-sample Brier score, and it must beat a coin flip on at least 300 games.
- **If no method passes, the app shows no P(cover) and no EV.**
- EV uses only real prices: `pWin·(dec − 1) − pLoss`, and a push returns the stake.

## Versioning
- `ModelParams` are hashed (`paramsHash`, keys sorted).
- `model_configs` rows are immutable; a change is a new version.
- Each production run is a new `model_runs` row, and earlier predictions are never overwritten.
- Promoting a config sets `user_settings.prefs.activeConfig[sport]`, and the pipeline uses it from then on.

## Measured baseline: NFL defaults, walk-forward 2012–2025, closing lines
| | MAE | ATS (model's side) |
|---|---|---|
| Model | 10.32 | 1,841–1,890–93, **49.3%** [47.7, 50.9] |
| Elo | 10.31 | — |
| Closing line | 9.97 | — |

**No disagreement bucket beat break-even, and no probability method beat a coin flip.** The default model shows no edge against closing lines. This is the honest starting point that the Model Lab exists to improve on, with out-of-sample discipline.
