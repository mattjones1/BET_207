/** Historical lines for backtests, one per game: a closing line first, else a provider "consensus", else any. */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { BacktestLine, SportKey } from "@bet207/core";
import { requireEnv } from "../lib/env";
import { SPORT_ID } from "../store";

export class SupabaseLines {
  private db: SupabaseClient;
  constructor() { this.db = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } }); }

  async forSport(sport: SportKey): Promise<BacktestLine[]> {
    const rows: Record<string, unknown>[] = [];
    for (let a = 0; ; a += 1000) {
      const r = await this.db.from("historical_lines")
        .select("game_id,provider,line_type,sportsbook,market_home_margin,total,home_spread_price,away_spread_price,over_price,under_price,games!inner(sport_id)")
        .eq("games.sport_id", SPORT_ID[sport]).neq("line_type", "opening").order("id").range(a, a + 999);
      if (r.error) throw new Error(r.error.message);
      rows.push(...(r.data ?? []));
      if (!r.data || r.data.length < 1000) break;
    }
    return pickLines(rows);
  }
}

export function pickLines(rows: Record<string, unknown>[]): BacktestLine[] {
  const rank = (l: Record<string, unknown>) => (l.line_type === "closing" ? 0 : /consensus/i.test(String(l.sportsbook)) ? 1 : 2);
  const best = new Map<string, Record<string, unknown>>();
  for (const l of rows) { const k = l.game_id as string; const cur = best.get(k); if (!cur || rank(l) < rank(cur)) best.set(k, l); }
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return [...best.values()].map((l) => ({
    gameId: l.game_id as string, marketHomeMargin: n(l.market_home_margin), total: n(l.total),
    homeSpreadPrice: n(l.home_spread_price), awaySpreadPrice: n(l.away_spread_price), overPrice: n(l.over_price), underPrice: n(l.under_price),
    source: `${l.provider}:${l.line_type === "closing" ? "closing" : `provider ${l.sportsbook}`}`,
  }));
}
