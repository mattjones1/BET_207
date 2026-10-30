/**
 * nflverse adapter (NFL). Free, no key, CC-BY-4.0.
 *   games.csv  https://github.com/nflverse/nfldata/raw/master/data/games.csv
 *   teams      https://github.com/nflverse/nflverse-data/releases/download/teams/teams_colors_logos.csv
 *
 * Verified schema notes (nflreadr data dictionary):
 *   spread_line > 0 means the HOME team was favored → it is already our market home margin.
 *   result = home_score − away_score. location is "Home" or "Neutral". gametime is Eastern time.
 *   home_spread_odds / away_spread_odds / over_odds / under_odds are American prices (from ~2018).
 *   Lines are closing lines: a retrospective benchmark, not a price available at prediction time.
 * Relocated franchises keep one identity: OAK → LV, SD → LAC, STL → LA.
 */
import { marketMarginFromNflverse } from "@bet207/core";
import { num, parseCsv } from "../lib/csv";
import { fetchWithRetry } from "../lib/http";
import { zonedToUtc } from "../lib/time";
import { approxFinalAt, type AdapterResult, type NormalizedGame, type NormalizedLine, type NormalizedTeam } from "./types";

export const NFLVERSE_GAMES_URL = "https://github.com/nflverse/nfldata/raw/master/data/games.csv";
export const NFLVERSE_TEAMS_URL = "https://github.com/nflverse/nflverse-data/releases/download/teams/teams_colors_logos.csv";
const PROVIDER = "nflverse";

/** Historical abbreviations → current franchise abbreviation. */
export const FRANCHISE: Record<string, string> = { OAK: "LV", SD: "LAC", STL: "LA", LAR: "LA" };
const canon = (abbr: string) => FRANCHISE[abbr] ?? abbr;

/** Former names that other providers might still use. */
const FORMER_NAMES: Record<string, string[]> = {
  LV: ["Oakland Raiders"], LAC: ["San Diego Chargers"], LA: ["St. Louis Rams", "St Louis Rams"],
  WAS: ["Washington Football Team", "Washington Redskins", "Washington"],
};

export function parseTeams(csv: string): NormalizedTeam[] {
  const byAbbr = new Map<string, NormalizedTeam>();
  for (const r of parseCsv(csv)) {
    const abbr = canon(r.team_abbr ?? "");
    if (!abbr) continue;
    const t = byAbbr.get(abbr) ?? {
      sport: "nfl" as const, abbr, name: "", conference: null, division: null,
      aliases: [{ provider: PROVIDER, alias: abbr }, ...(FORMER_NAMES[abbr] ?? []).map((alias) => ({ provider: "name", alias }))],
    };
    // Current rows (not relocated abbreviations) set the display name and division.
    if (!FRANCHISE[r.team_abbr ?? ""]) { t.name = r.team_name ?? abbr; t.conference = r.team_conf || null; t.division = r.team_division || null; }
    t.aliases.push({ provider: PROVIDER, alias: r.team_abbr ?? "" }, { provider: "name", alias: r.team_name ?? "" });
    byAbbr.set(abbr, t);
  }
  return [...byAbbr.values()];
}

export function parseGames(csv: string, retrievedAt = new Date().toISOString()): AdapterResult {
  const games: NormalizedGame[] = [], lines: NormalizedLine[] = [], issues: AdapterResult["issues"] = [];
  for (const r of parseCsv(csv)) {
    const id = r.game_id ?? "";
    const season = num(r.season), week = num(r.week);
    if (!id || season === null || !r.gameday || !r.home_team || !r.away_team) {
      issues.push({ providerEventId: id || "(blank)", problem: "missing id, season, date, or teams" });
      continue;
    }
    const startTime = zonedToUtc(r.gameday, r.gametime || "13:00");
    const hs = num(r.home_score), as = num(r.away_score);
    const final = hs !== null && as !== null;
    if (final && num(r.result) !== null && num(r.result) !== hs - as) {
      issues.push({ providerEventId: id, problem: `result ${r.result} doesn't equal home − away (${hs} − ${as})` });
    }
    games.push({
      sport: "nfl", provider: PROVIDER, providerEventId: id, season, week,
      seasonType: r.game_type === "REG" ? "regular" : "postseason",
      startTime, homeAbbr: canon(r.home_team), awayAbbr: canon(r.away_team),
      neutralSite: r.location === "Neutral" ? true : r.location === "Home" ? false : null,
      venue: r.stadium || null,
      homeRest: num(r.home_rest), awayRest: num(r.away_rest),
      status: final ? "final" : "scheduled",
      homeScore: hs, awayScore: as,
      overtime: r.overtime === "" ? null : r.overtime === "1",
      finalAt: final ? approxFinalAt("nfl", startTime) : null,
      sourceUpdatedAt: null,
      completeness: r.gametime ? "complete" : "partial",
    });
    const margin = marketMarginFromNflverse(num(r.spread_line));
    const total = num(r.total_line);
    if (margin !== null || total !== null) {
      lines.push({
        providerEventId: id, provider: PROVIDER, lineType: "closing", sportsbook: "",
        marketHomeMargin: margin,
        homeSpreadPrice: num(r.home_spread_odds), awaySpreadPrice: num(r.away_spread_odds),
        total, overPrice: num(r.over_odds), underPrice: num(r.under_odds),
        homeMoneyline: num(r.home_moneyline), awayMoneyline: num(r.away_moneyline),
      });
    }
  }
  void retrievedAt;
  return { teams: [], games, lines, issues };
}

export async function fetchNflverse(): Promise<{ gamesCsv: string; teamsCsv: string }> {
  const [g, t] = await Promise.all([
    fetchWithRetry(NFLVERSE_GAMES_URL, { label: "nflverse games.csv" }),
    fetchWithRetry(NFLVERSE_TEAMS_URL, { label: "nflverse teams" }),
  ]);
  return { gamesCsv: await g.text(), teamsCsv: await t.text() };
}
