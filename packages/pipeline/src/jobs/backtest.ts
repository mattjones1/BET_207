/**
 * backtest: walk-forward evaluation of the production config for a sport, stored with every observation.
 * Default seasons: every season that has market lines, except the first two (they seed priors) and the
 * current one (incomplete). NBA has no free historical lines, so its backtest is accuracy-only (MAE, RMSE,
 * straight-up) until our own snapshots accumulate.
 */
import { DEFAULT_PARAMS, SPORT_KEYS, currentSeason, paramsHash, runBacktest, type BacktestLine, type SportKey } from "@bet207/core";
import type { Store } from "../store";
import type { Job } from "./context";
import { CODE_VERSION } from "./model";
import { SupabaseLines } from "./lines";

export async function backtestSport(store: Store, lines: SupabaseLines | null, sport: SportKey, seasons: number[], now: Date, log: (m: string) => void) {
  const games = await store.fitGames(sport);
  if (!games.length) return { rows: 0, note: "no games stored" };
  const hist: BacktestLine[] = lines ? await lines.forSport(sport) : [];
  const allSeasons = [...new Set(games.map((g) => g.season))].sort((a, b) => a - b);
  const withLines = new Set(hist.map((l) => games.find((g) => g.id === l.gameId)?.season));
  const cur = currentSeason(sport, now);
  const chosen = seasons.length ? seasons : allSeasons.slice(2).filter((s) => s < cur && (withLines.has(s) || sport === "nba"));
  if (!chosen.length) return { rows: 0, note: "no complete seasons to test" };
  const active = await store.activeConfig(sport);
  const params = active?.params ?? DEFAULT_PARAMS[sport];
  const configId = active?.id ?? await store.ensureConfig(sport, "default", params, paramsHash(params), null);
  const t = Date.now();
  const res = runBacktest(games, hist, params, { seasons: chosen, slot: sport === "nba" ? "day" : "week" });
  const { observations, ...summary } = res;
  await store.writeBacktest(configId, sport, CODE_VERSION, summary, observations);
  const c = summary.calibration.chosen;
  log(`${sport}: ${chosen[0]}–${chosen.at(-1)}, ${summary.games} games in ${((Date.now() - t) / 1000).toFixed(1)}s; ATS ${summary.ats.wins}-${summary.ats.losses}-${summary.ats.pushes}; calibration ${c.passes ? c.method : "none passed"}`);
  return { rows: observations.length, note: null };
}

export const backtest: Job = async ({ store, sport, seasons, now, log, dryRun }) => {
  const lines = dryRun ? null : new SupabaseLines();
  let rows = 0;
  for (const s of sport ? [sport] : SPORT_KEYS) rows += (await backtestSport(store, lines, s, seasons, now, log)).rows;
  return { rows };
};
