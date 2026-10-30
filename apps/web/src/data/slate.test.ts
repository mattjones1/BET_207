import { describe, expect, it } from "vitest";
import type { SeasonData, GameRow } from "./source";
import { buildSlate, defaultGroup, etDate, groupSlates } from "./slate";

const game = (id: string, week: number, start: string, home: string, away: string, hs: number | null = null, as: number | null = null): GameRow => ({
  id, season: 2026, seasonType: "regular", week, startTime: start, homeTeamId: home, awayTeamId: away, neutralSite: false, venue: null,
  homeRest: 7, awayRest: 7, status: hs === null ? "scheduled" : "final", homeScore: hs, awayScore: as, completeness: "complete",
});
const team = (id: string) => ({ id, sport: "nfl" as const, abbr: id, name: id, conference: null, division: null });
const games = [
  game("a", 1, "2026-09-10T00:20:00Z", "KC", "BAL", 24, 17),
  game("b", 2, "2026-09-17T00:15:00Z", "BAL", "KC"),
  game("c", 2, "2026-09-20T17:00:00Z", "BUF", "MIA"),
];
const season: SeasonData = { sport: "nfl", season: 2026, teams: new Map(["KC", "BAL", "BUF", "MIA"].map((t) => [t, team(t)])), games, note: null };

describe("slate grouping", () => {
  it("groups football by week and opens on the next unplayed week", () => {
    const g = groupSlates("nfl", games);
    expect(g.map((x) => x.label)).toEqual(["Week 1", "Week 2"]);
    expect(defaultGroup(g, new Date("2026-09-12T00:00:00Z"))!.label).toBe("Week 2");
  });
  it("groups basketball by Eastern date (a 10:30pm ET tip stays on its date)", () => {
    expect(etDate("2026-11-04T03:30:00Z")).toBe("2026-11-03");
  });
});

describe("slate rows", () => {
  it("labels a final game's imported line as a retrospective closing line", () => {
    const m = { snaps: new Map(), books: [], lines: new Map([["a", [{ gameId: "a", provider: "nflverse" as const, lineType: "closing" as const, sportsbook: "", marketHomeMargin: 3,
      homeSpreadPrice: null, awaySpreadPrice: null, total: 47, overPrice: null, underPrice: null, homeMoneyline: null, awayMoneyline: null }]]]) };
    expect(buildSlate(season, [games[0]!], m, "consensus", new Date())[0]!.flags.map((f) => f.key)).toEqual(["closing"]);
  });
  const markets = {
    snaps: new Map(),
    lines: new Map([["b", [{ gameId: "b", provider: "nflverse" as const, lineType: "closing" as const, sportsbook: "", marketHomeMargin: -2.5,
      homeSpreadPrice: -110, awaySpreadPrice: -110, total: 47.5, overPrice: -110, underPrice: -110, homeMoneyline: null, awayMoneyline: null }]]]),
    books: [],
  };
  const rows = buildSlate(season, games.slice(1), markets, "consensus", new Date("2026-09-12T00:00:00Z"));
  it("shows records entering the game only", () => {
    expect([rows[0]!.homeRecord, rows[0]!.awayRecord]).toEqual(["0-1", "1-0"]);
  });
  it("labels an imported line on an unplayed game as pre-game (not closing), and a missing line as missing", () => {
    expect(rows[0]!.market).toMatchObject({ homeMargin: -2.5, source: "closing" });
    expect(rows[0]!.flags.map((f) => f.key)).toEqual(["pregame"]);
    expect(rows[1]!.market).toBeNull();
    expect(rows[1]!.flags.map((f) => f.key)).toEqual(["noline"]);
  });
});
