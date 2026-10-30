/**
 * Odds API quota planning. The free plan is 500 credits/month, so every pull is budgeted:
 *   - skip sports that are out of season or have no games in the look-ahead window (checked with the free /events);
 *   - never go below the reserve;
 *   - spread what's left evenly over the remaining scheduled runs this month;
 *   - when the budget can't cover every sport, prefer the sport whose next game is soonest.
 */
import type { SportKey } from "@bet207/core";

export interface SportDemand { sport: SportKey; nextGame: string | null; inSeason: boolean }
export interface PlanInput {
  now: Date;
  remaining: number | null;     // from the last x-requests-remaining reading (null = unknown)
  reserve: number;
  costPerSport: number;
  runsPerDay: number;
  lookAheadDays: number;
  demand: SportDemand[];
}
export interface Plan { fetch: SportKey[]; skipped: { sport: SportKey; reason: string }[]; budget: number }

export function planOddsPull(p: PlanInput): Plan {
  const skipped: Plan["skipped"] = [];
  const horizon = p.now.getTime() + p.lookAheadDays * 86_400_000;
  const candidates = p.demand
    .filter((d) => {
      if (!d.inSeason) { skipped.push({ sport: d.sport, reason: "out of season" }); return false; }
      if (!d.nextGame || Date.parse(d.nextGame) > horizon) { skipped.push({ sport: d.sport, reason: `no games in the next ${p.lookAheadDays} days` }); return false; }
      return true;
    })
    .sort((a, b) => a.nextGame!.localeCompare(b.nextGame!));

  // Unknown remaining (first run): allow one sport so we learn the real quota from the headers.
  if (p.remaining === null) {
    const first = candidates.shift();
    for (const c of candidates) skipped.push({ sport: c.sport, reason: "quota unknown: one sport first to read the headers" });
    return { fetch: first ? [first.sport] : [], skipped, budget: first ? p.costPerSport : 0 };
  }
  const usable = Math.max(0, p.remaining - p.reserve);
  const end = new Date(Date.UTC(p.now.getUTCFullYear(), p.now.getUTCMonth() + 1, 1));
  const daysLeft = Math.max(1, Math.ceil((end.getTime() - p.now.getTime()) / 86_400_000));
  const budget = Math.max(p.costPerSport, Math.floor(usable / (daysLeft * p.runsPerDay)));
  const fetch: SportKey[] = [];
  let spent = 0;
  for (const c of candidates) {
    if (spent + p.costPerSport > Math.min(budget, usable)) { skipped.push({ sport: c.sport, reason: `budget (${usable} usable credits, ${budget} per run)` }); continue; }
    fetch.push(c.sport); spent += p.costPerSport;
  }
  return { fetch, skipped, budget };
}
