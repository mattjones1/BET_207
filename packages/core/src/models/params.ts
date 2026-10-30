/**
 * Model parameters. Every value is editable in the Model Lab; a change makes a new immutable version.
 * Defaults are reasonable starting points from public sports-analytics practice, NOT validated values:
 * the backtest is what earns a configuration any trust.
 */
import type { SportKey } from "../sports";
import { hash53, stableStringify } from "./linalg";

export interface ModelParams {
  schema: 1;
  /** Home advantage in points (the ridge prior for the fitted home term). */
  hfa: number;
  /** How firmly the home term is held at `hfa` (in games of evidence). Large = effectively fixed. */
  hfaStrength: number;
  /** Weight multiplier per week of age (1 = no recency weighting). */
  decayPerWeek: number;
  /** Soft cap on scoring margin: c·tanh(m/c). Smaller = blowouts count less. */
  marginCap: number;
  /** Shrinkage toward the prior rating, in games of evidence. Larger = slower to move early in a season. */
  priorGames: number;
  /** Share of last season's final rating carried into this season (0 = start everyone even). */
  carryover: number;
  /** Fit a points-per-rest-day term. */
  useRest: boolean;
  /** Rest differences beyond this many days count as this many (the rest term's full effect). */
  restCap: number;
  /** Shrinkage of the rest term toward 0 (games of evidence). */
  restStrength: number;
  /** Teams with fewer games than this get "insufficient" projections. */
  minGames: number;
  elo: { k: number; hfa: number; carryover: number; eloPerPoint: number; movMultiplier: boolean };
  totals: { priorGames: number; carryover: number };
}

export const DEFAULT_PARAMS: Record<SportKey, ModelParams> = {
  nfl: {
    schema: 1, hfa: 1.8, hfaStrength: 60, decayPerWeek: 0.98, marginCap: 21, priorGames: 4, carryover: 0.6,
    useRest: true, restCap: 7, restStrength: 40, minGames: 3,
    elo: { k: 20, hfa: 48, carryover: 0.67, eloPerPoint: 25, movMultiplier: true },
    totals: { priorGames: 4, carryover: 0.5 },
  },
  ncaaf: {
    schema: 1, hfa: 2.5, hfaStrength: 60, decayPerWeek: 0.98, marginCap: 28, priorGames: 3, carryover: 0.6,
    useRest: true, restCap: 7, restStrength: 40, minGames: 4,
    elo: { k: 25, hfa: 55, carryover: 0.67, eloPerPoint: 25, movMultiplier: true },
    totals: { priorGames: 3, carryover: 0.5 },
  },
  nba: {
    schema: 1, hfa: 2.3, hfaStrength: 150, decayPerWeek: 0.97, marginCap: 25, priorGames: 12, carryover: 0.65,
    useRest: true, restCap: 2, restStrength: 150, minGames: 8,
    elo: { k: 20, hfa: 70, carryover: 0.75, eloPerPoint: 28, movMultiplier: true },
    totals: { priorGames: 12, carryover: 0.6 },
  },
};

export function paramsHash(p: ModelParams): string {
  return hash53(stableStringify(p));
}

/** Describe what changed between two parameter sets (for version notes). */
export function paramsDiff(a: ModelParams, b: ModelParams, prefix = ""): string[] {
  const out: string[] = [];
  for (const k of Object.keys({ ...a, ...b }) as (keyof ModelParams)[]) {
    const x = a[k] as unknown, y = b[k] as unknown;
    if (x && y && typeof x === "object") out.push(...paramsDiff(x as ModelParams, y as ModelParams, `${prefix}${k}.`));
    else if (x !== y) out.push(`${prefix}${k}: ${String(x)} → ${String(y)}`);
  }
  return out;
}
