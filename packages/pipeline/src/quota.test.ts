import { describe, expect, it } from "vitest";
import { planOddsPull, type PlanInput } from "./quota";

const base: PlanInput = {
  now: new Date("2026-11-01T12:00:00Z"), remaining: 480, reserve: 60, costPerSport: 3, runsPerDay: 2, lookAheadDays: 7,
  demand: [
    { sport: "nfl", nextGame: "2026-11-02T18:00:00Z", inSeason: true },
    { sport: "ncaaf", nextGame: "2026-11-05T23:00:00Z", inSeason: true },
    { sport: "nba", nextGame: "2026-11-01T23:30:00Z", inSeason: true },
  ],
};

describe("odds quota planner", () => {
  it("spreads usable credits over the month, soonest games first", () => {
    // 420 usable / (30 days × 2 runs) = 7 per run → two sports at 3 each.
    const p = planOddsPull(base);
    expect(p.budget).toBe(7);
    expect(p.fetch).toEqual(["nba", "nfl"]);
    expect(p.skipped[0]!.reason).toMatch(/budget/);
  });
  it("skips out-of-season sports and sports with no games in the window", () => {
    const p = planOddsPull({ ...base, demand: [
      { sport: "nfl", nextGame: null, inSeason: true },
      { sport: "ncaaf", nextGame: "2026-12-20T00:00:00Z", inSeason: true },
      { sport: "nba", nextGame: "2026-11-01T23:30:00Z", inSeason: false },
    ] });
    expect(p.fetch).toEqual([]);
    expect(p.skipped.map((s) => s.reason)).toEqual(["no games in the next 7 days", "no games in the next 7 days", "out of season"]);
  });
  it("never dips below the reserve", () => {
    expect(planOddsPull({ ...base, remaining: 62 }).fetch).toEqual([]);
    expect(planOddsPull({ ...base, remaining: 63 }).fetch).toEqual(["nba"]);
  });
  it("on the first run (quota unknown) pulls one sport to learn the real quota", () => {
    expect(planOddsPull({ ...base, remaining: null }).fetch).toEqual(["nba"]);
  });
});
