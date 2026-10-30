/**
 * Builds slate rows (one per game) from season data and markets. Pure: easy to test, same in live and demo.
 */
import {
  bestMarket, formatRecord, freshness, records, type MarketView, type SportKey, type Team,
} from "@bet207/core";
import type { GameRow, Markets, SeasonData } from "./source";

export interface QualityFlag { key: string; label: string; tone: "warn" | "neutral" | "neg" }
export interface SlateRow {
  game: GameRow;
  home: Team;
  away: Team;
  homeRecord: string;
  awayRecord: string;
  market: MarketView | null;
  flags: QualityFlag[];
}

export interface SlateGroup { key: string; label: string; games: GameRow[] }

const unknownTeam = (id: string, sport: SportKey): Team => ({ id, sport, abbr: "?", name: "Unknown team", conference: null, division: null });

/** Eastern calendar date (YYYY-MM-DD) of an instant. */
export function etDate(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

/** Football: one group per week (postseason weeks labeled). Basketball: one group per Eastern date. */
export function groupSlates(sport: SportKey, games: GameRow[]): SlateGroup[] {
  const groups = new Map<string, SlateGroup>();
  for (const g of games) {
    const key = sport === "nba" ? etDate(g.startTime) : `${g.seasonType === "postseason" ? "P" : "W"}${String(g.week ?? 0).padStart(2, "0")}`;
    const label = sport === "nba"
      ? new Date(`${key}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })
      : g.seasonType === "postseason" ? `Postseason ${g.week ?? ""}`.trim() : `Week ${g.week ?? "?"}`;
    (groups.get(key) ?? groups.set(key, { key, label, games: [] }).get(key)!).games.push(g);
  }
  return [...groups.values()].sort((a, b) => a.games[0]!.startTime.localeCompare(b.games[0]!.startTime));
}

/** The group to open by default: the one with the next unplayed game, else the most recent. */
export function defaultGroup(groups: SlateGroup[], now: Date): SlateGroup | undefined {
  const cutoff = new Date(now.getTime() - 6 * 3_600_000).toISOString();
  return groups.find((g) => g.games.some((x) => x.status !== "final" && x.startTime >= cutoff)) ?? groups.at(-1);
}

export function buildSlate(season: SeasonData, games: GameRow[], markets: Markets, book: string, now: Date): SlateRow[] {
  const sched = season.games.map((g) => ({ ...g }));
  return games.map((g) => {
    const rec = records(sched, g.startTime);   // records entering this game only
    const market = bestMarket(markets.snaps.get(g.id) ?? [], markets.lines.get(g.id) ?? [], book);
    const flags: QualityFlag[] = [];
    if (!market || (market.homeMargin === null && market.total === null)) flags.push({ key: "noline", label: "No line", tone: "neg" });
    else if (market.source === "closing") flags.push(g.status === "final"
      ? { key: "closing", label: "Closing line (retrospective)", tone: "neutral" }
      : { key: "pregame", label: "Imported pre-game line (time unknown)", tone: "neutral" });
    else if (market.source === "provider") flags.push({ key: "provider", label: "Provider line (timing unknown)", tone: "neutral" });
    else if (freshness(market.updatedAt, now) === "stale") flags.push({ key: "stale", label: "Stale odds", tone: "warn" });
    if (g.completeness !== "complete") flags.push({ key: "partial", label: "Partial schedule data", tone: "warn" });
    return {
      game: g,
      home: season.teams.get(g.homeTeamId) ?? unknownTeam(g.homeTeamId, season.sport),
      away: season.teams.get(g.awayTeamId) ?? unknownTeam(g.awayTeamId, season.sport),
      homeRecord: formatRecord(rec.get(g.homeTeamId)),
      awayRecord: formatRecord(rec.get(g.awayTeamId)),
      market, flags,
    };
  });
}
