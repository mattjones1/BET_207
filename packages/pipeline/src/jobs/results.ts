/**
 * Schedules, results, and historical lines for each sport. Idempotent: upserts on provider ids.
 *   sync-nfl     nflverse (no key). Default: every season (cheap: one file).
 *   sync-ncaaf   CFBD (key). Default: the current season. 3 calls per season (teams once).
 *   sync-nba     BALLDONTLIE (key). Default: the current season. ~15 calls per season at 5/min.
 */
import { computeRest } from "@bet207/core";
import * as nflverse from "../adapters/nflverse";
import * as cfbd from "../adapters/cfbd";
import * as bdl from "../adapters/balldontlie";
import type { NormalizedGame } from "../adapters/types";
import { requireEnv } from "../lib/env";
import { currentFootballSeason, currentNbaSeason, type Job } from "./context";

/** Fill rest days from the schedule when the provider doesn't supply them. Null for a team's first game. */
export function fillRest(games: NormalizedGame[]): void {
  const rest = computeRest(games.map((g) => ({
    id: g.providerEventId, startTime: g.startTime, homeTeamId: g.homeAbbr, awayTeamId: g.awayAbbr, homeScore: g.homeScore, awayScore: g.awayScore,
  })));
  for (const g of games) {
    const r = rest.get(g.providerEventId);
    if (g.homeRest === null && g.homeAbbr !== cfbd.FCS_ABBR) g.homeRest = r?.home ?? null;
    if (g.awayRest === null && g.awayAbbr !== cfbd.FCS_ABBR) g.awayRest = r?.away ?? null;
  }
}

export const syncNfl: Job = async ({ store, seasons, log, now }) => {
  const retrievedAt = now.toISOString();
  const { gamesCsv, teamsCsv } = await nflverse.fetchNflverse();
  const teams = nflverse.parseTeams(teamsCsv);
  const parsed = nflverse.parseGames(gamesCsv, retrievedAt);
  const games = seasons.length ? parsed.games.filter((g) => seasons.includes(g.season)) : parsed.games;
  const keep = new Set(games.map((g) => g.providerEventId));
  log(`${games.length} games, ${parsed.lines.length} closing lines, ${parsed.issues.length} issues`);
  const teamIds = await store.upsertTeams("nfl", teams);
  const gameIds = await store.upsertGames(games, teamIds, retrievedAt);
  const lines = await store.upsertLines(parsed.lines.filter((l) => keep.has(l.providerEventId)), gameIds, retrievedAt);
  return { rows: gameIds.size + lines, details: { games: gameIds.size, lines, issues: parsed.issues.slice(0, 50) } };
};

export const syncNcaaf: Job = async ({ store, seasons, log, now }) => {
  const key = requireEnv("CFBD_API_KEY");
  const retrievedAt = now.toISOString();
  const years = seasons.length ? seasons : [currentFootballSeason(now)];
  let remaining: number | null = null, rows = 0;
  const issues: unknown[] = [];
  // FBS membership changes by year; use each season's own list.
  for (const year of years) {
    const t = await cfbd.cfbdGet("/teams/fbs", { year }, key);
    const teams = cfbd.parseTeams(t.json);
    const fbs = new Set(teams.filter((x) => x.abbr !== cfbd.FCS_ABBR).map((x) => x.abbr));
    const g = await cfbd.cfbdGet("/games", { year, seasonType: "both", classification: "fbs" }, key);
    const l = await cfbd.cfbdGet("/lines", { year, seasonType: "both" }, key);
    remaining = l.remaining ?? g.remaining ?? t.remaining;
    const games = cfbd.parseGames(g.json, fbs);
    const lines = cfbd.parseLines(l.json);
    fillRest(games.games);
    const teamIds = await store.upsertTeams("ncaaf", teams);
    const gameIds = await store.upsertGames(games.games, teamIds, retrievedAt);
    const n = await store.upsertLines(lines.lines, gameIds, retrievedAt);
    rows += gameIds.size + n;
    issues.push(...games.issues, ...lines.issues);
    log(`${year}: ${gameIds.size} games, ${n} lines, ${games.issues.length + lines.issues.length} issues, ${remaining ?? "?"} calls left`);
  }
  await store.recordQuota("cfbd", { remaining, used: null, last: null });
  return { rows, details: { seasons: years, callsRemaining: remaining, issues: issues.slice(0, 50) } };
};

export const syncNba: Job = async ({ store, seasons, log, now }) => {
  const key = requireEnv("BALLDONTLIE_API_KEY");
  const retrievedAt = now.toISOString();
  const years = seasons.length ? seasons : [currentNbaSeason(now)];
  let rows = 0;
  const issues: unknown[] = [];
  for (const year of years) {
    const pages = await bdl.fetchSeasons([year], key, log);
    const parsed = bdl.parseGames(pages);
    fillRest(parsed.games);
    const teamIds = await store.upsertTeams("nba", parsed.teams);
    const gameIds = await store.upsertGames(parsed.games, teamIds, retrievedAt);
    rows += gameIds.size;
    issues.push(...parsed.issues);
    log(`${year}: ${gameIds.size} games`);
  }
  return { rows, details: { seasons: years, issues: issues.slice(0, 50) } };
};
