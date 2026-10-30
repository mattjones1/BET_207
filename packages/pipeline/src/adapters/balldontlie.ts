/**
 * BALLDONTLIE adapter (NBA). Free tier: teams and games only, 5 requests/minute.
 *   GET https://api.balldontlie.io/v1/games?seasons[]=2025&per_page=100&cursor=…   header Authorization: <key>
 *   Game { id, date, datetime, season, status, status_state, postseason, home_team_score, visitor_team_score,
 *          home_team{ id, abbreviation, full_name, conference, division }, visitor_team{…} }
 *   meta { next_cursor, per_page }
 * No neutral-site flag on this tier → neutralSite is null (unknown). Rest days are computed from the schedule.
 * No odds, box scores, or injuries are used (not available on the free tier).
 */
import { z } from "zod";
import { fetchWithRetry, RateLimiter } from "../lib/http";
import { approxFinalAt, type AdapterIssue, type NormalizedGame, type NormalizedTeam } from "./types";

const PROVIDER = "balldontlie";
const BASE = "https://api.balldontlie.io/v1";
// 5 requests/minute on the free tier → one every 12.5 seconds.
export const bdlLimiter = new RateLimiter(12_500);

const Team = z.object({
  id: z.number(), abbreviation: z.string(), full_name: z.string(),
  conference: z.string().nullish(), division: z.string().nullish(), city: z.string().nullish(), name: z.string().nullish(),
});
const Game = z.object({
  id: z.number(), date: z.string(), datetime: z.string().nullish(), season: z.number(),
  status: z.string().nullish(), status_state: z.string().nullish(), postseason: z.boolean().nullish(), postponed: z.boolean().nullish(),
  home_team_score: z.number().nullish(), visitor_team_score: z.number().nullish(),
  home_team: Team, visitor_team: Team,
});
const Page = z.object({ data: z.array(z.unknown()), meta: z.object({ next_cursor: z.number().nullish() }).partial().nullish() });

function team(t: z.infer<typeof Team>): NormalizedTeam {
  return {
    sport: "nba", abbr: t.abbreviation, name: t.full_name, conference: t.conference ?? null, division: t.division ?? null,
    aliases: [{ provider: PROVIDER, alias: String(t.id) }, { provider: "name", alias: t.full_name }],
  };
}

function state(g: z.infer<typeof Game>): NormalizedGame["status"] {
  const s = (g.status_state ?? "").toLowerCase();
  if (g.postponed || s === "postponed") return "postponed";
  if (s === "final" || g.status === "Final") return "final";
  if (s === "in_progress") return "in_progress";
  return "scheduled";
}

export function parseGames(pages: unknown[]): { teams: NormalizedTeam[]; games: NormalizedGame[]; issues: AdapterIssue[] } {
  const teams = new Map<string, NormalizedTeam>(), games: NormalizedGame[] = [], issues: AdapterIssue[] = [];
  for (const page of pages) {
    for (const raw of Page.parse(page).data) {
      const p = Game.safeParse(raw);
      if (!p.success) { issues.push({ providerEventId: String((raw as { id?: unknown })?.id ?? "?"), problem: "unexpected game shape" }); continue; }
      const g = p.data;
      teams.set(g.home_team.abbreviation, team(g.home_team));
      teams.set(g.visitor_team.abbreviation, team(g.visitor_team));
      const status = state(g);
      const final = status === "final" && g.home_team_score != null && g.visitor_team_score != null;
      const hasTime = !!g.datetime;
      const startTime = new Date(g.datetime ?? `${g.date.slice(0, 10)}T00:00:00Z`).toISOString();
      games.push({
        sport: "nba", provider: PROVIDER, providerEventId: String(g.id), season: g.season, week: null,
        seasonType: g.postseason ? "postseason" : "regular", startTime,
        homeAbbr: g.home_team.abbreviation, awayAbbr: g.visitor_team.abbreviation,
        neutralSite: null, venue: null, homeRest: null, awayRest: null, status,
        homeScore: final ? g.home_team_score! : null, awayScore: final ? g.visitor_team_score! : null, overtime: null,
        finalAt: final ? approxFinalAt("nba", startTime) : null, sourceUpdatedAt: null,
        completeness: hasTime ? "complete" : "partial",
      });
    }
  }
  return { teams: [...teams.values()], games, issues };
}

/** Fetch every page of games for the given seasons. ~15 pages per season at 5/min. */
export async function fetchSeasons(seasons: number[], apiKey: string, log: (m: string) => void): Promise<unknown[]> {
  const pages: unknown[] = [];
  for (const season of seasons) {
    let cursor: number | null | undefined = undefined;
    do {
      const q = new URLSearchParams({ "seasons[]": String(season), per_page: "100" });
      if (cursor) q.set("cursor", String(cursor));
      const res = await fetchWithRetry(`${BASE}/games?${q}`, { label: `BALLDONTLIE games ${season}`, limiter: bdlLimiter, headers: { Authorization: apiKey } });
      const json = await res.json();
      pages.push(json);
      cursor = Page.parse(json).meta?.next_cursor;
      log(`season ${season}: ${pages.length} pages`);
    } while (cursor);
  }
  return pages;
}
