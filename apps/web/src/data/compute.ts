/** Engine-only model helpers (no Supabase), safe to load in the Web Worker. */
import { RatingEngine, paramsHash, type Calibration, type Explanation, type FitGame, type ModelParams, type ProjectionStatus } from "@bet207/core";

export interface TeamRating { teamId: string; mov: number; off: number; def: number; elo: number | null; gamesUsed: number; uncertainty: number }
export interface GameProjection {
  gameId: string; homeMargin: number; total: number; eloMargin: number | null; sigma: number | null;
  status: ProjectionStatus; statusReason: string | null; explanation: Explanation | null;
}
export interface ModelData {
  source: "run" | "demo";
  runId: string | null;
  configLabel: string;
  paramsHash: string;
  params: ModelParams | null;
  finishedAt: string | null;
  summary: { season?: number; hfa?: number; restCoef?: number; mu?: number; residualSd?: number; calibrated?: boolean };
  /** From the newest backtest of this config. null = no backtest yet. */
  calibration: Calibration | null;
  ratings: Map<string, TeamRating>;
  projections: Map<string, GameProjection>;
}

export function toFitGames(games: { id: string; season: number; startTime: string; homeTeamId: string; awayTeamId: string; neutralSite: boolean | null;
  homeRest: number | null; awayRest: number | null; homeScore: number | null; awayScore: number | null; finalAt?: string | null }[], hoursToFinal = 3.5): FitGame[] {
  return games.map((g) => ({
    id: g.id, season: g.season, startTime: g.startTime, homeTeamId: g.homeTeamId, awayTeamId: g.awayTeamId, neutralSite: g.neutralSite,
    homeRest: g.homeRest, awayRest: g.awayRest, homeScore: g.homeScore, awayScore: g.awayScore,
    finalAt: g.homeScore === null ? null : g.finalAt ?? new Date(Date.parse(g.startTime) + hoursToFinal * 3_600_000).toISOString(),
  }));
}

/** Run the engine in-process (demo mode and Model Lab previews). */
export function computeModel(games: FitGame[], params: ModelParams, asOf: string, label: string): ModelData {
  const engine = new RatingEngine(games, params);
  const cur = engine.current(asOf);
  const ratings = new Map<string, TeamRating>(), projections = new Map<string, GameProjection>();
  if (cur) {
    for (const t of cur.fit.ratings.keys()) ratings.set(t, {
      teamId: t, mov: cur.fit.ratings.get(t)!, off: cur.fit.off.get(t)!, def: cur.fit.def.get(t)!, elo: engine.eloNow.get(t) ?? null,
      gamesUsed: cur.fit.gamesUsed.get(t) ?? 0, uncertainty: cur.fit.uncertainty.get(t) ?? 0,
    });
    for (const p of cur.projections) projections.set(p.gameId, {
      gameId: p.gameId, homeMargin: p.homeMargin, total: p.total, eloMargin: p.eloMargin, sigma: null,
      status: p.status, statusReason: p.statusReason, explanation: p.explanation,
    });
  }
  return {
    source: "demo", runId: null, configLabel: label, paramsHash: paramsHash(params), params, finishedAt: asOf, ratings, projections, calibration: null,
    summary: cur ? { season: cur.season, hfa: cur.fit.hfa, restCoef: cur.fit.restCoef, mu: cur.fit.mu, residualSd: cur.fit.residualSd, calibrated: false } : {},
  };
}

