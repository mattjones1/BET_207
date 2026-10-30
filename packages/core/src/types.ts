/**
 * Domain types shared by the pipeline and the web app. Database rows are snake_case; these are the
 * normalized, camelCase shapes the code works with. Every externally sourced record carries provenance.
 */
import type { SportKey } from "./sports";

export type Provider = "nflverse" | "cfbd" | "balldontlie" | "the-odds-api" | "demo";

/** How complete a record is. "partial" records are usable but missing optional fields. */
export type Completeness = "complete" | "partial" | "missing";

export interface Provenance {
  provider: Provider;
  providerEventId: string;
  /** When we fetched it (ISO). */
  retrievedAt: string;
  /** When the source says it last changed (ISO), if it says. */
  sourceUpdatedAt: string | null;
  completeness: Completeness;
}

export interface Team {
  id: string;
  sport: SportKey;
  abbr: string;
  name: string;
  conference: string | null;
  division: string | null;
}

export type GameStatus = "scheduled" | "in_progress" | "final" | "postponed" | "canceled";

export interface Game extends Provenance {
  id: string;
  sport: SportKey;
  season: number;
  seasonType: "regular" | "postseason" | "preseason";
  week: number | null;
  startTime: string;
  homeTeamId: string;
  awayTeamId: string;
  neutralSite: boolean | null;
  venue: string | null;
  homeRest: number | null;
  awayRest: number | null;
  status: GameStatus;
  homeScore: number | null;
  awayScore: number | null;
}

export type Market = "spread" | "total" | "h2h";

/** One sportsbook's price for one market at one moment. Prices are American odds. */
export interface OddsSnapshot {
  gameId: string;
  sportsbook: string;
  market: Market;
  /** Spread: the home team's spread (sportsbook sign). */
  homePoint: number | null;
  homePrice: number | null;
  awayPrice: number | null;
  /** Total: the total points line. */
  totalPoint: number | null;
  overPrice: number | null;
  underPrice: number | null;
  sourceUpdatedAt: string | null;
  retrievedAt: string;
  provider: Provider;
}

/** A historical line imported from a results source (not a price we captured ourselves). */
export interface HistoricalLine {
  gameId: string;
  provider: Provider;
  /** "closing" lines are retrospective benchmarks, not prices available at prediction time. */
  lineType: "closing" | "consensus" | "provider";
  sportsbook: string | null;
  marketHomeMargin: number | null;
  homeSpreadPrice: number | null;
  awaySpreadPrice: number | null;
  total: number | null;
  overPrice: number | null;
  underPrice: number | null;
  homeMoneyline: number | null;
  awayMoneyline: number | null;
}

export type ProjectionStatus = "ok" | "experimental" | "insufficient";
