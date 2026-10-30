import { describe, expect, it } from "vitest";
import type { OddsSnapshot } from "@bet207/core";
import type { GameRow } from "./source";
import { headToHead, lineMovement, recentForm, situations, splits, strengthOfSchedule } from "./context";

const g = (id: string, start: string, home: string, away: string, hs: number | null, as: number | null, extra: Partial<GameRow> = {}): GameRow => ({
  id, season: 2026, seasonType: "regular", week: 1, startTime: start, homeTeamId: home, awayTeamId: away, neutralSite: false, venue: null,
  homeRest: 7, awayRest: 7, status: hs === null ? "scheduled" : "final", homeScore: hs, awayScore: as, completeness: "complete", ...extra,
});
const games = [
  g("1", "2026-09-10T00:00:00Z", "KC", "BAL", 27, 20),
  g("2", "2026-09-17T00:00:00Z", "BUF", "KC", 30, 24),
  g("3", "2026-09-24T00:00:00Z", "KC", "BUF", 21, 21),
  g("4", "2026-10-01T00:00:00Z", "KC", "DEN", null, null),
  g("5", "2026-10-08T00:00:00Z", "KC", "BUF", 40, 0),
];

describe("matchup context", () => {
  const cutoff = "2026-10-01T00:00:00Z";
  it("recent form is newest first and stops at the cutoff", () => {
    expect(recentForm("KC", games, cutoff).map((r) => `${r.result}${r.for}-${r.against}`)).toEqual(["T21-21", "L24-30", "W27-20"]);
  });
  it("home/away splits use only finished games before the cutoff", () => {
    const s = splits("KC", games, cutoff);
    expect([s.home.games, s.away.games, s.all.avgMargin]).toEqual([2, 1, (7 - 6 + 0) / 3]);
  });
  it("strength of schedule averages opponents' ratings", () => {
    expect(strengthOfSchedule("KC", games, cutoff, new Map([["BAL", { mov: 4 }], ["BUF", { mov: 2 }]]))).toBeCloseTo((4 + 2 + 2) / 3, 9);
  });
  it("head-to-head never includes the game itself or later games", () => {
    expect(headToHead("KC", "BUF", games, "2026-10-08T00:00:00Z").map((x) => x.id)).toEqual(["3", "2"]);
  });
  it("names verifiable situations only", () => {
    const s = situations(g("x", "2026-11-01T00:00:00Z", "BOS", "NYK", null, null, { homeRest: 1, awayRest: 3, neutralSite: null }), "nba", "BOS", "NYK");
    expect(s.map((x) => x.key)).toEqual(["b2b-BOS", "rest", "site"]);
    expect(situations(g("y", "2026-11-01T00:00:00Z", "KC", "DEN", null, null, { homeRest: 4, awayRest: 14 }), "nfl", "KC", "DEN").map((x) => x.key))
      .toEqual(["short-KC", "bye-DEN", "rest"]);
  });
});

describe("line movement", () => {
  const s = (book: string, t: string, hp: number): OddsSnapshot => ({ gameId: "g", sportsbook: book, market: "spread", homePoint: hp, homePrice: -110, awayPrice: -110,
    totalPoint: null, overPrice: null, underPrice: null, sourceUpdatedAt: t, retrievedAt: t, provider: "the-odds-api" });
  it("shows the consensus after each update, carrying each book's latest number", () => {
    const pts = lineMovement([s("dk", "2026-10-01T10:00:00Z", -3), s("fd", "2026-10-01T11:00:00Z", -3.5), s("dk", "2026-10-02T10:00:00Z", -4)], "consensus");
    expect(pts.map((p) => p.homeSpread)).toEqual([-3, -3.25, -3.75]);
  });
});
