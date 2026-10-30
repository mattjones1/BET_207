import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { homeSpreadFromMargin } from "@bet207/core";
import { parseGames, parseTeams } from "./nflverse";

// Trimmed real rows recorded from nflverse on October 30, 2026.
const FIX = join(import.meta.dirname, "../../../../fixtures/nflverse");
const games = parseGames(readFileSync(join(FIX, "games-sample.csv"), "utf8"));
const byId = (id: string) => games.games.find((g) => g.providerEventId === id)!;
const line = (id: string) => games.lines.find((l) => l.providerEventId === id);

describe("nflverse games", () => {
  it("parses every row without issues", () => {
    expect(games.games).toHaveLength(7);
    expect(games.issues).toEqual([]);
  });
  it("keeps spread_line as the home margin: KC (home) favored by 3 over BAL is KC −3", () => {
    expect(line("2024_01_BAL_KC")!.marketHomeMargin).toBe(3);
    expect(homeSpreadFromMargin(line("2024_01_BAL_KC")!.marketHomeMargin)).toBe(-3);
    // A home underdog: OAK +3 vs TEN in 2019 → margin −3.
    expect(line("2019_14_TEN_OAK")!.marketHomeMargin).toBe(-3);
  });
  it("scores and result agree (home − away)", () => {
    const g = byId("2024_01_BAL_KC");
    expect(g.homeScore! - g.awayScore!).toBe(7);
    expect(g.status).toBe("final");
  });
  it("flags neutral sites (GB at PHI in São Paulo)", () => {
    expect(byId("2024_01_GB_PHI").neutralSite).toBe(true);
    expect(byId("2024_01_BAL_KC").neutralSite).toBe(false);
  });
  it("converts Eastern kickoff to UTC across DST", () => {
    expect(byId("2024_01_BAL_KC").startTime).toBe("2024-09-06T00:20:00.000Z"); // Thu 8:20pm EDT
    expect(byId("2026_18_DAL_WAS").startTime).toBe("2027-01-10T18:00:00.000Z"); // Sun 1:00pm EST
  });
  it("maps relocated franchises to one identity", () => {
    expect(byId("2019_14_TEN_OAK").homeAbbr).toBe("LV");
  });
  it("future games have no result, no final time, and no invented line", () => {
    const g = byId("2026_18_DAL_WAS");
    expect([g.status, g.homeScore, g.finalAt]).toEqual(["scheduled", null, null]);
    expect(line("2026_18_DAL_WAS")).toBeUndefined();
  });
  it("keeps closing prices and labels the line as closing", () => {
    const l = line("2024_01_BAL_KC")!;
    expect(l.lineType).toBe("closing");
    expect(l.homeSpreadPrice).toBe(-102);
    expect(l.total).not.toBeNull();
  });
});

describe("nflverse teams", () => {
  const teams = parseTeams(readFileSync(join(FIX, "teams.csv"), "utf8"));
  it("has the 32 current franchises with divisions", () => {
    expect(teams).toHaveLength(32);
    expect(teams.find((t) => t.abbr === "KC")).toMatchObject({ name: "Kansas City Chiefs", conference: "AFC", division: "AFC West" });
  });
  it("relocated names stay aliases of the current franchise", () => {
    const lv = teams.find((t) => t.abbr === "LV")!;
    expect(lv.name).toBe("Las Vegas Raiders");
    expect(lv.aliases.map((a) => a.alias)).toEqual(expect.arrayContaining(["OAK", "Oakland Raiders", "Las Vegas Raiders"]));
  });
});
