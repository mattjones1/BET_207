/**
 * Sign conventions. The single most important file in the project.
 *
 * Internal truth is the HOME MARGIN: homeScore − awayScore. Projections, market lines, and residuals are
 * all expressed on this axis.
 *
 *   homeSpread       the sportsbook spread quoted for the home team. −6.5 means home is favored by 6.5.
 *   marketHomeMargin the margin the market expects for the home team = −homeSpread.
 *   edge             modelHomeMargin − marketHomeMargin. Positive favors home ATS; negative favors away.
 *
 * Provider normalization happens in the adapters, using the helpers below:
 *   nflverse games.csv  spread_line > 0 means home favored → spread_line IS marketHomeMargin.
 *   The Odds API        outcome.point for the home team IS homeSpread.
 *
 * Missing values are null, never 0. A pick'em line is a real 0 and is distinct from "no line".
 */

export type Side = "home" | "away";

/** Sportsbook home spread → market home margin. */
export function marketMarginFromHomeSpread(homeSpread: number | null | undefined): number | null {
  if (homeSpread === null || homeSpread === undefined || !Number.isFinite(homeSpread)) return null;
  return normZero(-homeSpread);
}

/** Market (or model) home margin → the home team's sportsbook spread. */
export function homeSpreadFromMargin(homeMargin: number | null | undefined): number | null {
  if (homeMargin === null || homeMargin === undefined || !Number.isFinite(homeMargin)) return null;
  return normZero(-homeMargin);
}

/** nflverse `spread_line` (positive = home favored) → market home margin. Identity, but named on purpose. */
export function marketMarginFromNflverse(spreadLine: number | null | undefined): number | null {
  if (spreadLine === null || spreadLine === undefined || !Number.isFinite(spreadLine)) return null;
  return normZero(spreadLine);
}

/** Avoid "-0" in output. */
function normZero(n: number): number {
  return n === 0 ? 0 : n;
}

/** Format one spread number the way sportsbooks do: −6.5, +3, PK. */
export function formatSpreadNumber(spread: number): string {
  if (spread === 0) return "PK";
  const s = Math.abs(spread).toFixed(1).replace(/\.0$/, "");
  return spread < 0 ? `−${s}` : `+${s}`;
}

/**
 * Show a home margin as a conventional spread for a team label.
 * +6.5 → "HOME −6.5"; −3 → "HOME +3"; 0 → "HOME PK".
 */
export function formatHomeSpread(homeMargin: number | null, homeLabel = "HOME"): string {
  const spread = homeSpreadFromMargin(homeMargin);
  if (spread === null) return "—";
  return `${homeLabel} ${formatSpreadNumber(spread)}`;
}

/** Show a margin as the favorite's spread: +6.5 with home BUF, away MIA → "BUF −6.5". */
export function formatFavorite(homeMargin: number | null, homeLabel: string, awayLabel: string): string {
  if (homeMargin === null || !Number.isFinite(homeMargin)) return "—";
  if (homeMargin === 0) return "PK";
  return homeMargin > 0 ? `${homeLabel} ${formatSpreadNumber(-homeMargin)}` : `${awayLabel} ${formatSpreadNumber(homeMargin)}`;
}

export interface Edge {
  /** model − market on the home-margin axis. */
  points: number;
  /** Which side the model prefers against the number, or null at exactly 0. */
  favors: Side | null;
}

/** Model-vs-market disagreement. Null when either input is missing. */
export function spreadEdge(modelHomeMargin: number | null, marketHomeMargin: number | null): Edge | null {
  if (modelHomeMargin === null || marketHomeMargin === null) return null;
  if (!Number.isFinite(modelHomeMargin) || !Number.isFinite(marketHomeMargin)) return null;
  const points = round(modelHomeMargin - marketHomeMargin, 2);
  return { points: normZero(points), favors: points > 0 ? "home" : points < 0 ? "away" : null };
}

/** Totals disagreement: positive = model higher than market (leans over). */
export function totalEdge(modelTotal: number | null, marketTotal: number | null): { points: number; lean: "over" | "under" | null } | null {
  if (modelTotal === null || marketTotal === null || !Number.isFinite(modelTotal) || !Number.isFinite(marketTotal)) return null;
  const points = normZero(round(modelTotal - marketTotal, 2));
  return { points, lean: points > 0 ? "over" : points < 0 ? "under" : null };
}

export type AtsResult = "W" | "L" | "P";

/**
 * Grade a spread bet from the perspective of `side`, given the market home margin and the actual home margin.
 * Home covers when actual > marketHomeMargin; push when equal.
 */
export function gradeSpread(side: Side, marketHomeMargin: number, actualHomeMargin: number): AtsResult {
  const diff = actualHomeMargin - marketHomeMargin;
  if (diff === 0) return "P";
  const homeCovers = diff > 0;
  return (side === "home") === homeCovers ? "W" : "L";
}

export function gradeTotal(side: "over" | "under", marketTotal: number, actualTotal: number): AtsResult {
  if (actualTotal === marketTotal) return "P";
  return (side === "over") === actualTotal > marketTotal ? "W" : "L";
}

/** Disagreement buckets used throughout backtesting and the slate. */
export const EDGE_BUCKETS = [
  { key: "lt1", label: "< 1", min: 0, max: 1 },
  { key: "1to2", label: "1 – < 2", min: 1, max: 2 },
  { key: "2to3", label: "2 – < 3", min: 2, max: 3 },
  { key: "3to5", label: "3 – < 5", min: 3, max: 5 },
  { key: "5plus", label: "5 +", min: 5, max: Infinity },
] as const;
export type EdgeBucketKey = (typeof EDGE_BUCKETS)[number]["key"];

export function edgeBucket(absEdge: number): EdgeBucketKey {
  const a = Math.abs(absEdge);
  for (const b of EDGE_BUCKETS) if (a >= b.min && a < b.max) return b.key;
  return "5plus";
}

export function round(n: number, digits = 1): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}
