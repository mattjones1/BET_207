import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { homeSpreadFromMargin } from "@bet207/core";
import * as cfbd from "./cfbd";
import * as bdl from "./balldontlie";
import * as odds from "./oddsApi";

const FIX = join(import.meta.dirname, "../../../../fixtures");
const json = (p: string) => JSON.parse(readFileSync(join(FIX, p), "utf8"));

describe("CFBD", () => {
  const teams = cfbd.parseTeams(json("cfbd/teams.json"));
  const fbs = new Set(teams.filter((t) => t.abbr !== cfbd.FCS_ABBR).map((t) => t.abbr));
  const { games, issues } = cfbd.parseGames(json("cfbd/games.json"), fbs);

  it("pools non-FBS opponents and drops FCS-only games", () => {
    expect(games.map((g) => g.providerEventId)).toEqual(["401", "402", "403"]);
    expect(games.find((g) => g.providerEventId === "402")!.awayAbbr).toBe("FCS");
    expect(issues).toEqual([]);
  });
  it("keeps neutral sites and marks TBD kickoffs partial", () => {
    expect(games[0]!.neutralSite).toBe(true);
    expect(games.find((g) => g.providerEventId === "403")).toMatchObject({ completeness: "partial", status: "scheduled", homeScore: null });
  });
  it("adds odds-style full names as aliases", () => {
    expect(teams.find((t) => t.abbr === "Alabama")!.aliases.map((a) => a.alias)).toContain("Alabama Crimson Tide");
  });

  it("reads the home spread from formattedSpread", () => {
    expect(cfbd.homeSpreadFromFormatted("Georgia -10.5", "Georgia", "Miami")).toBe(-10.5);
    expect(cfbd.homeSpreadFromFormatted("Georgia -2.5", "Alabama", "Georgia")).toBe(2.5);
    expect(cfbd.homeSpreadFromFormatted("PK", "A", "B")).toBe(0);
    expect(cfbd.homeSpreadFromFormatted("Somebody -3", "A", "B")).toBeNull();
  });

  const lines = cfbd.parseLines(json("cfbd/lines.json"));
  const get = (id: string, book: string, type = "provider") => lines.lines.find((l) => l.providerEventId === id && l.sportsbook === book && l.lineType === type);
  it("verifies each row's sign instead of assuming it", () => {
    // consensus: spread −10.5 matches "Georgia −10.5" with Georgia at home → market home margin +10.5
    expect(get("401", "consensus")!.marketHomeMargin).toBe(10.5);
    // Bovada reports +10.5 but the text says Georgia −10.5: inverted row, still home by 10.5
    expect(get("401", "Bovada")!.marketHomeMargin).toBe(10.5);
    // Away favorite: "Georgia −2.5" at Alabama → Alabama +2.5 → home margin −2.5
    expect(homeSpreadFromMargin(get("403", "consensus")!.marketHomeMargin)).toBe(2.5);
  });
  it("skips and reports lines whose number and text disagree", () => {
    expect(get("401", "Broken")).toBeUndefined();
    expect(lines.issues.some((i) => /Broken: spread -3 disagrees/.test(i.problem))).toBe(true);
  });
  it("keeps provider-reported openers separate, with the verified sign", () => {
    expect(get("401", "consensus", "opening")).toMatchObject({ marketHomeMargin: 9.5, total: 52 });
    expect(get("403", "consensus", "opening")!.marketHomeMargin).toBe(-1.5);
  });
  it("pick'em is 0 and a missing total is null, never 0", () => {
    expect(get("403", "PickBook")).toMatchObject({ marketHomeMargin: 0, total: 48.5 });
    expect(get("403", "consensus")!.total).toBeNull();
  });
});

describe("BALLDONTLIE", () => {
  const r = bdl.parseGames([json("balldontlie/games-page.json")]);
  it("normalizes finals, scheduled, and postponed games", () => {
    expect(r.games.map((g) => g.status)).toEqual(["final", "scheduled", "postponed"]);
    expect(r.games[0]).toMatchObject({ homeAbbr: "BOS", awayAbbr: "NYK", homeScore: 119, awayScore: 105 });
  });
  it("doesn't treat 0–0 placeholders as scores, and neutral site is unknown", () => {
    expect(r.games[1]).toMatchObject({ homeScore: null, awayScore: null, neutralSite: null });
  });
  it("marks a missing tip time partial", () => {
    expect(r.games[2]!.completeness).toBe("partial");
  });
  it("collects teams with full names as aliases", () => {
    expect(r.teams.map((t) => t.abbr).sort()).toEqual(["BOS", "MIA", "NYK"]);
  });
});

describe("The Odds API", () => {
  const { events, issues } = odds.parseOdds(json("odds-api/odds.json"), "2021-06-10T14:00:00.000Z");
  const snaps = events[0]!.snapshots;
  it("takes the home team's outcome as the home spread (sportsbook sign)", () => {
    const s = snaps.find((x) => x.market === "spread" && x.sportsbook.key === "draftkings")!;
    expect(s).toMatchObject({ homePoint: -6.5, homePrice: -111, awayPrice: -109 });
  });
  it("reads totals and moneylines with their market-level update time", () => {
    expect(snaps.find((x) => x.market === "total")).toMatchObject({ totalPoint: 52.5, overPrice: -110, sourceUpdatedAt: "2021-06-10T13:35:00Z" });
    expect(snaps.find((x) => x.market === "h2h")).toMatchObject({ homePrice: -303, awayPrice: 240 });
  });
  it("skips spreads whose points don't mirror", () => {
    expect(snaps.some((x) => x.sportsbook.key === "lopsided")).toBe(false);
    expect(issues[0]!.problem).toMatch(/don't mirror/);
  });
  it("reads quota headers", () => {
    const h = new Headers({ "x-requests-remaining": "491", "x-requests-used": "9", "x-requests-last": "3" });
    expect(odds.readQuota(h)).toEqual({ remaining: 491, used: 9, last: 3 });
  });
  it("costs markets × regions per call", () => {
    expect(odds.COST_PER_CALL).toBe(3);
  });
});
