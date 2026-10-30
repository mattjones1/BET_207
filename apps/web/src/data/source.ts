/**
 * The app's only door to data. Pages call these through TanStack Query; they never touch Supabase or
 * fixtures directly. Two implementations: live (Supabase, RLS as the signed-in user) and demo (a labeled
 * snapshot of real nflverse data; no live sportsbook prices).
 */
import type { HistoricalLine, OddsSnapshot, SportKey, Team } from "@bet207/core";
import { env } from "../lib/env";
import { supabase } from "../lib/supabase";

export const SPORT_ID: Record<SportKey, number> = { nfl: 1, ncaaf: 2, nba: 3 };

export interface GameRow {
  id: string;
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
  status: string;
  homeScore: number | null;
  awayScore: number | null;
  completeness: string;
}

export interface SeasonData {
  sport: SportKey;
  season: number;
  teams: Map<string, Team>;
  games: GameRow[];
  /** Shown in the UI when the data isn't live. */
  note: string | null;
}

export interface Markets {
  snaps: Map<string, OddsSnapshot[]>;
  lines: Map<string, HistoricalLine[]>;
  books: string[];
}

// ───────── helpers ─────────
type Q<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;
async function all<T>(make: (from: number, to: number) => Q<T>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const r = await make(from, from + 999);
    if (r.error) throw new Error(r.error.message);
    out.push(...(r.data ?? []));
    if (!r.data || r.data.length < 1000) return out;
  }
}
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const group = <T,>(rows: T[], key: (r: T) => string) => {
  const m = new Map<string, T[]>();
  for (const r of rows) { const k = key(r); (m.get(k) ?? m.set(k, []).get(k)!).push(r); }
  return m;
};

// ───────── demo ─────────
interface DemoFile {
  label: string; generatedAt: string; seasons: number[];
  teams: { id: string; abbr: string; name: string; conference: string | null; division: string | null }[];
  games: (Omit<GameRow, "completeness"> & { finalAt: string | null })[];
  lines: (Omit<HistoricalLine, "provider" | "sportsbook" | "lineType"> & { lineType: HistoricalLine["lineType"] })[];
}
let demoCache: Promise<DemoFile> | null = null;
const demo = () => (demoCache ??= import("../../../../fixtures/demo/nfl.json").then((m) => m.default as unknown as DemoFile));

export async function demoSeasons(): Promise<number[]> {
  return (await demo()).seasons;
}

// ───────── public API ─────────
export async function getSeason(sport: SportKey, season: number): Promise<SeasonData> {
  if (env.demo || !supabase) {
    if (sport !== "nfl") return { sport, season, teams: new Map(), games: [], note: "Demo mode includes NFL only. Connect Supabase and the CFBD/BALLDONTLIE keys for college football and the NBA." };
    const d = await demo();
    return {
      sport, season,
      teams: new Map(d.teams.map((t) => [t.id, { ...t, sport }])),
      games: d.games.filter((g) => g.season === season).map((g) => ({ ...g, completeness: "complete" })),
      note: `${d.label} Snapshot taken ${new Date(d.generatedAt).toLocaleDateString()}.`,
    };
  }
  const sb = supabase;
  const [teams, games] = await Promise.all([
    all<{ id: string; abbr: string; name: string; conference: string | null; division: string | null }>((a, b) =>
      sb.from("teams").select("id,abbr,name,conference,division").eq("sport_id", SPORT_ID[sport]).order("abbr").range(a, b)),
    all<Record<string, unknown>>((a, b) =>
      sb.from("games").select("id,season,season_type,week,start_time,home_team_id,away_team_id,neutral_site,venue,home_rest,away_rest,status,completeness,game_results(home_score,away_score)")
        .eq("sport_id", SPORT_ID[sport]).eq("season", season).order("start_time").range(a, b)),
  ]);
  return {
    sport, season, note: null,
    teams: new Map(teams.map((t) => [t.id, { ...t, sport }])),
    games: games.map((g) => {
      const r = (Array.isArray(g.game_results) ? g.game_results[0] : g.game_results) as { home_score: number; away_score: number } | null | undefined;
      return {
        id: g.id as string, season: g.season as number, seasonType: g.season_type as GameRow["seasonType"], week: num(g.week),
        startTime: g.start_time as string, homeTeamId: g.home_team_id as string, awayTeamId: g.away_team_id as string,
        neutralSite: g.neutral_site as boolean | null, venue: g.venue as string | null, homeRest: num(g.home_rest), awayRest: num(g.away_rest),
        status: g.status as string, homeScore: r?.home_score ?? null, awayScore: r?.away_score ?? null, completeness: g.completeness as string,
      };
    }),
  };
}

export async function getMarkets(gameIds: string[]): Promise<Markets> {
  if (!gameIds.length) return { snaps: new Map(), lines: new Map(), books: [] };
  if (env.demo || !supabase) {
    const d = await demo();
    const ids = new Set(gameIds);
    const lines: HistoricalLine[] = d.lines.filter((l) => ids.has(l.gameId)).map((l) => ({ ...l, provider: "nflverse", sportsbook: "" }));
    return { snaps: new Map(), lines: group(lines, (l) => l.gameId), books: [] };
  }
  const sb = supabase;
  const snaps: OddsSnapshot[] = [], lines: HistoricalLine[] = [];
  for (let i = 0; i < gameIds.length; i += 150) {
    const ids = gameIds.slice(i, i + 150);
    const [o, l] = await Promise.all([
      all<Record<string, unknown>>((a, b) => sb.from("odds_snapshots")
        .select("game_id,market,home_point,home_price,away_price,total_point,over_price,under_price,source_updated_at,retrieved_at,provider,sportsbooks(key)")
        .in("game_id", ids).order("id").range(a, b)),
      all<Record<string, unknown>>((a, b) => sb.from("historical_lines").select("*").in("game_id", ids).order("id").range(a, b)),
    ]);
    for (const s of o) snaps.push({
      gameId: s.game_id as string, sportsbook: (s.sportsbooks as { key: string } | null)?.key ?? "?", market: s.market as OddsSnapshot["market"],
      homePoint: num(s.home_point), homePrice: num(s.home_price), awayPrice: num(s.away_price), totalPoint: num(s.total_point),
      overPrice: num(s.over_price), underPrice: num(s.under_price), sourceUpdatedAt: s.source_updated_at as string, retrievedAt: s.retrieved_at as string,
      provider: "the-odds-api",
    });
    for (const x of l) lines.push({
      gameId: x.game_id as string, provider: x.provider as HistoricalLine["provider"], lineType: x.line_type as HistoricalLine["lineType"],
      sportsbook: x.sportsbook as string, marketHomeMargin: num(x.market_home_margin), homeSpreadPrice: num(x.home_spread_price),
      awaySpreadPrice: num(x.away_spread_price), total: num(x.total), overPrice: num(x.over_price), underPrice: num(x.under_price),
      homeMoneyline: num(x.home_moneyline), awayMoneyline: num(x.away_moneyline),
    });
  }
  return { snaps: group(snaps, (s) => s.gameId), lines: group(lines, (l) => l.gameId), books: [...new Set(snaps.map((s) => s.sportsbook))].sort() };
}

// ───────── status ─────────
export interface PipelineRun {
  job: string; sport: string | null; status: "running" | "success" | "failed" | "skipped";
  startedAt: string; finishedAt: string | null; rowsUpserted: number | null; error: string | null;
}
export interface QuotaStatus { provider: string; checkedAt: string; remaining: number | null; used: number | null; lastCost: number | null }
export interface DataStatus { mode: "live" | "demo"; runs: PipelineRun[]; quota: QuotaStatus[]; gameCounts: Partial<Record<SportKey, number>> }

export async function getDataStatus(): Promise<DataStatus> {
  if (env.demo || !supabase) {
    const d = await demo();
    return { mode: "demo", runs: [], quota: [], gameCounts: { nfl: d.games.length } };
  }
  const [runs, quota, counts] = await Promise.all([
    supabase.from("pipeline_runs").select("job,sport,status,started_at,finished_at,rows_upserted,error").order("started_at", { ascending: false }).limit(20),
    supabase.from("api_quota_latest").select("provider,checked_at,remaining,used,last_cost"),
    supabase.from("game_counts").select("sport_key,games"),
  ]);
  for (const r of [runs, quota, counts]) if (r.error) throw new Error(r.error.message);
  return {
    mode: "live",
    runs: (runs.data ?? []).map((r) => ({ job: r.job, sport: r.sport, status: r.status, startedAt: r.started_at, finishedAt: r.finished_at, rowsUpserted: r.rows_upserted, error: r.error })),
    quota: (quota.data ?? []).map((q) => ({ provider: q.provider, checkedAt: q.checked_at, remaining: q.remaining, used: q.used, lastCost: q.last_cost })),
    gameCounts: Object.fromEntries((counts.data ?? []).map((c) => [c.sport_key, c.games])),
  };
}
