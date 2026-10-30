/**
 * Runs every migration against a real Postgres (PGlite, in-process WASM) with a minimal stand-in for
 * Supabase's auth schema and roles, then checks constraints and Row Level Security.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

const DIR = join(__dirname, "..", "migrations");
const U1 = "11111111-1111-1111-1111-111111111111";
const U2 = "22222222-2222-2222-2222-222222222222";

// What Supabase provides that the migrations rely on.
const SUPABASE_STUB = `
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid $$;
  grant usage on schema auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`;

let db: PGlite;
async function as(user: string | null, sql: string, params: unknown[] = []) {
  await db.exec(user ? `set role authenticated; select set_config('request.jwt.claims', '{"sub":"${user}"}', false);` : "set role anon;");
  try { return await db.query(sql, params); } finally { await db.exec("reset role;"); }
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_STUB);
  for (const f of readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(join(DIR, f), "utf8"));
  }
  await db.exec(`
    insert into auth.users values ('${U1}', 'one@example.com'), ('${U2}', 'two@example.com');
    insert into teams (sport_id, abbr, name) values (1, 'AAA', 'Team A'), (1, 'BBB', 'Team B');
    insert into games (sport_id, season, season_type, start_time, home_team_id, away_team_id, provider, provider_event_id, retrieved_at)
      select 1, 2026, 'regular', now(), a.id, b.id, 'test', 'g1', now() from teams a, teams b where a.abbr='AAA' and b.abbr='BBB';
  `);
}, 60_000);

describe("migrations", () => {
  it("seed the three sports", async () => {
    const r = await db.query<{ key: string }>("select key from sports order by id");
    expect(r.rows.map((x) => x.key)).toEqual(["nfl", "ncaaf", "nba"]);
  });

  it("never duplicate a game from the same provider (idempotent ingestion)", async () => {
    await expect(db.exec(`insert into games (sport_id, season, season_type, start_time, home_team_id, away_team_id, provider, provider_event_id, retrieved_at)
      select sport_id, season, season_type, start_time, home_team_id, away_team_id, provider, provider_event_id, now() from games where provider_event_id='g1'`)).rejects.toThrow(/duplicate key/);
  });

  it("never duplicate an odds snapshot on retry", async () => {
    const ins = `insert into odds_snapshots (game_id, sportsbook_id, market, home_point, home_price, away_price, source_updated_at, retrieved_at, provider)
      select g.id, b.id, 'spread', -3.5, -110, -110, '2026-10-30T12:00:00Z', now(), 'the-odds-api' from games g, sportsbooks b where g.provider_event_id='g1' and b.key='draftkings'
      on conflict (game_id, sportsbook_id, market, source_updated_at) do nothing`;
    await db.exec(ins); await db.exec(ins);
    const r = await db.query<{ n: number }>("select count(*)::int as n from odds_snapshots");
    expect(r.rows[0]!.n).toBe(1);
  });

  it("refuse a team playing itself and unnormalized aliases", async () => {
    await expect(db.exec(`insert into games (sport_id, season, season_type, start_time, home_team_id, away_team_id, provider, provider_event_id, retrieved_at)
      select 1, 2026, 'regular', now(), id, id, 'test', 'self', now() from teams where abbr='AAA'`)).rejects.toThrow();
    await expect(db.exec(`insert into team_aliases (sport_id, provider, alias, team_id) select 1, 'x', 'Mixed Case', id from teams where abbr='AAA'`)).rejects.toThrow();
  });
});

describe("row level security", () => {
  it("signed-in users can read shared sports data; anonymous users can't", async () => {
    expect((await as(U1, "select count(*)::int as n from games")).rows[0]).toEqual({ n: 1 });
    await expect(as(null, "select count(*) from games")).rejects.toThrow(/permission denied/);
  });

  it("clients can't write shared data", async () => {
    await expect(as(U1, "insert into sportsbooks (key, name) values ('evil', 'Evil')")).rejects.toThrow(/row-level security/);
    await as(U1, "delete from games");
    expect((await db.query<{ n: number }>("select count(*)::int as n from games")).rows[0]!.n).toBe(1);
  });

  it("research notes are private to their owner", async () => {
    await as(U1, "insert into research_notes (game_id, lean) select id, 'user one only' from games limit 1");
    expect((await as(U1, "select lean from research_notes")).rows).toEqual([{ lean: "user one only" }]);
    expect((await as(U2, "select lean from research_notes")).rows).toEqual([]);
    await as(U2, "update research_notes set lean = 'hijacked'");
    expect((await as(U1, "select lean from research_notes")).rows).toEqual([{ lean: "user one only" }]);
    await expect(as(U2, `insert into research_notes (owner, game_id, lean) select '${U1}', id, 'forged' from games limit 1`)).rejects.toThrow(/row-level security/);
  });

  it("model configs: system rows readable, user rows private and immutable", async () => {
    await db.exec(`insert into model_configs (sport_id, owner, name, version, params, params_hash) values (1, null, 'default', 1, '{}', 'h0')`);
    await as(U1, `insert into model_configs (sport_id, owner, name, version, params, params_hash) values (1, '${U1}', 'mine', 1, '{"hfa":2}', 'h1')`);
    expect((await as(U2, "select name from model_configs order by name")).rows).toEqual([{ name: "default" }]);
    expect((await as(U1, "select name from model_configs order by name")).rows).toEqual([{ name: "default" }, { name: "mine" }]);
    await as(U1, `update model_configs set params = '{"hfa":9}' where name = 'mine'`);
    expect((await as(U1, "select params from model_configs where name = 'mine'")).rows[0]).toEqual({ params: { hfa: 2 } });
  });
});
