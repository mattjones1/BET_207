/**
 * Where jobs write. Two implementations with the same unique keys as the database:
 *   SupabaseStore  service-role client (pipeline only; bypasses RLS; never in the browser)
 *   MemoryStore    in-process maps, for --dry-run and tests (proves idempotency without a database)
 * Every write is an upsert or insert-if-absent. Nothing ever deletes, so a failed job can't erase good data.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { SportKey } from "@bet207/core";
import type { NormalizedGame, NormalizedLine, NormalizedTeam } from "./adapters/types";
import { requireEnv } from "./lib/env";

export const SPORT_ID: Record<SportKey, number> = { nfl: 1, ncaaf: 2, nba: 3 };

export interface MatchGame { id: string; startTime: string; homeTeamId: string; awayTeamId: string }
export interface OddsRow {
  gameId: string; sportsbookId: number; market: "spread" | "total" | "h2h";
  homePoint: number | null; homePrice: number | null; awayPrice: number | null;
  totalPoint: number | null; overPrice: number | null; underPrice: number | null;
  sourceUpdatedAt: string; retrievedAt: string; provider: string;
}
export interface RunOutcome { status: "success" | "failed" | "skipped"; rows: number; error?: string; details?: Record<string, unknown> }

export interface Store {
  upsertTeams(sport: SportKey, teams: NormalizedTeam[]): Promise<Map<string, string>>;
  aliasMap(sport: SportKey): Promise<Map<string, string>>;
  upsertGames(games: NormalizedGame[], teamIds: Map<string, string>, retrievedAt: string): Promise<Map<string, string>>;
  upsertLines(lines: NormalizedLine[], gameIds: Map<string, string>, retrievedAt: string): Promise<number>;
  gamesBetween(sport: SportKey, fromIso: string, toIso: string): Promise<MatchGame[]>;
  linkProviderIds(provider: string, links: { gameId: string; key: string }[]): Promise<void>;
  upsertSportsbooks(books: { key: string; name: string }[]): Promise<Map<string, number>>;
  insertOdds(rows: OddsRow[]): Promise<number>;
  startRun(job: string, sport: SportKey | null): Promise<number>;
  finishRun(id: number, outcome: RunOutcome): Promise<void>;
  recordQuota(provider: string, q: { remaining: number | null; used: number | null; last: number | null }): Promise<void>;
  latestQuota(provider: string): Promise<number | null>;
}

const norm = (s: string) => s.trim().toLowerCase();
const chunks = <T>(a: T[], n = 500) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, (i + 1) * n));

function gameRow(g: NormalizedGame, teamIds: Map<string, string>, retrievedAt: string) {
  const home = teamIds.get(g.homeAbbr), away = teamIds.get(g.awayAbbr);
  if (!home || !away) throw new Error(`Unknown team in ${g.provider}:${g.providerEventId} (${g.awayAbbr} @ ${g.homeAbbr})`);
  return {
    sport_id: SPORT_ID[g.sport], season: g.season, season_type: g.seasonType, week: g.week, start_time: g.startTime,
    home_team_id: home, away_team_id: away, neutral_site: g.neutralSite, venue: g.venue, home_rest: g.homeRest, away_rest: g.awayRest,
    status: g.status, provider: g.provider, provider_event_id: g.providerEventId, retrieved_at: retrievedAt,
    source_updated_at: g.sourceUpdatedAt, completeness: g.completeness,
  };
}

// ───────────────────────── Supabase ─────────────────────────
export class SupabaseStore implements Store {
  private db: SupabaseClient;
  constructor() {
    this.db = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  }
  /** PostgREST returns at most 1,000 rows per request by default, so page through. */
  private async all<T>(make: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>, what: string): Promise<T[]> {
    const out: T[] = [];
    for (let from = 0; ; from += 1000) {
      const r = await make(from, from + 999);
      if (r.error) throw new Error(`${what}: ${r.error.message}`);
      out.push(...(r.data ?? []));
      if (!r.data || r.data.length < 1000) return out;
    }
  }
  private check<T>(r: { data: T; error: { message: string } | null }, what: string): T {
    if (r.error) throw new Error(`${what}: ${r.error.message}`);
    return r.data;
  }

  async upsertTeams(sport: SportKey, teams: NormalizedTeam[]) {
    const ids = new Map<string, string>();
    for (const c of chunks(teams)) {
      const data = this.check(await this.db.from("teams").upsert(
        c.map((t) => ({ sport_id: SPORT_ID[sport], abbr: t.abbr, name: t.name, conference: t.conference, division: t.division })),
        { onConflict: "sport_id,abbr" }).select("id,abbr"), "upsert teams") as { id: string; abbr: string }[];
      for (const r of data) ids.set(r.abbr, r.id);
    }
    const aliases = new Map<string, { sport_id: number; provider: string; alias: string; team_id: string }>();
    for (const t of teams) for (const a of t.aliases) {
      const alias = norm(a.alias);
      if (alias) aliases.set(`${a.provider}|${alias}`, { sport_id: SPORT_ID[sport], provider: a.provider, alias, team_id: ids.get(t.abbr)! });
    }
    for (const c of chunks([...aliases.values()])) this.check(await this.db.from("team_aliases").upsert(c, { onConflict: "sport_id,provider,alias" }), "upsert aliases");
    return ids;
  }

  async aliasMap(sport: SportKey) {
    const m = new Map<string, string>();
    const teams = await this.all<{ id: string; abbr: string; name: string }>((a, b) => this.db.from("teams").select("id,abbr,name").eq("sport_id", SPORT_ID[sport]).order("id").range(a, b), "teams");
    for (const t of teams) { m.set(norm(t.abbr), t.id); m.set(norm(t.name), t.id); }
    const al = await this.all<{ alias: string; team_id: string }>((a, b) => this.db.from("team_aliases").select("alias,team_id").eq("sport_id", SPORT_ID[sport]).order("alias").range(a, b), "aliases");
    for (const a of al) m.set(a.alias, a.team_id);
    return m;
  }

  async upsertGames(games: NormalizedGame[], teamIds: Map<string, string>, retrievedAt: string) {
    const ids = new Map<string, string>();
    for (const c of chunks(games)) {
      const data = this.check(await this.db.from("games").upsert(c.map((g) => gameRow(g, teamIds, retrievedAt)), { onConflict: "provider,provider_event_id" })
        .select("id,provider_event_id"), "upsert games") as { id: string; provider_event_id: string }[];
      for (const r of data) ids.set(r.provider_event_id, r.id);
      const results = c.filter((g) => g.status === "final" && g.homeScore !== null && g.awayScore !== null).map((g) => ({
        game_id: ids.get(g.providerEventId)!, home_score: g.homeScore, away_score: g.awayScore, overtime: g.overtime,
        final_at: g.finalAt, provider: g.provider, retrieved_at: retrievedAt,
      }));
      if (results.length) this.check(await this.db.from("game_results").upsert(results, { onConflict: "game_id" }), "upsert results");
    }
    return ids;
  }

  async upsertLines(lines: NormalizedLine[], gameIds: Map<string, string>, retrievedAt: string) {
    const rows = lines.filter((l) => gameIds.has(l.providerEventId)).map((l) => ({
      game_id: gameIds.get(l.providerEventId)!, provider: l.provider, line_type: l.lineType, sportsbook: l.sportsbook,
      market_home_margin: l.marketHomeMargin, home_spread_price: l.homeSpreadPrice, away_spread_price: l.awaySpreadPrice,
      total: l.total, over_price: l.overPrice, under_price: l.underPrice, home_moneyline: l.homeMoneyline, away_moneyline: l.awayMoneyline,
      retrieved_at: retrievedAt,
    }));
    for (const c of chunks(rows)) this.check(await this.db.from("historical_lines").upsert(c, { onConflict: "game_id,provider,line_type,sportsbook" }), "upsert lines");
    return rows.length;
  }

  async gamesBetween(sport: SportKey, fromIso: string, toIso: string) {
    const data = await this.all<{ id: string; start_time: string; home_team_id: string; away_team_id: string }>((a, b) => this.db.from("games")
      .select("id,start_time,home_team_id,away_team_id").eq("sport_id", SPORT_ID[sport]).gte("start_time", fromIso).lte("start_time", toIso).order("id").range(a, b), "games between");
    return data.map((g) => ({ id: g.id, startTime: g.start_time, homeTeamId: g.home_team_id, awayTeamId: g.away_team_id }));
  }

  async linkProviderIds(provider: string, links: { gameId: string; key: string }[]) {
    if (!links.length) return;
    this.check(await this.db.from("game_provider_ids").upsert(links.map((l) => ({ game_id: l.gameId, provider, provider_key: l.key })), { onConflict: "provider,provider_key" }), "link ids");
  }

  async upsertSportsbooks(books: { key: string; name: string }[]) {
    if (books.length) this.check(await this.db.from("sportsbooks").upsert(books, { onConflict: "key", ignoreDuplicates: true }), "sportsbooks");
    const data = this.check(await this.db.from("sportsbooks").select("id,key"), "sportsbooks") as { id: number; key: string }[];
    return new Map(data.map((b) => [b.key, b.id]));
  }

  async insertOdds(rows: OddsRow[]) {
    let n = 0;
    for (const c of chunks(rows)) {
      const data = this.check(await this.db.from("odds_snapshots").upsert(c.map((r) => ({
        game_id: r.gameId, sportsbook_id: r.sportsbookId, market: r.market, home_point: r.homePoint, home_price: r.homePrice, away_price: r.awayPrice,
        total_point: r.totalPoint, over_price: r.overPrice, under_price: r.underPrice, source_updated_at: r.sourceUpdatedAt,
        retrieved_at: r.retrievedAt, provider: r.provider,
      })), { onConflict: "game_id,sportsbook_id,market,source_updated_at", ignoreDuplicates: true }).select("id"), "insert odds") as unknown[];
      n += data.length;
    }
    return n;
  }

  async startRun(job: string, sport: SportKey | null) {
    const d = this.check(await this.db.from("pipeline_runs").insert({ job, sport, status: "running" }).select("id").single(), "start run") as { id: number };
    return d.id;
  }
  async finishRun(id: number, o: RunOutcome) {
    this.check(await this.db.from("pipeline_runs").update({
      status: o.status, finished_at: new Date().toISOString(), rows_upserted: o.rows, error: o.error ?? null, details: o.details ?? {},
    }).eq("id", id), "finish run");
  }
  async recordQuota(provider: string, q: { remaining: number | null; used: number | null; last: number | null }) {
    this.check(await this.db.from("api_quota").insert({ provider, remaining: q.remaining, used: q.used, last_cost: q.last }), "quota");
  }
  async latestQuota(provider: string) {
    const d = this.check(await this.db.from("api_quota").select("remaining,checked_at").eq("provider", provider).order("checked_at", { ascending: false }).limit(1), "quota") as { remaining: number | null; checked_at: string }[];
    const row = d[0];
    if (!row) return null;
    // A reading from a previous month says nothing about this month's allowance.
    const then = new Date(row.checked_at), now = new Date();
    return then.getUTCMonth() === now.getUTCMonth() && then.getUTCFullYear() === now.getUTCFullYear() ? row.remaining : null;
  }
}

// ───────────────────────── Memory ─────────────────────────
export class MemoryStore implements Store {
  teams = new Map<string, { id: string; sport: SportKey; abbr: string; name: string }>();     // key sport|abbr
  aliases = new Map<string, string>();                                                       // sport|provider|alias → team id
  games = new Map<string, ReturnType<typeof gameRow> & { id: string }>();                   // provider|eventId
  results = new Map<string, NormalizedGame>();
  lines = new Map<string, NormalizedLine & { gameId: string }>();
  links = new Map<string, string>();
  books = new Map<string, number>();
  odds = new Map<string, OddsRow>();
  runs: (RunOutcome & { job: string; sport: SportKey | null })[] = [];
  quota: { provider: string; remaining: number | null }[] = [];
  private seq = 0;
  private id = (p: string) => `${p}-${++this.seq}`;

  async upsertTeams(sport: SportKey, teams: NormalizedTeam[]) {
    const ids = new Map<string, string>();
    for (const t of teams) {
      const k = `${sport}|${t.abbr}`;
      const row = this.teams.get(k) ?? { id: this.id("team"), sport, abbr: t.abbr, name: t.name };
      row.name = t.name; this.teams.set(k, row); ids.set(t.abbr, row.id);
      for (const a of t.aliases) if (norm(a.alias)) this.aliases.set(`${sport}|${a.provider}|${norm(a.alias)}`, row.id);
    }
    return ids;
  }
  async aliasMap(sport: SportKey) {
    const m = new Map<string, string>();
    for (const t of this.teams.values()) if (t.sport === sport) { m.set(norm(t.abbr), t.id); m.set(norm(t.name), t.id); }
    for (const [k, v] of this.aliases) { const [s, , alias] = k.split("|"); if (s === sport) m.set(alias!, v); }
    return m;
  }
  async upsertGames(games: NormalizedGame[], teamIds: Map<string, string>, retrievedAt: string) {
    const ids = new Map<string, string>();
    for (const g of games) {
      const k = `${g.provider}|${g.providerEventId}`;
      const id = this.games.get(k)?.id ?? this.id("game");
      this.games.set(k, { ...gameRow(g, teamIds, retrievedAt), id });
      ids.set(g.providerEventId, id);
      if (g.status === "final" && g.homeScore !== null) this.results.set(id, g);
    }
    return ids;
  }
  async upsertLines(lines: NormalizedLine[], gameIds: Map<string, string>, _retrievedAt?: string) {
    let n = 0;
    for (const l of lines) {
      const gameId = gameIds.get(l.providerEventId);
      if (!gameId) continue;
      this.lines.set(`${gameId}|${l.provider}|${l.lineType}|${l.sportsbook}`, { ...l, gameId }); n++;
    }
    return n;
  }
  async gamesBetween(sport: SportKey, fromIso: string, toIso: string) {
    return [...this.games.values()].filter((g) => g.sport_id === SPORT_ID[sport] && g.start_time >= fromIso && g.start_time <= toIso)
      .map((g) => ({ id: g.id, startTime: g.start_time, homeTeamId: g.home_team_id, awayTeamId: g.away_team_id }));
  }
  async linkProviderIds(provider: string, links: { gameId: string; key: string }[]) { for (const l of links) this.links.set(`${provider}|${l.key}`, l.gameId); }
  async upsertSportsbooks(books: { key: string; name: string }[]) {
    for (const b of books) if (!this.books.has(b.key)) this.books.set(b.key, this.books.size + 1);
    return new Map(this.books);
  }
  async insertOdds(rows: OddsRow[]) {
    let n = 0;
    for (const r of rows) { const k = `${r.gameId}|${r.sportsbookId}|${r.market}|${r.sourceUpdatedAt}`; if (!this.odds.has(k)) { this.odds.set(k, r); n++; } }
    return n;
  }
  async startRun(job: string, sport: SportKey | null) { this.runs.push({ job, sport, status: "skipped", rows: 0 }); return this.runs.length - 1; }
  async finishRun(id: number, o: RunOutcome) { Object.assign(this.runs[id]!, o); }
  async recordQuota(provider: string, q: { remaining: number | null }) { this.quota.push({ provider, remaining: q.remaining }); }
  async latestQuota(provider: string) { return this.quota.filter((q) => q.provider === provider).at(-1)?.remaining ?? null; }
}
