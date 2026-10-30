import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as nflverse from "../adapters/nflverse";
import * as oddsApi from "../adapters/oddsApi";
import { MemoryStore } from "../store";
import { parseSeasons } from "./context";
import { fillRest } from "./results";
import { matchEvent, storeOdds } from "./odds";

const FIX = join(import.meta.dirname, "../../../../fixtures");

async function loadNfl(store: MemoryStore) {
  const teams = nflverse.parseTeams(readFileSync(join(FIX, "nflverse/teams.csv"), "utf8"));
  const parsed = nflverse.parseGames(readFileSync(join(FIX, "nflverse/games-sample.csv"), "utf8"));
  const ids = await store.upsertTeams("nfl", teams);
  const gameIds = await store.upsertGames(parsed.games, ids, "2026-10-30T00:00:00Z");
  await store.upsertLines(parsed.lines, gameIds, "2026-10-30T00:00:00Z");
  return { ids, gameIds };
}

describe("ingestion is idempotent", () => {
  it("running the same load twice leaves the same rows", async () => {
    const store = new MemoryStore();
    await loadNfl(store);
    const counts = () => [store.teams.size, store.games.size, store.results.size, store.lines.size];
    const first = counts();
    const firstIds = [...store.games.values()].map((g) => g.id);
    await loadNfl(store);
    expect(counts()).toEqual(first);
    expect([...store.games.values()].map((g) => g.id)).toEqual(firstIds);
    expect(first).toEqual([32, 7, 6, 6]);
  });
});

describe("odds matching", () => {
  it("links an event to our game by team names and start time, and never duplicates snapshots", async () => {
    const store = new MemoryStore();
    await loadNfl(store);
    // A real 2024 game (BAL @ KC, 2024-09-06 00:20Z) priced in Odds API shape.
    const event: oddsApi.OddsEvent = {
      eventId: "evt1", commenceTime: "2024-09-06T00:20:00.000Z", homeName: "Kansas City Chiefs", awayName: "Baltimore Ravens",
      snapshots: [{ sportsbook: { key: "draftkings", name: "DraftKings" }, market: "spread", homePoint: -3, homePrice: -110, awayPrice: -110, totalPoint: null, overPrice: null, underPrice: null, sourceUpdatedAt: "2024-09-05T12:00:00Z" }],
    };
    const r1 = await storeOdds(store, "nfl", [event], "2024-09-05T12:05:00Z");
    const r2 = await storeOdds(store, "nfl", [event], "2024-09-05T18:05:00Z");
    expect([r1.matched, r1.inserted, r2.inserted]).toEqual([1, 1, 0]);
    expect(store.links.get("the-odds-api|evt1")).toBeDefined();
  });

  it("refuses unknown teams, missing games, and reversed home/away", async () => {
    const store = new MemoryStore();
    await loadNfl(store);
    const aliases = await store.aliasMap("nfl");
    const cands = await store.gamesBetween("nfl", "2024-09-01T00:00:00Z", "2024-09-10T00:00:00Z");
    const ev = (home: string, away: string, t = "2024-09-06T00:20:00Z") => ({ eventId: "x", commenceTime: t, homeName: home, awayName: away, snapshots: [] });
    expect(matchEvent(ev("Kansas City Chiefs", "Gotham Knights"), aliases, cands)).toEqual({ problem: "unknown team name: Gotham Knights" });
    expect(matchEvent(ev("Kansas City Chiefs", "Baltimore Ravens", "2024-12-01T00:00:00Z"), aliases, cands)).toMatchObject({ problem: /no matching game/ });
    expect(matchEvent(ev("Baltimore Ravens", "Kansas City Chiefs"), aliases, cands)).toMatchObject({ problem: /reversed/ });
  });

  it("old franchise names still resolve (Oakland Raiders → LV)", async () => {
    const store = new MemoryStore();
    await loadNfl(store);
    const aliases = await store.aliasMap("nfl");
    expect(aliases.get("oakland raiders")).toBe(aliases.get("las vegas raiders"));
  });
});

describe("helpers", () => {
  it("parses season ranges", () => {
    expect(parseSeasons("2019-2021,2024")).toEqual([2019, 2020, 2021, 2024]);
    expect(parseSeasons(undefined)).toEqual([]);
    expect(() => parseSeasons("abc")).toThrow();
  });
  it("fills missing rest from the schedule but keeps provider values", () => {
    const g = (id: string, start: string, home: string, away: string, hr: number | null = null) => ({
      sport: "nba" as const, provider: "t", providerEventId: id, season: 2025, seasonType: "regular" as const, week: null, startTime: start,
      homeAbbr: home, awayAbbr: away, neutralSite: null, venue: null, homeRest: hr, awayRest: null, status: "scheduled" as const,
      homeScore: null, awayScore: null, overtime: null, finalAt: null, sourceUpdatedAt: null, completeness: "complete" as const,
    });
    const games = [g("1", "2025-11-01T23:00:00Z", "BOS", "NYK"), g("2", "2025-11-02T23:00:00Z", "BOS", "MIA", 9)];
    fillRest(games);
    expect([games[0]!.homeRest, games[1]!.homeRest]).toEqual([null, 9]);
  });
});

describe("rebuild-ratings", () => {
  it("writes an immutable run with ratings and projections; no sigma until a backtest exists", async () => {
    const { rebuildSport } = await import("./model");
    const store = new MemoryStore();
    await loadNfl(store);
    const r = await rebuildSport(store, "nfl", new Date("2026-12-01T00:00:00Z"), () => {});
    const runs = [...store.modelRuns.values()];
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe("success");
    expect(runs[0]!.projections.every((p) => p.sigma === null)).toBe(true);
    expect(r.rows).toBeGreaterThan(0);
    // A second run is a new run, not an overwrite; the same params reuse one config.
    await rebuildSport(store, "nfl", new Date("2026-12-02T00:00:00Z"), () => {});
    expect(store.modelRuns.size).toBe(2);
    expect(store.configs.size).toBe(1);
  });
});
