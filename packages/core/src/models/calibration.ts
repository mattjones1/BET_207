/**
 * Probability calibration, chosen by out-of-sample evidence.
 *
 *   normal   P(cover) from X ~ N(projection, σ). Treats the model as if it were the whole truth; usually
 *            overconfident when the market is better informed than the model.
 *   edge     P(cover | |edge|) = logistic(a + b·|edge|), fit on graded games from EARLIER seasons. It learns
 *            how often the model's side has actually covered at each size of disagreement — if the answer is
 *            "about half", the probability stays near 50%, which is the honest output.
 *
 * A method is only "passing" when its Brier score beats a coin flip on enough out-of-sample games.
 */
import { spreadProbabilities } from "./probability";

export interface EdgeFit { a: number; b: number; n: number }

/** Logistic regression of win (1) / loss (0) on |edge| by Newton's method (2 parameters, small ridge). */
export function fitEdgeLogistic(rows: { absEdge: number; win: boolean }[]): EdgeFit | null {
  if (rows.length < 300) return null;
  let a = 0, b = 0;
  for (let it = 0; it < 25; it++) {
    let ga = 0, gb = 0, haa = 1e-6, hab = 0, hbb = 1e-3;
    for (const r of rows) {
      const p = 1 / (1 + Math.exp(-(a + b * r.absEdge)));
      const y = r.win ? 1 : 0, w = p * (1 - p);
      ga += y - p; gb += (y - p) * r.absEdge;
      haa += w; hab += w * r.absEdge; hbb += w * r.absEdge * r.absEdge;
    }
    gb -= 1e-3 * b;
    const det = haa * hbb - hab * hab;
    const da = (hbb * ga - hab * gb) / det, db = (haa * gb - hab * ga) / det;
    a += da; b += db;
    if (Math.abs(da) + Math.abs(db) < 1e-9) break;
  }
  return { a, b, n: rows.length };
}

export type CalibrationMethod = "normal" | "edge";
export interface Calibration {
  method: CalibrationMethod | null;   // null = nothing passed: show no P(cover) or EV
  sigma: number | null;
  edgeFit: EdgeFit | null;
  brier: { normal: number | null; edge: number | null; coinFlip: number | null; n: number };
  passes: boolean;
}

/**
 * Probability that the side the model prefers covers, with push probability, by the calibrated method.
 * Returns null when there's no passing calibration.
 */
export function coverProbability(cal: Calibration | null, projHomeMargin: number, marketHomeMargin: number): { side: "home" | "away"; p: number; pPush: number } | null {
  if (!cal?.passes || !cal.method) return null;
  const edge = projHomeMargin - marketHomeMargin;
  if (edge === 0) return null;
  const side = edge > 0 ? "home" : "away";
  // Push probability always comes from the margin distribution (a property of the line, not the edge).
  const normal = cal.sigma ? spreadProbabilities(projHomeMargin, marketHomeMargin, cal.sigma) : null;
  const pPush = normal?.pPush ?? 0;
  if (cal.method === "normal" && normal) return { side, p: side === "home" ? normal.pHome : normal.pAway, pPush };
  if (cal.method === "edge" && cal.edgeFit) {
    const pDecided = 1 / (1 + Math.exp(-(cal.edgeFit.a + cal.edgeFit.b * Math.abs(edge))));
    return { side, p: pDecided * (1 - pPush), pPush };
  }
  return null;
}
