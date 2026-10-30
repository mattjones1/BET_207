/**
 * export-demo: writes fixtures/demo/nfl.json for demo mode (no Supabase). It's REAL data — nflverse
 * schedules, results, and closing lines for the last three seasons — labeled as a demo snapshot.
 * There are no live sportsbook snapshots in demo mode; the app says so.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import * as nflverse from "../adapters/nflverse";
import { currentFootballSeason, type Job } from "./context";

export const DEMO_PATH = resolve(import.meta.dirname, "../../../../fixtures/demo/nfl.json");

export const exportDemo: Job = async ({ now, seasons, log }) => {
  const { gamesCsv, teamsCsv } = await nflverse.fetchNflverse();
  const cur = currentFootballSeason(now);
  const keep = seasons.length ? seasons : [cur - 2, cur - 1, cur];
  const teams = nflverse.parseTeams(teamsCsv).map((t) => ({ id: t.abbr, abbr: t.abbr, name: t.name, conference: t.conference, division: t.division }));
  const parsed = nflverse.parseGames(gamesCsv);
  const games = parsed.games.filter((g) => keep.includes(g.season)).map((g) => ({
    id: g.providerEventId, season: g.season, seasonType: g.seasonType, week: g.week, startTime: g.startTime,
    homeTeamId: g.homeAbbr, awayTeamId: g.awayAbbr, neutralSite: g.neutralSite, venue: g.venue,
    homeRest: g.homeRest, awayRest: g.awayRest, status: g.status, homeScore: g.homeScore, awayScore: g.awayScore, finalAt: g.finalAt,
  }));
  const ids = new Set(games.map((g) => g.id));
  const lines = parsed.lines.filter((l) => ids.has(l.providerEventId)).map((l) => ({
    gameId: l.providerEventId, lineType: l.lineType, marketHomeMargin: l.marketHomeMargin, homeSpreadPrice: l.homeSpreadPrice,
    awaySpreadPrice: l.awaySpreadPrice, total: l.total, overPrice: l.overPrice, underPrice: l.underPrice,
    homeMoneyline: l.homeMoneyline, awayMoneyline: l.awayMoneyline,
  }));
  mkdirSync(resolve(DEMO_PATH, ".."), { recursive: true });
  writeFileSync(DEMO_PATH, JSON.stringify({
    label: "Demo snapshot of real nflverse data (CC-BY-4.0). Closing lines are retrospective benchmarks. No live sportsbook prices.",
    generatedAt: now.toISOString(), sport: "nfl", seasons: keep, teams, games, lines,
  }));
  log(`wrote ${games.length} games and ${lines.length} lines for seasons ${keep.join(", ")} to fixtures/demo/nfl.json`);
  return { rows: games.length + lines.length };
};
