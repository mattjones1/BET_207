/**
 * Margin-of-victory power ratings and opponent-adjusted scoring (for totals), by weighted ridge regression.
 *
 * MOV model, for each completed game g (home-margin axis):
 *     c·tanh(m_g / c)  =  r_home − r_away  +  h·[not neutral]  +  β·clamp(restHome − restAway, ±cap)/cap  +  ε
 *   weights  w_g = decayPerWeek ^ (age in weeks)
 *   penalty  priorGames·Σ(r_t − prior_t)²  +  hfaStrength·(h − hfa)²  +  restStrength·β²
 *   (the rest edge is scaled to [−1, 1], so β is "points for the largest rest edge" and its penalty is on the
 *   same scale as the others)
 * Priors are last season's final ratings × carryover, so early-season estimates shrink toward them.
 *
 * Points model (totals), two observations per game:
 *     homePts = μ + o_home + d_away + η/2      awayPts = μ + o_away + d_home − η/2
 *   o = points scored above average, d = points allowed above average (positive = worse defense).
 *
 * LOOK-AHEAD GUARD: fits only use games whose result was known (finalAt) before `asOf`. Passing a game
 * with finalAt >= asOf throws, so a caller can't leak the future by accident.
 */
import type { ModelParams } from "./params";
import { solveSpd } from "./linalg";

export interface FitGame {
  id: string;
  season: number;
  startTime: string;
  finalAt: string | null;
  homeTeamId: string;
  awayTeamId: string;
  neutralSite: boolean | null;
  homeRest: number | null;
  awayRest: number | null;
  homeScore: number | null;
  awayScore: number | null;
}

export interface TeamPrior { rating: number; off: number; def: number }

export interface Fit {
  asOf: string;
  ratings: Map<string, number>;
  off: Map<string, number>;
  def: Map<string, number>;
  /** Fitted home advantage (points) and rest coefficient (points at the full rest cap). */
  hfa: number;
  restCoef: number;
  /** League scoring baseline per team per game, and fitted home scoring edge. */
  mu: number;
  homePts: number;
  gamesUsed: Map<string, number>;
  /** Approximate posterior SD of each rating (points). */
  uncertainty: Map<string, number>;
  /** Weighted residual SD of the (capped) margin fit. */
  residualSd: number;
}

const WEEK = 7 * 86_400_000;
const clamp = (x: number, c: number) => Math.max(-c, Math.min(c, x));

export function isCompleted(g: FitGame): boolean {
  return g.homeScore !== null && g.awayScore !== null && g.finalAt !== null;
}

/** Home rest edge in [−1, 1]: (home − away rest days) clamped to ±cap, divided by cap. Unknown rest → 0. */
export function restEdge(g: Pick<FitGame, "homeRest" | "awayRest">, cap: number): number {
  return g.homeRest === null || g.awayRest === null || !(cap > 0) ? 0 : clamp(g.homeRest - g.awayRest, cap) / cap;
}

/** Home field applies unless the site is neutral. Unknown (null) is treated as a home game. */
export const homeFlag = (g: Pick<FitGame, "neutralSite">) => (g.neutralSite === true ? 0 : 1);

export function fitRatings(
  games: FitGame[], teams: string[], params: ModelParams, asOf: string, priors: Map<string, TeamPrior> = new Map(),
): Fit {
  const t0 = Date.parse(asOf);
  const used = games.filter(isCompleted);
  for (const g of used) {
    if (Date.parse(g.finalAt!) >= t0) throw new Error(`Look-ahead: game ${g.id} finished at ${g.finalAt}, after the fit time ${asOf}.`);
  }
  const idx = new Map(teams.map((t, i) => [t, i]));
  const n = teams.length;
  const weight = (g: FitGame) => Math.pow(params.decayPerWeek, Math.max(0, (t0 - Date.parse(g.startTime)) / WEEK));
  const gamesUsed = new Map(teams.map((t) => [t, 0]));

  // ───── MOV: unknowns [r_0..r_{n-1}, h, β] ─────
  const N = n + 2, H = n, B = n + 1;
  const A = new Float64Array(N * N), b = new Float64Array(N);
  const c = params.marginCap;
  for (const g of used) {
    const i = idx.get(g.homeTeamId), j = idx.get(g.awayTeamId);
    if (i === undefined || j === undefined) continue;
    gamesUsed.set(g.homeTeamId, gamesUsed.get(g.homeTeamId)! + 1);
    gamesUsed.set(g.awayTeamId, gamesUsed.get(g.awayTeamId)! + 1);
    const w = weight(g);
    const y = c * Math.tanh((g.homeScore! - g.awayScore!) / c);
    const x: [number, number][] = [[i, 1], [j, -1], [H, homeFlag(g)], [B, params.useRest ? restEdge(g, params.restCap) : 0]];
    for (const [p, xp] of x) {
      if (!xp) continue;
      b[p] = b[p]! + w * xp * y;
      for (const [q, xq] of x) if (xq) A[p * N + q] = A[p * N + q]! + w * xp * xq;
    }
  }
  for (let t = 0; t < n; t++) {
    A[t * N + t] = A[t * N + t]! + params.priorGames;
    b[t] = b[t]! + params.priorGames * (priors.get(teams[t]!)?.rating ?? 0);
  }
  A[H * N + H] = A[H * N + H]! + params.hfaStrength; b[H] = b[H]! + params.hfaStrength * params.hfa;
  A[B * N + B] = A[B * N + B]! + params.restStrength;
  const sol = solveSpd(A, b, N);

  // Residual SD and approximate rating uncertainty.
  let ss = 0, sw = 0;
  for (const g of used) {
    const i = idx.get(g.homeTeamId), j = idx.get(g.awayTeamId);
    if (i === undefined || j === undefined) continue;
    const w = weight(g);
    const pred = sol[i]! - sol[j]! + sol[H]! * homeFlag(g) + sol[B]! * (params.useRest ? restEdge(g, params.restCap) : 0);
    const r = c * Math.tanh((g.homeScore! - g.awayScore!) / c) - pred;
    ss += w * r * r; sw += w;
  }
  const residualSd = sw > 0 ? Math.sqrt(ss / sw) : NaN;
  const sdFor = Number.isFinite(residualSd) && residualSd > 0 ? residualSd : 12;

  // ───── Points: unknowns [o_0.., d_0.., μ, η] ─────
  const M = 2 * n + 2, MU = 2 * n, ETA = 2 * n + 1;
  const P = new Float64Array(M * M), q = new Float64Array(M);
  const add = (cols: [number, number][], y: number, w: number) => {
    for (const [p, xp] of cols) {
      q[p] = q[p]! + w * xp * y;
      for (const [r, xr] of cols) P[p * M + r] = P[p * M + r]! + w * xp * xr;
    }
  };
  for (const g of used) {
    const i = idx.get(g.homeTeamId), j = idx.get(g.awayTeamId);
    if (i === undefined || j === undefined) continue;
    const w = weight(g), hf = homeFlag(g);
    add([[i, 1], [n + j, 1], [MU, 1], [ETA, hf * 0.5]], g.homeScore!, w);
    add([[j, 1], [n + i, 1], [MU, 1], [ETA, -hf * 0.5]], g.awayScore!, w);
  }
  const tp = params.totals.priorGames;
  for (let t = 0; t < n; t++) {
    const pr = priors.get(teams[t]!);
    P[t * M + t] = P[t * M + t]! + tp; q[t] = q[t]! + tp * (pr?.off ?? 0);
    P[(n + t) * M + n + t] = P[(n + t) * M + n + t]! + tp; q[n + t] = q[n + t]! + tp * (pr?.def ?? 0);
  }
  P[MU * M + MU] = P[MU * M + MU]! + 1e-6;                 // μ is identified by the data; tiny ridge for stability
  P[ETA * M + ETA] = P[ETA * M + ETA]! + params.hfaStrength; q[ETA] = q[ETA]! + params.hfaStrength * params.hfa;
  const pts = used.length ? solveSpd(P, q, M) : new Float64Array(M);

  return {
    asOf,
    ratings: new Map(teams.map((t, k) => [t, sol[k]!])),
    off: new Map(teams.map((t, k) => [t, pts[k]!])),
    def: new Map(teams.map((t, k) => [t, pts[n + k]!])),
    hfa: sol[H]!, restCoef: sol[B]!, mu: pts[MU]!, homePts: pts[ETA]!,
    gamesUsed,
    uncertainty: new Map(teams.map((t, k) => [t, sdFor / Math.sqrt(A[k * N + k]!)])),
    residualSd,
  };
}

/** Next season's priors: carryover × (final rating − league mean), so priors stay centered. */
export function carryPriors(fit: Fit, params: ModelParams): Map<string, TeamPrior> {
  const mean = (m: Map<string, number>) => { const v = [...m.values()]; return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0; };
  const mr = mean(fit.ratings), mo = mean(fit.off), md = mean(fit.def);
  const out = new Map<string, TeamPrior>();
  for (const t of fit.ratings.keys()) {
    out.set(t, {
      rating: params.carryover * (fit.ratings.get(t)! - mr),
      off: params.totals.carryover * (fit.off.get(t)! - mo),
      def: params.totals.carryover * (fit.def.get(t)! - md),
    });
  }
  return out;
}
