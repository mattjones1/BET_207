/**
 * Elo, run independently of the MOV ratings. Processes games in order and records each team's PRE-game
 * Elo, so every game's Elo projection is naturally out-of-sample.
 *   expected(home) = 1 / (1 + 10^(−(eloH − eloA + hfa·[not neutral]) / 400))
 *   update        = K · movMult · (result − expected),  result 1 / 0.5 / 0
 *   movMult       = ln(|margin| + 1) · 2.2 / (0.001·winnerEloDiff + 2.2)   (dampens favorites' blowouts)
 * At each new season, ratings regress toward 1500 by (1 − carryover).
 */
import type { FitGame } from "./fit";
import { homeFlag } from "./fit";
import type { ModelParams } from "./params";

export interface EloState { ratings: Map<string, number>; season: number | null }
export interface EloPre { home: number; away: number }

export const ELO_MEAN = 1500;

export function eloMargin(pre: EloPre, g: Pick<FitGame, "neutralSite">, p: ModelParams["elo"]): number {
  return (pre.home - pre.away + p.hfa * homeFlag(g)) / p.eloPerPoint;
}

/**
 * Run Elo over completed games in start-time order. Returns final state and the pre-game ratings for every
 * game passed (including unplayed ones, which get the latest ratings and don't update anything).
 */
export function runElo(games: FitGame[], p: ModelParams["elo"], start?: EloState): { state: EloState; pre: Map<string, EloPre> } {
  const state: EloState = { ratings: new Map(start?.ratings ?? []), season: start?.season ?? null };
  const pre = new Map<string, EloPre>();
  const get = (t: string) => state.ratings.get(t) ?? ELO_MEAN;
  for (const g of [...games].sort((a, b) => a.startTime.localeCompare(b.startTime))) {
    if (state.season !== null && g.season !== state.season) {
      for (const [t, r] of state.ratings) state.ratings.set(t, ELO_MEAN + p.carryover * (r - ELO_MEAN));
    }
    state.season = g.season;
    const h = get(g.homeTeamId), a = get(g.awayTeamId);
    pre.set(g.id, { home: h, away: a });
    if (g.homeScore === null || g.awayScore === null) continue;
    const diff = h - a + p.hfa * homeFlag(g);
    const expected = 1 / (1 + Math.pow(10, -diff / 400));
    const margin = g.homeScore - g.awayScore;
    const result = margin > 0 ? 1 : margin < 0 ? 0 : 0.5;
    const winnerDiff = margin > 0 ? diff : margin < 0 ? -diff : 0;
    const mult = p.movMultiplier && margin !== 0 ? Math.log(Math.abs(margin) + 1) * (2.2 / (0.001 * winnerDiff + 2.2)) : 1;
    const delta = p.k * mult * (result - expected);
    state.ratings.set(g.homeTeamId, h + delta);
    state.ratings.set(g.awayTeamId, a - delta);
  }
  return { state, pre };
}
