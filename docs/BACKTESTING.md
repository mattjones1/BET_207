# Backtesting

`packages/core/src/backtest/backtest.ts` (`runBacktest`) runs in the pipeline (`npm run pipeline -- backtest [--sport nfl] [--seasons 2012-2025]`) and in the browser (the Backtesting page and the Model Lab).

## Method
- **Walk-forward slots:** football uses Tuesday-to-Monday weeks (Eastern); the NBA uses Eastern dates.
- For each slot, the engine refits using only results final before the slot's first start, projects every game in the slot, and grades them.
- **Priors:** a season's prior comes from the previous season's final fit, which is also out of sample for the season being tested.
- **σ** for season *s* comes only from residuals of earlier backtest seasons. The probability calibration is fit the same way.
- **Look-ahead:** tests change future results and check that earlier projections are identical.

## Line sources (always labeled)
| Source | Meaning |
|---|---|
| `nflverse:closing` | NFL closing lines and prices. A **retrospective benchmark**: not proof the number was available when the projection would have been made. |
| `cfbd:provider <book>` | CFBD lines, preferring "consensus". Timing isn't guaranteed. |
| (none) | NBA (forward-only): accuracy only until our own snapshots build a history. |

## Measures
- MAE and RMSE for the model, Elo, a 50/50 blend (comparison only), and the market; totals MAE.
- ATS on the model's side: record, pushes, cover rate, and a Wilson 95% interval.
- O/U on the model's lean.
- ROI on **recorded prices** where they exist, plus a separate figure at an **assumed −110**.
- Disagreement buckets: <1, 1–<2, 2–<3, 3–<5, and 5+ points.
- Breakdowns by season, home/away, and favorite/underdog. Comparisons across model versions happen in the Model Lab.
- Brier scores (normal, disagreement-fitted, coin flip) and reliability bins.
- **Fewer than 100 decided games** in any group is flagged "insufficient sample".
- The report never says "profitable". It says whether the 95% interval clears the −110 break-even rate (52.4%), and calls that evidence worth testing further, not proof.
