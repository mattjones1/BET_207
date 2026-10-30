/**
 * What every adapter produces. Teams are referenced by our canonical abbreviation (resolved to ids by
 * the store). Values are already on our conventions: home-margin axis, null for missing.
 */
import type { Completeness, GameStatus, SportKey } from "@bet207/core";

export interface NormalizedTeam {
  sport: SportKey;
  abbr: string;
  name: string;
  conference: string | null;
  division: string | null;
  /** Names other providers use for this team, lowercased by the store. */
  aliases: { provider: string; alias: string }[];
}

export interface NormalizedGame {
  sport: SportKey;
  provider: string;
  providerEventId: string;
  season: number;
  seasonType: "regular" | "postseason" | "preseason";
  week: number | null;
  startTime: string;
  homeAbbr: string;
  awayAbbr: string;
  neutralSite: boolean | null;
  venue: string | null;
  homeRest: number | null;
  awayRest: number | null;
  status: GameStatus;
  homeScore: number | null;
  awayScore: number | null;
  overtime: boolean | null;
  /** When the result became known. Approximated as start + typical game length when the source doesn't say. */
  finalAt: string | null;
  sourceUpdatedAt: string | null;
  completeness: Completeness;
}

export interface NormalizedLine {
  providerEventId: string;
  provider: string;
  lineType: "closing" | "consensus" | "provider" | "opening";
  sportsbook: string;
  marketHomeMargin: number | null;
  homeSpreadPrice: number | null;
  awaySpreadPrice: number | null;
  total: number | null;
  overPrice: number | null;
  underPrice: number | null;
  homeMoneyline: number | null;
  awayMoneyline: number | null;
}

export interface AdapterIssue {
  providerEventId: string;
  problem: string;
}

export interface AdapterResult {
  teams: NormalizedTeam[];
  games: NormalizedGame[];
  lines: NormalizedLine[];
  issues: AdapterIssue[];
}

/** Typical game lengths, used only to approximate when a result became known. */
export const GAME_HOURS: Record<SportKey, number> = { nfl: 3.5, ncaaf: 3.75, nba: 2.5 };

export function approxFinalAt(sport: SportKey, startTime: string): string {
  return new Date(Date.parse(startTime) + GAME_HOURS[sport] * 3_600_000).toISOString();
}
