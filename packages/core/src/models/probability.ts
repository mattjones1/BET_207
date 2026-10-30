/**
 * From projections to probabilities. The baseline treats the actual margin (or total) as
 *   X ~ Normal(projection, σ)
 * with σ calibrated from walk-forward residuals (the backtest). On whole-number lines a push is
 * P(line − ½ < X < line + ½) (continuity correction). The backtest compares this against the empirical
 * error distribution; nothing here is shown as expected value until a calibration exists.
 */
import { normCdf } from "./linalg";

export interface SideProbs { pHome: number; pAway: number; pPush: number }

export function spreadProbabilities(projHomeMargin: number, marketHomeMargin: number, sigma: number): SideProbs | null {
  if (!Number.isFinite(projHomeMargin) || !Number.isFinite(marketHomeMargin) || !(sigma > 0)) return null;
  const z = (x: number) => normCdf((x - projHomeMargin) / sigma);
  if (Number.isInteger(marketHomeMargin)) {
    const lo = z(marketHomeMargin - 0.5), hi = z(marketHomeMargin + 0.5);
    return { pHome: 1 - hi, pAway: lo, pPush: hi - lo };
  }
  const c = z(marketHomeMargin);
  return { pHome: 1 - c, pAway: c, pPush: 0 };
}

export function totalProbabilities(projTotal: number, marketTotal: number, sigma: number): { pOver: number; pUnder: number; pPush: number } | null {
  const s = spreadProbabilities(projTotal, marketTotal, sigma);
  return s && { pOver: s.pHome, pUnder: s.pAway, pPush: s.pPush };
}

/**
 * Empirical alternative: P(margin − projection ≤ x) from out-of-sample residuals, with the same push
 * handling. Used by the backtest to compare against the normal baseline.
 */
export function empiricalProbabilities(projHomeMargin: number, marketHomeMargin: number, residuals: number[]): SideProbs | null {
  if (residuals.length < 200) return null;
  const sorted = [...residuals].sort((a, b) => a - b);
  const cdf = (x: number) => {
    // fraction of residuals ≤ x − projection (binary search)
    const v = x - projHomeMargin;
    let lo = 0, hi = sorted.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m]! <= v) lo = m + 1; else hi = m; }
    return lo / sorted.length;
  };
  if (Number.isInteger(marketHomeMargin)) {
    const lo = cdf(marketHomeMargin - 0.5), hi = cdf(marketHomeMargin + 0.5);
    return { pHome: 1 - hi, pAway: lo, pPush: hi - lo };
  }
  const c = cdf(marketHomeMargin);
  return { pHome: 1 - c, pAway: c, pPush: 0 };
}
