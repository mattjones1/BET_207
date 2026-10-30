/**
 * Where jobs write. Two implementations with the same unique keys as the database:
 *   SupabaseStore  service-role client (pipeline only; bypasses RLS; never in the browser)
 *   MemoryStore    in-process maps, for --dry-run and tests (proves idempotency without a database)
 * Every write is an upsert or insert-if-absent. Nothing ever deletes, so a failed job can't erase good data.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { BacktestResult, Calibration, FitGame, ModelParams, Observation, Projection, SportKey } from "@bet207/core";
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

export interface RatingRow { teamId: string; asOf: string; mov: number; off: number; def: number; elo: number | null; gamesUsed: number; uncertainty: number }
export interface ProjectionRow extends Projection { sigma: number | null }

export interface Store {
  /** Every game of a sport as model input (finalAt from results). */
  fitGames(sport: SportKey): Promise<FitGame[]>;
  /** Find or create an immutable config by content hash; returns its id. */
  ensureConfig(sport: SportKey, name: string, params: ModelParams, hash: string, owner: string | null): Promise<string>;
  /** The config the user promoted for production, if any (user_settings.prefs.activeConfig[sport]). */
  activeConfig(sport: SportKey): Promise<{ id: string; params: ModelParams } | null>;
  startModelRun(configId: string, codeVersion: string, dataCutoff: string): Promise<string>;
  writeRatings(runId: string, rows: RatingRow[]): Promise<void>;
  writeProjections(runId: string, rows: ProjectionRow[]): Promise<void>;
  finishModelRun(runId: string, status: "success" | "failed", summary: Record<string, unknown>): Promise<void>;
  /** The calibration chosen by the newest backtest of this config, if one exists. */
  calibration(configId: string): Promise<Calibration | null>;
  /** Store a backtest summary and its per-game observations; returns the run id. */
  writeBacktest(configId: string, sport: SportKey, codeVersion: string, result: Omit<BacktestResult, "observations">, observations: Observation[]): Promise<string>;
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
  async fitGames(sport: SportKey) {
    const rows = await this.all<Record<string, unknown>>((a, b) => this.db.from("games")
      .select("id,season,start_time,home_team_id,away_team_id,neutral_site,home_rest,away_rest,game_results(home_score,away_score,final_at)")
      .eq("sport_id", SPORT_ID[sport]).neq("status", "canceled").order("start_time").order("id").range(a, b), "fit games");
    return rows.map((g) => {
      const r = (Array.isArray(g.game_results) ? g.game_results[0] : g.game_results) as { home_score: number; away_score: number; final_at: string } | null;
      return {
        id: g.id as string, season: g.season as number, startTime: g.start_time as string, finalAt: r?.final_at ?? null,
        homeTeamId: g.home_team_id as string, awayTeamId: g.away_team_id as string, neutralSite: g.neutral_site as boolean | null,
        homeRest: g.home_rest as number | null, awayRest: g.away_rest as number | null, homeScore: r?.home_score ?? null, awayScore: r?.away_score ?? null,
      };
    });
  }
  async ensureConfig(sport: SportKey, name: string, params: ModelParams, hash: string, owner: string | null) {
    const q = this.db.from("model_configs").select("id").eq("sport_id", SPORT_ID[sport]).eq("params_hash", hash);
    const found = this.check(await (owner ? q.eq("owner", owner) : q.is("owner", null)).limit(1), "find config") as { id: string }[];
    if (found[0]) return found[0].id;
    const vq = this.db.from("model_configs").select("version").eq("sport_id", SPORT_ID[sport]).eq("name", name);
    const prev = this.check(await (owner ? vq.eq("owner", owner) : vq.is("owner", null)).order("version", { ascending: false }).limit(1), "versions") as { version: number }[];
    const row = this.check(await this.db.from("model_configs").insert({ sport_id: SPORT_ID[sport], owner, name, version: (prev[0]?.version ?? 0) + 1, params, params_hash: hash })
      .select("id").single(), "insert config") as { id: string };
    return row.id;
  }
  async activeConfig(sport: SportKey) {
    const s = this.check(await this.db.from("user_settings").select("prefs").limit(1), "settings") as { prefs: { activeConfig?: Record<string, string> } }[];
    const id = s[0]?.prefs?.activeConfig?.[sport];
    if (!id) return null;
    const c = this.check(await this.db.from("model_configs").select("id,params").eq("id", id).eq("sport_id", SPORT_ID[sport]).limit(1), "active config") as { id: string; params: ModelParams }[];
    return c[0] ?? null;
  }
  async startModelRun(configId: string, codeVersion: string, dataCutoff: string) {
    const r = this.check(await this.db.from("model_runs").insert({ config_id: configId, kind: "production", code_version: codeVersion, data_cutoff: dataCutoff, status: "running" }).select("id").single(), "start model run") as { id: string };
    return r.id;
  }
  async writeRatings(runId: string, rows: RatingRow[]) {
    for (const c of chunks(rows)) this.check(await this.db.from("team_ratings").insert(c.map((r) => ({
      run_id: runId, team_id: r.teamId, as_of: r.asOf, mov_rating: r.mov, off_rating: r.off, def_rating: r.def, elo: r.elo, games_used: r.gamesUsed, uncertainty: r.uncertainty,
    }))), "ratings");
  }
  async writeProjections(runId: string, rows: ProjectionRow[]) {
    for (const c of chunks(rows)) this.check(await this.db.from("game_projections").insert(c.map((p) => ({
      run_id: runId, game_id: p.gameId, proj_home_margin: p.homeMargin, proj_total: p.total, elo_home_margin: p.eloMargin, sigma: p.sigma,
      status: p.status, explanation: { ...p.explanation, statusReason: p.statusReason, homeUncertainty: p.homeUncertainty, awayUncertainty: p.awayUncertainty },
    }))), "projections");
  }
  async finishModelRun(runId: string, status: "success" | "failed", summary: Record<string, unknown>) {
    this.check(await this.db.from("model_runs").update({ status, finished_at: new Date().toISOString(), summary }).eq("id", runId), "finish model run");
  }
  async calibration(configId: string) {
    const r = this.check(await this.db.from("backtest_runs").select("summary").eq("config_id", configId).is("owner", null).order("created_at", { ascending: false }).limit(1), "calibration") as { summary: { calibration?: { chosen?: Calibration } } }[];
    return r[0]?.summary?.calibration?.chosen ?? null;
  }
  async writeBacktest(configId: string, sport: SportKey, codeVersion: string, result: Omit<BacktestResult, "observations">, observations: Observation[]) {
    const run = this.check(await this.db.from("backtest_runs").insert({
      config_id: configId, owner: null, sport_id: SPORT_ID[sport], seasons: result.seasons, method: "walk_forward",
      line_source: result.lineSources.join(", ") || "none", code_version: codeVersion, summary: result,
    }).select("id").single(), "backtest run") as { id: string };
    for (const c of chunks(observations)) this.check(await this.db.from("backtest_observations").insert(c.map((o) => ({
      run_id: run.id, game_id: o.gameId, proj_home_margin: o.projHomeMargin, market_home_margin: o.marketHomeMargin, actual_margin: o.actualMargin,
      edge: o.edge, bucket: o.bucket, ats_result: o.ats, proj_total: o.projTotal, market_total: o.marketTotal, actual_total: o.actualTotal,
      ou_result: o.ou, p_cover: o.pCover, price: o.price, units: o.units,
    }))), "backtest observations");
    return run.id;
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

  async fitGames(sport: SportKey) {
    return [...this.games.values()].filter((g) => g.sport_id === SPORT_ID[sport]).sort((a, b) => a.start_time.localeCompare(b.start_time)).map((g) => {
      const r = this.results.get(g.id);
      return { id: g.id, season: g.season, startTime: g.start_time, finalAt: r?.finalAt ?? null, homeTeamId: g.home_team_id, awayTeamId: g.away_team_id,
        neutralSite: g.neutral_site, homeRest: g.home_rest, awayRest: g.away_rest, homeScore: r?.homeScore ?? null, awayScore: r?.awayScore ?? null };
    });
  }
  configs = new Map<string, { id: string; sport: SportKey; params: ModelParams }>();
  modelRuns = new Map<string, { configId: string; status: string; ratings: RatingRow[]; projections: ProjectionRow[]; summary?: Record<string, unknown> }>();
  async ensureConfig(sport: SportKey, _name: string, params: ModelParams, hash: string) {
    const k = sport + "|" + hash;
    if (!this.configs.has(k)) this.configs.set(k, { id: this.id("config"), sport, params });
    return this.configs.get(k)!.id;
  }
  async activeConfig(_sport: SportKey) { return null; }
  async startModelRun(configId: string) { const id = this.id("run"); this.modelRuns.set(id, { configId, status: "running", ratings: [], projections: [] }); return id; }
  async writeRatings(runId: string, rows: RatingRow[]) { this.modelRuns.get(runId)!.ratings.push(...rows); }
  async writeProjections(runId: string, rows: ProjectionRow[]) { this.modelRuns.get(runId)!.projections.push(...rows); }
  async finishModelRun(runId: string, status: "success" | "failed", summary: Record<string, unknown>) { Object.assign(this.modelRuns.get(runId)!, { status, summary }); }
  backtests: { configId: string; result: Omit<BacktestResult, "observations">; observations: Observation[] }[] = [];
  async calibration(configId: string) { return this.backtests.filter((b) => b.configId === configId).at(-1)?.result.calibration.chosen ?? null; }
  async writeBacktest(configId: string, _sport: SportKey, _code: string, result: Omit<BacktestResult, "observations">, observations: Observation[]) {
    this.backtests.push({ configId, result, observations }); return this.id("backtest");
  }
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
