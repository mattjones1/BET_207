/**
 * Price math. American odds are the storage format (that's what the providers return).
 * Every function returns null for missing or invalid input instead of guessing.
 */

const ok = (n: number | null | undefined): n is number => n !== null && n !== undefined && Number.isFinite(n);

/** Valid American odds are ≥ +100 or ≤ −100. */
export function isAmerican(odds: number | null | undefined): odds is number {
  return ok(odds) && (odds >= 100 || odds <= -100);
}

export function americanToDecimal(odds: number | null | undefined): number | null {
  if (!isAmerican(odds)) return null;
  return odds > 0 ? 1 + odds / 100 : 1 + 100 / -odds;
}

export function decimalToAmerican(dec: number | null | undefined): number | null {
  if (!ok(dec) || dec <= 1) return null;
  return dec >= 2 ? Math.round((dec - 1) * 100) : Math.round(-100 / (dec - 1));
}

/** Implied probability including the vig (also the break-even win rate when pushes refund). */
export function impliedProbability(odds: number | null | undefined): number | null {
  const d = americanToDecimal(odds);
  return d === null ? null : 1 / d;
}

/** Break-even win probability among graded (non-push) bets at these odds. */
export const breakEven = impliedProbability;

/**
 * Remove the vig from a two-way market (multiplicative normalization).
 * Returns fair probabilities for side A and side B, or null when either price is missing.
 */
export function noVigTwoWay(oddsA: number | null | undefined, oddsB: number | null | undefined): { a: number; b: number; overround: number } | null {
  const pa = impliedProbability(oddsA), pb = impliedProbability(oddsB);
  if (pa === null || pb === null) return null;
  const sum = pa + pb;
  return { a: pa / sum, b: pb / sum, overround: sum - 1 };
}

/**
 * Expected return per 1 unit staked. A push returns the stake (0 profit).
 * pWin + pPush + pLoss must be ≤ 1; pLoss is derived.
 */
export function expectedValue(pWin: number | null, odds: number | null | undefined, pPush = 0): number | null {
  const d = americanToDecimal(odds);
  if (d === null || pWin === null || !Number.isFinite(pWin) || pWin < 0 || pPush < 0 || pWin + pPush > 1 + 1e-9) return null;
  const pLoss = 1 - pWin - pPush;
  return pWin * (d - 1) - pLoss;
}

/** Profit in units for a graded bet of 1 unit. */
export function unitsFor(result: "W" | "L" | "P", odds: number | null | undefined): number | null {
  if (result === "P") return 0;
  const d = americanToDecimal(odds);
  if (d === null) return null;
  return result === "W" ? d - 1 : -1;
}

export function formatAmerican(odds: number | null | undefined): string {
  if (!isAmerican(odds)) return "—";
  return odds > 0 ? `+${odds}` : `−${Math.abs(odds)}`;
}
