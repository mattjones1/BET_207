/**
 * CollegeFootballData adapter (FBS). Free key: 1,000 calls/month; Bearer auth; X-CallLimit-Remaining header.
 * Schema from the provider's OpenAPI spec v5.33.2 (api.collegefootballdata.com/api-docs.json):
 *   GET /games?year&seasonType&classification   Game { id, season, week, seasonType, startDate, startTimeTBD,
 *     completed, neutralSite, venue, homeTeam, homeClassification, homePoints, awayTeam, awayClassification, awayPoints }
 *   GET /lines?year&seasonType   BettingGame { id, homeTeam, awayTeam, lines: GameLine[] }
 *     GameLine { provider, spread, formattedSpread, spreadOpen, overUnder, overUnderOpen, homeMoneyline, awayMoneyline }
 *   GET /teams/fbs?year   Team { school, mascot, abbreviation, alternateNames, conference, division }
 *
 * The spread SIGN is not assumed: each line is checked against formattedSpread ("Georgia -21.5"), which names
 * the team the number belongs to. Lines that don't agree are skipped and reported. Missing lines stay missing.
 * Non-FBS opponents are pooled into one "FCS" team (too few games each to rate on their own).
 */
import { z } from "zod";
import { marketMarginFromHomeSpread } from "@bet207/core";
import { fetchWithRetry, RateLimiter } from "../lib/http";
import { approxFinalAt, type AdapterIssue, type NormalizedGame, type NormalizedLine, type NormalizedTeam } from "./types";

const PROVIDER = "cfbd";
const BASE = "https://api.collegefootballdata.com";
export const FCS_ABBR = "FCS";
const limiter = new RateLimiter(300);

const Team = z.object({
  school: z.string(), mascot: z.string().nullish(), abbreviation: z.string().nullish(),
  alternateNames: z.array(z.string()).nullish(), conference: z.string().nullish(), division: z.string().nullish(),
});
const Game = z.object({
  id: z.number(), season: z.number(), week: z.number().nullish(), seasonType: z.string(),
  startDate: z.string(), startTimeTBD: z.boolean().nullish(), completed: z.boolean().nullish(),
  neutralSite: z.boolean().nullish(), venue: z.string().nullish(),
  homeTeam: z.string(), homeClassification: z.string().nullish(), homePoints: z.number().nullish(),
  awayTeam: z.string(), awayClassification: z.string().nullish(), awayPoints: z.number().nullish(),
});
const Line = z.object({
  provider: z.string(), spread: z.number().nullish(), formattedSpread: z.string().nullish(), spreadOpen: z.number().nullish(),
  overUnder: z.number().nullish(), overUnderOpen: z.number().nullish(), homeMoneyline: z.number().nullish(), awayMoneyline: z.number().nullish(),
});
const BettingGame = z.object({ id: z.number(), homeTeam: z.string(), awayTeam: z.string(), lines: z.array(Line) });

export function parseTeams(json: unknown): NormalizedTeam[] {
  const teams = z.array(Team).parse(json).map((t) => ({
    sport: "ncaaf" as const, abbr: t.school, name: t.mascot ? `${t.school} ${t.mascot}` : t.school,
    conference: t.conference ?? null, division: t.division ?? null,
    aliases: [
      { provider: PROVIDER, alias: t.school },
      { provider: "name", alias: t.mascot ? `${t.school} ${t.mascot}` : t.school },
      ...(t.alternateNames ?? []).map((alias) => ({ provider: "name", alias })),
    ],
  }));
  teams.push({ sport: "ncaaf", abbr: FCS_ABBR, name: "FCS / lower-division opponent", conference: null, division: null, aliases: [] });
  return teams;
}

export function parseGames(json: unknown, fbsSchools: Set<string>): { games: NormalizedGame[]; issues: AdapterIssue[] } {
  const games: NormalizedGame[] = [], issues: AdapterIssue[] = [];
  for (const raw of z.array(z.unknown()).parse(json)) {
    const p = Game.safeParse(raw);
    if (!p.success) { issues.push({ providerEventId: String((raw as { id?: unknown })?.id ?? "?"), problem: "unexpected game shape" }); continue; }
    const g = p.data;
    const homeFbs = fbsSchools.has(g.homeTeam), awayFbs = fbsSchools.has(g.awayTeam);
    if (!homeFbs && !awayFbs) continue;
    const final = g.completed === true && g.homePoints != null && g.awayPoints != null;
    const startTime = new Date(g.startDate).toISOString();
    games.push({
      sport: "ncaaf", provider: PROVIDER, providerEventId: String(g.id), season: g.season, week: g.week ?? null,
      seasonType: g.seasonType === "postseason" ? "postseason" : "regular",
      startTime, homeAbbr: homeFbs ? g.homeTeam : FCS_ABBR, awayAbbr: awayFbs ? g.awayTeam : FCS_ABBR,
      neutralSite: g.neutralSite ?? null, venue: g.venue ?? null, homeRest: null, awayRest: null,
      status: final ? "final" : "scheduled",
      homeScore: final ? g.homePoints! : null, awayScore: final ? g.awayPoints! : null, overtime: null,
      finalAt: final ? approxFinalAt("ncaaf", startTime) : null, sourceUpdatedAt: null,
      completeness: g.startTimeTBD ? "partial" : "complete",
    });
  }
  return { games, issues };
}

/**
 * Read the home team's spread from formattedSpread. "Georgia -21.5" with home Georgia → −21.5;
 * with away Georgia → +21.5. "PK"/"Pick" → 0. Returns null when it can't tell.
 */
export function homeSpreadFromFormatted(formatted: string | null | undefined, home: string, away: string): number | null {
  if (!formatted) return null;
  const f = formatted.trim();
  if (/^(pk|pick|pick'?em|even)$/i.test(f)) return 0;
  const m = f.match(/^(.*\S)\s+([+-]?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const team = m[1]!, n = Number(m[2]);
  if (team === home) return n;
  if (team === away) return -n;
  return null;
}

export function parseLines(json: unknown): { lines: NormalizedLine[]; issues: AdapterIssue[] } {
  const lines: NormalizedLine[] = [], issues: AdapterIssue[] = [];
  for (const g of z.array(BettingGame).parse(json)) {
    for (const l of g.lines) {
      const id = String(g.id);
      let homeSpread: number | null = null;
      let sign = 1;   // how `spread` relates to the home spread for this row: +1 same, −1 inverted
      if (l.spread != null) {
        const fromText = homeSpreadFromFormatted(l.formattedSpread, g.homeTeam, g.awayTeam);
        if (fromText === null) {
          issues.push({ providerEventId: id, problem: `${l.provider}: can't read formattedSpread "${l.formattedSpread ?? ""}"; spread skipped` });
        } else if (Math.abs(fromText - l.spread) < 1e-9) { homeSpread = fromText; sign = 1; }
        else if (Math.abs(fromText + l.spread) < 1e-9) { homeSpread = fromText; sign = -1; }
        else issues.push({ providerEventId: id, problem: `${l.provider}: spread ${l.spread} disagrees with "${l.formattedSpread}"; skipped` });
      }
      const base = {
        providerEventId: id, provider: PROVIDER, sportsbook: l.provider,
        homeSpreadPrice: null, awaySpreadPrice: null, overPrice: null, underPrice: null,
      };
      if (homeSpread !== null || l.overUnder != null || l.homeMoneyline != null) {
        lines.push({ ...base, lineType: "provider", marketHomeMargin: marketMarginFromHomeSpread(homeSpread),
          total: l.overUnder ?? null, homeMoneyline: l.homeMoneyline ?? null, awayMoneyline: l.awayMoneyline ?? null });
      }
      // Provider-reported opening numbers, only when the sign of this row was verified above.
      const openSpread = homeSpread !== null && l.spreadOpen != null ? sign * l.spreadOpen : null;
      if (openSpread !== null || l.overUnderOpen != null) {
        lines.push({ ...base, lineType: "opening", marketHomeMargin: marketMarginFromHomeSpread(openSpread),
          total: l.overUnderOpen ?? null, homeMoneyline: null, awayMoneyline: null });
      }
    }
  }
  return { lines, issues };
}

export interface CfbdCall { json: unknown; remaining: number | null }

export async function cfbdGet(path: string, params: Record<string, string | number>, apiKey: string): Promise<CfbdCall> {
  const q = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  const res = await fetchWithRetry(`${BASE}${path}?${q}`, {
    label: `CFBD ${path}`, limiter, headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
  });
  const rem = res.headers.get("x-calllimit-remaining");
  return { json: await res.json(), remaining: rem === null ? null : Number(rem) };
}
