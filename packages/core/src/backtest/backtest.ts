/**
 * Walk-forward backtest. For each slot (football: Tuesday–Monday week; NBA: Eastern date) the engine refits
 * using ONLY results final before the slot's first start, projects every game in the slot, then grades
 * against the actual result and, when one exists, the stored market line.
 *
 * Honesty rules baked in:
 *  - Lines from results providers are labeled by source. nflverse lines are CLOSING lines: a retrospective
 *    benchmark, not proof the number was available when the projection was made.
 *  - ROI uses a recorded price when one exists; otherwise −110 is ASSUMED and reported separately.
 *  - σ for probabilities in season s comes only from residuals of earlier backtest seasons (out of sample).
 *  - Buckets and breakdowns under MIN_SAMPLE graded games are flagged "insufficient sample".
 */
import { edgeBucket, EDGE_BUCKETS, gradeSpread, gradeTotal, spreadEdge, totalEdge, type AtsResult, type EdgeBucketKey } from "../conventions";
import { unitsFor } from "../odds";
import { RatingEngine } from "../models/engine";
import { isCompleted, type FitGame } from "../models/fit";
import type { ModelParams } from "../models/params";
import { empiricalProbabilities, spreadProbabilities } from "../models/probability";
import { fitEdgeLogistic, type Calibration, type EdgeFit } from "../models/calibration";
import { etDateKey, footballWeekKey } from "./slots";

export const MIN_SAMPLE = 100;
const ASSUMED_PRICE = -110;

export interface BacktestLine {
  gameId: string; marketHomeMargin: number | null; total: number | null;
  homeSpreadPrice: number | null; awaySpreadPrice: number | null; overPrice: number | null; underPrice: number | null;
  source: string;
}

export interface Observation {
  gameId: string; season: number; startTime: string;
  projHomeMargin: number; eloHomeMargin: number | null; projTotal: number;
  actualMargin: number; actualTotal: number;
  marketHomeMargin: number | null; marketTotal: number | null; lineSource: string | null;
  status: string;
  edge: number | null; bucket: EdgeBucketKey | null; side: "home" | "away" | null; favoriteSide: boolean | null;
  ats: AtsResult | null; price: number | null; units: number | null; unitsAssumed: number | null;
  pCover: number | null; pPush: number | null; pCoverEmpirical: number | null; pCoverEdge: number | null;
  totalEdge: number | null; ou: AtsResult | null; ouUnits: number | null; ouUnitsAssumed: number | null;
}

export interface AtsStats {
  graded: number; wins: number; losses: number; pushes: number;
  coverRate: number | null; ci95: [number, number] | null; pushRate: number | null;
  /** Bets with a recorded price, and their result. */
  pricedBets: number; units: number | null; roi: number | null;
  /** Every graded bet at an assumed −110 (labeled as an assumption). */
  roiAssumed: number | null;
  sufficient: boolean;
}

export interface BacktestResult {
  params: ModelParams;
  seasons: number[];
  slot: "week" | "day";
  lineSources: string[];
  games: number;
  accuracy: {
    model: { mae: number; rmse: number }; elo: { mae: number; rmse: number } | null;
    market: { mae: number; rmse: number; n: number } | null;
    blend: { mae: number; rmse: number } | null;
    totals: { mae: number; rmse: number; marketMae: number | null; n: number };
  };
  ats: AtsStats;
  ou: AtsStats;
  buckets: { key: EdgeBucketKey; label: string; stats: AtsStats }[];
  bySeason: { season: number; stats: AtsStats; mae: number }[];
  bySide: { home: AtsStats; away: AtsStats; favorite: AtsStats; underdog: AtsStats };
  calibration: {
    spreadSigma: number | null; totalSigma: number | null; residuals: number;
    brierNormal: number | null; brierEmpirical: number | null; brierEdge: number | null; brierCoinFlip: number | null; n: number;
    /** What production should use: the passing method with the best out-of-sample Brier, fit on all seasons. */
    chosen: Calibration;
    bins: { lo: number; hi: number; n: number; predicted: number; actual: number }[];
  };
  observations: Observation[];
}

/** Wilson score interval for a binomial proportion. */
export function wilson(wins: number, n: number, z = 1.96): [number, number] | null {
  if (n <= 0) return null;
  const p = wins / n, d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d, h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}

export function atsStats(obs: { r: AtsResult | null; units: number | null; assumed: number | null }[]): AtsStats {
  const g = obs.filter((o) => o.r !== null);
  const wins = g.filter((o) => o.r === "W").length, losses = g.filter((o) => o.r === "L").length, pushes = g.filter((o) => o.r === "P").length;
  const decided = wins + losses;
  const priced = g.filter((o) => o.units !== null);
  const units = priced.length ? priced.reduce((s, o) => s + o.units!, 0) : null;
  const assumed = g.reduce((s, o) => s + (o.assumed ?? 0), 0);
  return {
    graded: g.length, wins, losses, pushes,
    coverRate: decided ? wins / decided : null, ci95: wilson(wins, decided), pushRate: g.length ? pushes / g.length : null,
    pricedBets: priced.length, units, roi: priced.length ? units! / priced.length : null,
    roiAssumed: g.length ? assumed / g.length : null,
    sufficient: decided >= MIN_SAMPLE,
  };
}

const err = (xs: number[]) => xs.length ? { mae: xs.reduce((s, x) => s + Math.abs(x), 0) / xs.length, rmse: Math.sqrt(xs.reduce((s, x) => s + x * x, 0) / xs.length) } : { mae: NaN, rmse: NaN };
const rmse = (xs: number[]) => (xs.length ? Math.sqrt(xs.reduce((s, x) => s + x * x, 0) / xs.length) : null);

export function runBacktest(
  games: FitGame[], lines: BacktestLine[], params: ModelParams, opts: { seasons: number[]; slot: "week" | "day" },
): BacktestResult {
  const engine = new RatingEngine(games, params);
  const lineOf = new Map(lines.map((l) => [l.gameId, l]));
  const keyOf = opts.slot === "day" ? etDateKey : footballWeekKey;
  const obs: Observation[] = [];
  const residualsBySeason = new Map<number, number[]>(), totalResidualsBySeason = new Map<number, number[]>();

  for (const season of [...opts.seasons].sort((a, b) => a - b)) {
    const done = games.filter((g) => g.season === season && isCompleted(g));
    const slots = new Map<string, FitGame[]>();
    for (const g of done) (slots.get(keyOf(g.startTime)) ?? slots.set(keyOf(g.startTime), []).get(keyOf(g.startTime))!).push(g);
    // σ from earlier backtest seasons only.
    const prior = [...residualsBySeason.entries()].filter(([s]) => s < season).flatMap(([, r]) => r);
    const priorT = [...totalResidualsBySeason.entries()].filter(([s]) => s < season).flatMap(([, r]) => r);
    const sigma = prior.length >= 200 ? rmse(prior) : null;
    const edgeFit: EdgeFit | null = fitEdgeLogistic(obs.filter((o) => o.season < season && (o.ats === "W" || o.ats === "L") && o.edge !== null)
      .map((o) => ({ absEdge: Math.abs(o.edge!), win: o.ats === "W" })));
    const res: number[] = [], resT: number[] = [];
    for (const key of [...slots.keys()].sort()) {
      const slotGames = slots.get(key)!;
      const asOf = slotGames.map((g) => g.startTime).sort()[0]!;
      const fit = engine.fitAt(season, asOf);
      for (const g of slotGames) {
        const p = engine.project(fit, g);
        const actual = g.homeScore! - g.awayScore!, actualTotal = g.homeScore! + g.awayScore!;
        const L = lineOf.get(g.id);
        const mk = L?.marketHomeMargin ?? null, mt = L?.total ?? null;
        const usable = p.status !== "insufficient";
        const e = usable ? spreadEdge(p.homeMargin, mk) : null;
        const side = e?.favors ?? null;
        const ats = side && mk !== null ? gradeSpread(side, mk, actual) : null;
        const price = side ? (side === "home" ? L?.homeSpreadPrice : L?.awaySpreadPrice) ?? null : null;
        const probs = side && sigma && mk !== null ? spreadProbabilities(p.homeMargin, mk, sigma) : null;
        const emp = side && mk !== null ? empiricalProbabilities(p.homeMargin, mk, prior) : null;
        const te = usable ? totalEdge(p.total, mt) : null;
        const ou = te?.lean && mt !== null ? gradeTotal(te.lean, mt, actualTotal) : null;
        const ouPrice = te?.lean ? (te.lean === "over" ? L?.overPrice : L?.underPrice) ?? null : null;
        if (usable) { res.push(actual - p.homeMargin); resT.push(actualTotal - p.total); }
        obs.push({
          gameId: g.id, season, startTime: g.startTime,
          projHomeMargin: p.homeMargin, eloHomeMargin: p.eloMargin, projTotal: p.total, actualMargin: actual, actualTotal,
          marketHomeMargin: mk, marketTotal: mt, lineSource: L?.source ?? null, status: p.status,
          edge: e?.points ?? null, bucket: e ? edgeBucket(e.points) : null, side,
          favoriteSide: side && mk !== null && mk !== 0 ? (side === "home") === mk > 0 : null,
          ats, price, units: ats ? unitsFor(ats, price) : null, unitsAssumed: ats ? unitsFor(ats, ASSUMED_PRICE) : null,
          pCover: probs ? (side === "home" ? probs.pHome : probs.pAway) : null, pPush: probs?.pPush ?? null,
          pCoverEmpirical: emp ? (side === "home" ? emp.pHome : emp.pAway) : null,
          pCoverEdge: side && edgeFit && e ? (1 / (1 + Math.exp(-(edgeFit.a + edgeFit.b * Math.abs(e.points))))) * (1 - (probs?.pPush ?? 0)) : null,
          totalEdge: te?.points ?? null, ou, ouUnits: ou ? unitsFor(ou, ouPrice) : null, ouUnitsAssumed: ou ? unitsFor(ou, ASSUMED_PRICE) : null,
        });
      }
    }
    residualsBySeason.set(season, res);
    totalResidualsBySeason.set(season, resT);
  }

  const usable = obs.filter((o) => o.status !== "insufficient");
  const pick = (xs: Observation[]) => xs.map((o) => ({ r: o.ats, units: o.units, assumed: o.unitsAssumed }));
  const withLine = usable.filter((o) => o.marketHomeMargin !== null);
  const withElo = usable.filter((o) => o.eloHomeMargin !== null);
  const allRes = [...residualsBySeason.values()].flat(), allResT = [...totalResidualsBySeason.values()].flat();

  // Calibration (out-of-sample σ per season, decided games only): Brier for normal, empirical, and a coin flip.
  const decided = usable.filter((o) => o.ats === "W" || o.ats === "L");
  const brier = (get: (o: Observation) => number | null) => {
    const xs = decided.filter((o) => get(o) !== null);
    return xs.length ? { b: xs.reduce((s, o) => s + (get(o)! / (1 - (o.pPush ?? 0)) - (o.ats === "W" ? 1 : 0)) ** 2, 0) / xs.length, n: xs.length } : null;
  };
  // Compare methods on the same games: those where every method has a probability.
  const both = (o: Observation) => o.pCover !== null && o.pCoverEdge !== null;
  const bn = brier((o) => (both(o) ? o.pCover : null)), be = brier((o) => (both(o) ? o.pCoverEmpirical : null));
  const bd = brier((o) => (both(o) ? o.pCoverEdge : null)), bc = brier((o) => (both(o) ? 0.5 * (1 - (o.pPush ?? 0)) : null));
  const candidates = ([["normal", bn], ["edge", bd]] as const).filter(([, b]) => b && bc && b.n >= 3 * MIN_SAMPLE && b.b < bc.b).sort((x, y) => x[1]!.b - y[1]!.b);
  const finalEdge = fitEdgeLogistic(usable.filter((o) => (o.ats === "W" || o.ats === "L") && o.edge !== null).map((o) => ({ absEdge: Math.abs(o.edge!), win: o.ats === "W" })));
  const chosen: Calibration = {
    method: candidates[0]?.[0] ?? null, sigma: rmse(allRes), edgeFit: finalEdge,
    brier: { normal: bn?.b ?? null, edge: bd?.b ?? null, coinFlip: bc?.b ?? null, n: bc?.n ?? 0 },
    passes: candidates.length > 0,
  };
  const bins: BacktestResult["calibration"]["bins"] = [];
  for (let lo = 0.5; lo < 0.7; lo += 0.025) {
    const inBin = decided.filter((o) => o.pCover !== null && o.pCover / (1 - (o.pPush ?? 0)) >= lo && o.pCover / (1 - (o.pPush ?? 0)) < lo + 0.025);
    if (inBin.length) bins.push({ lo, hi: lo + 0.025, n: inBin.length,
      predicted: inBin.reduce((s, o) => s + o.pCover! / (1 - (o.pPush ?? 0)), 0) / inBin.length,
      actual: inBin.filter((o) => o.ats === "W").length / inBin.length });
  }

  const elo = withElo.length ? err(withElo.map((o) => o.actualMargin - o.eloHomeMargin!)) : null;
  return {
    params, seasons: opts.seasons, slot: opts.slot,
    lineSources: [...new Set(obs.map((o) => o.lineSource).filter(Boolean) as string[])],
    games: usable.length,
    accuracy: {
      model: err(usable.map((o) => o.actualMargin - o.projHomeMargin)),
      elo,
      market: withLine.length ? { ...err(withLine.map((o) => o.actualMargin - o.marketHomeMargin!)), n: withLine.length } : null,
      blend: withElo.length ? err(withElo.map((o) => o.actualMargin - (o.projHomeMargin + o.eloHomeMargin!) / 2)) : null,
      totals: {
        ...err(usable.map((o) => o.actualTotal - o.projTotal)), n: usable.length,
        marketMae: usable.some((o) => o.marketTotal !== null) ? err(usable.filter((o) => o.marketTotal !== null).map((o) => o.actualTotal - o.marketTotal!)).mae : null,
      },
    },
    ats: atsStats(pick(usable)),
    ou: atsStats(usable.map((o) => ({ r: o.ou, units: o.ouUnits, assumed: o.ouUnitsAssumed }))),
    buckets: EDGE_BUCKETS.map((b) => ({ key: b.key, label: b.label, stats: atsStats(pick(usable.filter((o) => o.bucket === b.key))) })),
    bySeason: opts.seasons.map((s) => ({ season: s, stats: atsStats(pick(usable.filter((o) => o.season === s))), mae: err(usable.filter((o) => o.season === s).map((o) => o.actualMargin - o.projHomeMargin)).mae })),
    bySide: {
      home: atsStats(pick(usable.filter((o) => o.side === "home"))), away: atsStats(pick(usable.filter((o) => o.side === "away"))),
      favorite: atsStats(pick(usable.filter((o) => o.favoriteSide === true))), underdog: atsStats(pick(usable.filter((o) => o.favoriteSide === false))),
    },
    calibration: {
      spreadSigma: rmse(allRes), totalSigma: rmse(allResT), residuals: allRes.length,
      brierNormal: bn?.b ?? null, brierEmpirical: be?.b ?? null, brierEdge: bd?.b ?? null, brierCoinFlip: bc?.b ?? null, n: bc?.n ?? 0, bins, chosen,
    },
    observations: obs,
  };
}
