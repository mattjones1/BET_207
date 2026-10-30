/**
 * Matchup context computed from stored games. Only facts from the schedule and results: no invented
 * injuries or scouting. Everything takes a `before` cutoff so nothing after the game leaks in.
 */
import { marketFromSnapshots, type OddsSnapshot, type SportKey } from "@bet207/core";
import type { GameRow } from "./source";

const done = (g: GameRow, before: string) => g.homeScore !== null && g.awayScore !== null && g.startTime < before;

export interface FormEntry { gameId: string; date: string; opponentId: string; home: boolean; neutral: boolean | null; for: number; against: number; result: "W" | "L" | "T" }

export function recentForm(teamId: string, games: GameRow[], before: string, n = 5): FormEntry[] {
  return games.filter((g) => done(g, before) && (g.homeTeamId === teamId || g.awayTeamId === teamId))
    .sort((a, b) => b.startTime.localeCompare(a.startTime)).slice(0, n)
    .map((g) => {
      const home = g.homeTeamId === teamId;
      const f = home ? g.homeScore! : g.awayScore!, a = home ? g.awayScore! : g.homeScore!;
      return { gameId: g.id, date: g.startTime, opponentId: home ? g.awayTeamId : g.homeTeamId, home, neutral: g.neutralSite, for: f, against: a, result: f > a ? "W" : f < a ? "L" : "T" };
    });
}

export interface Split { games: number; avgFor: number | null; avgAgainst: number | null; avgMargin: number | null }
const split = (rows: { for: number; against: number }[]): Split => rows.length
  ? { games: rows.length, avgFor: rows.reduce((s, r) => s + r.for, 0) / rows.length, avgAgainst: rows.reduce((s, r) => s + r.against, 0) / rows.length,
    avgMargin: rows.reduce((s, r) => s + r.for - r.against, 0) / rows.length }
  : { games: 0, avgFor: null, avgAgainst: null, avgMargin: null };

export function splits(teamId: string, games: GameRow[], before: string): { all: Split; home: Split; away: Split } {
  const rows = recentForm(teamId, games, before, Infinity);
  return { all: split(rows), home: split(rows.filter((r) => r.home && r.neutral !== true)), away: split(rows.filter((r) => !r.home && r.neutral !== true)) };
}

/** Average current rating of opponents faced so far (higher = tougher schedule). */
export function strengthOfSchedule(teamId: string, games: GameRow[], before: string, ratings: Map<string, { mov: number }>, last?: number): number | null {
  const opp = recentForm(teamId, games, before, last ?? Infinity).map((r) => ratings.get(r.opponentId)?.mov).filter((x): x is number => x !== undefined);
  return opp.length ? opp.reduce((s, x) => s + x, 0) / opp.length : null;
}

export function headToHead(a: string, b: string, games: GameRow[], before: string, n = 6): GameRow[] {
  return games.filter((g) => done(g, before) && ((g.homeTeamId === a && g.awayTeamId === b) || (g.homeTeamId === b && g.awayTeamId === a)))
    .sort((x, y) => y.startTime.localeCompare(x.startTime)).slice(0, n);
}

export interface Situation { key: string; label: string; detail: string }
/** Schedule situations we can actually verify from the data. */
export function situations(g: GameRow, sport: SportKey, home: string, away: string): Situation[] {
  const out: Situation[] = [];
  const side = (rest: number | null, team: string) => {
    if (rest === null) return;
    if (sport === "nba" && rest <= 1) out.push({ key: `b2b-${team}`, label: `${team} on a back-to-back`, detail: "Played the previous day." });
    if (sport === "nfl" && rest <= 5) out.push({ key: `short-${team}`, label: `${team} on a short week`, detail: `${rest} days since the last game.` });
    if (sport !== "nba" && rest >= 13) out.push({ key: `bye-${team}`, label: `${team} off a bye`, detail: `${rest} days of rest.` });
  };
  side(g.homeRest, home); side(g.awayRest, away);
  if (g.homeRest !== null && g.awayRest !== null && g.homeRest !== g.awayRest) {
    const edge = g.homeRest - g.awayRest;
    out.push({ key: "rest", label: `Rest edge: ${edge > 0 ? home : away} +${Math.abs(edge)} days`, detail: `${home} ${g.homeRest} days, ${away} ${g.awayRest} days.` });
  }
  if (g.neutralSite === true) out.push({ key: "neutral", label: "Neutral site", detail: g.venue ?? "No home advantage applied." });
  if (g.neutralSite === null) out.push({ key: "site", label: "Site unknown", detail: "The data source doesn't say whether this is a neutral site; the model assumes home." });
  return out;
}

export interface MovePoint { t: string; homeSpread: number | null; total: number | null; books: number }
/** The market as it stood after each captured update: one point per distinct update time. */
export function lineMovement(snaps: OddsSnapshot[], book: string): MovePoint[] {
  const times = [...new Set(snaps.map((s) => s.sourceUpdatedAt ?? s.retrievedAt))].sort();
  return times.map((t) => {
    const m = marketFromSnapshots(snaps.filter((s) => (s.sourceUpdatedAt ?? s.retrievedAt) <= t), book);
    return { t, homeSpread: m?.homeMargin == null ? null : -m.homeMargin, total: m?.total ?? null, books: m?.books ?? 0 };
  }).filter((p) => p.homeSpread !== null || p.total !== null);
}
