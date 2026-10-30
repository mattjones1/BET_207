/** Every game of a sport as model input, for Model Lab previews and in-browser backtests. */
import type { FitGame, SportKey } from "@bet207/core";
import { env } from "../lib/env";
import { supabase } from "../lib/supabase";
import { SPORT_ID, demoSeasons, getSeason } from "./source";
import { toFitGames } from "./model";

export interface HistoryLine { gameId: string; marketHomeMargin: number | null; total: number | null; homeSpreadPrice: number | null; awaySpreadPrice: number | null; overPrice: number | null; underPrice: number | null; source: string }

export async function getHistory(sport: SportKey): Promise<{ games: FitGame[]; lines: HistoryLine[] }> {
  if (env.demo || !supabase) {
    if (sport !== "nfl") return { games: [], lines: [] };
    const seasons = await demoSeasons();
    const data = await Promise.all(seasons.map((s) => getSeason(sport, s)));
    const games = toFitGames(data.flatMap((d) => d.games));
    const mod = await import("../../../../fixtures/demo/nfl.json");
    const lines = (mod.default as unknown as { lines: (HistoryLine & { lineType: string })[] }).lines
      .filter((l) => l.lineType === "closing").map((l) => ({ ...l, source: "nflverse:closing" }));
    return { games, lines };
  }
  const sb = supabase;
  const page = async <T,>(make: (a: number, b: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) => {
    const out: T[] = [];
    for (let a = 0; ; a += 1000) {
      const r = await make(a, a + 999);
      if (r.error) throw new Error(r.error.message);
      out.push(...(r.data ?? []));
      if (!r.data || r.data.length < 1000) return out;
    }
  };
  const rows = await page<Record<string, unknown>>((a, b) => sb.from("games")
    .select("id,season,start_time,home_team_id,away_team_id,neutral_site,home_rest,away_rest,status,game_results(home_score,away_score,final_at)")
    .eq("sport_id", SPORT_ID[sport]).neq("status", "canceled").order("start_time").order("id").range(a, b));
  const games: FitGame[] = rows.map((g) => {
    const r = (Array.isArray(g.game_results) ? g.game_results[0] : g.game_results) as { home_score: number; away_score: number; final_at: string } | null;
    return { id: g.id as string, season: g.season as number, startTime: g.start_time as string, finalAt: r?.final_at ?? null,
      homeTeamId: g.home_team_id as string, awayTeamId: g.away_team_id as string, neutralSite: g.neutral_site as boolean | null,
      homeRest: g.home_rest as number | null, awayRest: g.away_rest as number | null, homeScore: r?.home_score ?? null, awayScore: r?.away_score ?? null };
  });
  // Lines for backtests: one per game. NFL uses nflverse closing lines; CFBD uses the consensus provider line.
  const raw = await page<Record<string, unknown>>((a, b) => sb.from("historical_lines")
    .select("game_id,provider,line_type,sportsbook,market_home_margin,total,home_spread_price,away_spread_price,over_price,under_price,games!inner(sport_id)")
    .eq("games.sport_id", SPORT_ID[sport]).neq("line_type", "opening").order("id").range(a, b));
  const best = new Map<string, Record<string, unknown>>();
  const rank = (l: Record<string, unknown>) => (l.line_type === "closing" ? 0 : /consensus/i.test(String(l.sportsbook)) ? 1 : 2);
  for (const l of raw) { const k = l.game_id as string; const cur = best.get(k); if (!cur || rank(l) < rank(cur)) best.set(k, l); }
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  const lines = [...best.values()].map((l) => ({
    gameId: l.game_id as string, marketHomeMargin: n(l.market_home_margin), total: n(l.total), homeSpreadPrice: n(l.home_spread_price), awaySpreadPrice: n(l.away_spread_price),
    overPrice: n(l.over_price), underPrice: n(l.under_price), source: `${l.provider}:${l.line_type === "closing" ? "closing" : `provider ${l.sportsbook}`}`,
  }));
  return { games, lines };
}
