/**
 * rebuild-ratings: a production model run for each sport after results land.
 *   config  = the user's promoted config (Model Lab), else the system default (versioned by content hash)
 *   run     = immutable model_runs row; ratings and projections are inserted under it, never overwritten
 *   calibration = chosen by the newest backtest of this config; sigma is stored only when that calibration
 *                 beat a coin flip out of sample. Otherwise the app shows no P(cover) or EV, and says why.
 */
import { DEFAULT_PARAMS, RatingEngine, SPORT_KEYS, paramsHash, type SportKey } from "@bet207/core";
import { env } from "../lib/env";
import type { Store } from "../store";
import type { Job } from "./context";

export const CODE_VERSION = env("GITHUB_SHA")?.slice(0, 12) ?? "local";

export async function rebuildSport(store: Store, sport: SportKey, now: Date, log: (m: string) => void) {
  const games = await store.fitGames(sport);
  if (!games.length) return { rows: 0, note: "no games stored" };
  const active = await store.activeConfig(sport);
  const params = active?.params ?? DEFAULT_PARAMS[sport];
  const configId = active?.id ?? await store.ensureConfig(sport, "default", params, paramsHash(params), null);
  const cal = await store.calibration(configId);
  const asOf = now.toISOString();
  const runId = await store.startModelRun(configId, CODE_VERSION, asOf);
  try {
    const engine = new RatingEngine(games, params);
    const cur = engine.current(asOf);
    if (!cur) throw new Error("no season to rate");
    const teams = [...cur.fit.ratings.keys()];
    await store.writeRatings(runId, teams.map((t) => ({
      teamId: t, asOf, mov: cur.fit.ratings.get(t)!, off: cur.fit.off.get(t)!, def: cur.fit.def.get(t)!,
      elo: engine.eloNow.get(t) ?? null, gamesUsed: cur.fit.gamesUsed.get(t) ?? 0, uncertainty: cur.fit.uncertainty.get(t) ?? 0,
    })));
    await store.writeProjections(runId, cur.projections.map((p) => ({ ...p, sigma: cal?.passes ? cal.sigma : null })));
    const summary = {
      season: cur.season, hfa: cur.fit.hfa, restCoef: cur.fit.restCoef, mu: cur.fit.mu, residualSd: cur.fit.residualSd,
      teams: teams.length, projections: cur.projections.length, calibrated: !!cal?.passes, calibration: cal,
    };
    await store.finishModelRun(runId, "success", summary);
    log(`${sport}: season ${cur.season}, ${teams.length} teams, ${cur.projections.length} projections; calibration: ${!cal ? "none (run backtest)" : cal.passes ? cal.method : "did not beat a coin flip"}`);
    return { rows: teams.length + cur.projections.length, note: null };
  } catch (e) {
    await store.finishModelRun(runId, "failed", { error: (e as Error).message });
    throw e;
  }
}

export const rebuildRatings: Job = async ({ store, sport, now, log }) => {
  let rows = 0;
  const notes: Record<string, string | null> = {};
  for (const s of sport ? [sport] : SPORT_KEYS) {
    const r = await rebuildSport(store, s, now, log);
    rows += r.rows; notes[s] = r.note;
  }
  return { rows, details: { notes } };
};
