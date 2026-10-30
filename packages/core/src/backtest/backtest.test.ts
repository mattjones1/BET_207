import { describe, expect, it } from "vitest";
import { DEFAULT_PARAMS } from "../models/params";
import type { FitGame } from "../models/fit";
import { atsStats, runBacktest, wilson, MIN_SAMPLE, type BacktestLine } from "./backtest";
import { footballWeekKey, etDateKey } from "./slots";

function rng(seed: number) { return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296); }

/** Simulated two seasons of a 10-team league with noisy margins and a "market" line. */
function league() {
  const r = rng(11);
  const teams = "ABCDEFGHIJ".split("");
  const s: Record<string, number> = Object.fromEntries(teams.map((t, i) => [t, 8 - 1.8 * i]));
  const games: FitGame[] = [], lines: BacktestLine[] = [];
  let k = 0;
  for (const season of [2022, 2023, 2024]) {
    for (let week = 0; week < 17; week++) {
      const day = Date.UTC(season, 8, 7) + week * 7 * 86_400_000;   // Sundays-ish
      const order = [...teams].sort(() => r() - 0.5);
      for (let i = 0; i < 10; i += 2) {
        const h = order[i]!, a = order[i + 1]!;
        const expected = s[h]! - s[a]! + 2;
        const margin = Math.round(expected + 13 * (r() + r() + r() + r() - 2) * 1.7);
        const id = `g${k++}`;
        const start = new Date(day + i * 3_600_000).toISOString();
        games.push({ id, season, startTime: start, finalAt: new Date(Date.parse(start) + 3.5 * 3_600_000).toISOString(), homeTeamId: h, awayTeamId: a,
          neutralSite: false, homeRest: 7, awayRest: 7, homeScore: 20 + Math.max(0, margin), awayScore: 20 + Math.max(0, -margin) });
        lines.push({ gameId: id, marketHomeMargin: Math.round(expected * 2) / 2, total: 44.5, homeSpreadPrice: -110, awaySpreadPrice: -110, overPrice: null, underPrice: null, source: "test:closing" });
      }
    }
  }
  return { games, lines };
}

describe("slots", () => {
  it("groups Thursday–Monday into one football week, keyed by Tuesday", () => {
    expect(footballWeekKey("2026-09-11T00:20:00Z")).toBe("2026-09-08"); // Thu 8:20pm ET
    expect(footballWeekKey("2026-09-15T00:15:00Z")).toBe("2026-09-08"); // Mon 8:15pm ET
    expect(footballWeekKey("2026-09-15T23:00:00Z")).toBe("2026-09-15"); // Tue
  });
  it("NBA slots are Eastern dates", () => {
    expect(etDateKey("2026-11-04T03:30:00Z")).toBe("2026-11-03");
  });
});

describe("statistics", () => {
  it("Wilson interval behaves", () => {
    const [lo, hi] = wilson(55, 100)!;
    expect(lo).toBeCloseTo(0.452, 2); expect(hi).toBeCloseTo(0.644, 2);
    expect(wilson(0, 0)).toBeNull();
  });
  it("ATS stats separate pushes, priced ROI, and assumed ROI, and flag small samples", () => {
    const s = atsStats([{ r: "W", units: 0.91, assumed: 0.909 }, { r: "L", units: null, assumed: -1 }, { r: "P", units: 0, assumed: 0 }, { r: null, units: null, assumed: null }]);
    expect([s.graded, s.wins, s.losses, s.pushes]).toEqual([3, 1, 1, 1]);
    expect(s.coverRate).toBe(0.5);
    expect(s.pricedBets).toBe(2);
    expect(s.roi).toBeCloseTo(0.455, 3);
    expect(s.roiAssumed).toBeCloseTo((0.909 - 1) / 3, 3);
    expect(s.sufficient).toBe(false);
    expect(MIN_SAMPLE).toBe(100);
  });
});

describe("walk-forward backtest", () => {
  const { games, lines } = league();
  const bt = runBacktest(games, lines, DEFAULT_PARAMS.nfl, { seasons: [2023, 2024], slot: "week" });

  it("projects every completed game in the chosen seasons", () => {
    expect(bt.observations).toHaveLength(170);
    expect(bt.lineSources).toEqual(["test:closing"]);
  });
  it("produces sensible accuracy (noise SD ≈ 13–15)", () => {
    expect(bt.accuracy.model.rmse).toBeGreaterThan(10);
    expect(bt.accuracy.model.rmse).toBeLessThan(20);
    expect(bt.calibration.spreadSigma).not.toBeNull();
  });
  it("uses out-of-sample σ only: no probabilities in the first backtest season", () => {
    expect(bt.observations.filter((o) => o.season === 2023).every((o) => o.pCover === null)).toBe(true);
  });
  it("is not fooled by future results (look-ahead)", () => {
    const cut = games.find((g) => g.season === 2024)!.startTime;
    const tampered = games.map((g) => (g.startTime > cut ? { ...g, homeScore: 0, awayScore: 60 } : g));
    const bt2 = runBacktest(tampered, lines, DEFAULT_PARAMS.nfl, { seasons: [2024], slot: "week" });
    const bt1 = runBacktest(games, lines, DEFAULT_PARAMS.nfl, { seasons: [2024], slot: "week" });
    // Projections for games in the first 2024 week can't depend on anything after it.
    const firstWeek = bt1.observations.filter((o) => footballWeekKey(o.startTime) === footballWeekKey(cut));
    for (const o of firstWeek) expect(bt2.observations.find((x) => x.gameId === o.gameId)!.projHomeMargin).toBe(o.projHomeMargin);
  });
  it("buckets cover the 5 disagreement ranges and are flagged when small", () => {
    expect(bt.buckets.map((b) => b.key)).toEqual(["lt1", "1to2", "2to3", "3to5", "5plus"]);
    expect(bt.buckets.every((b) => b.stats.graded < MIN_SAMPLE ? !b.stats.sufficient : true)).toBe(true);
  });
  it("games without a line are still scored for accuracy but never graded ATS", () => {
    const noLines = runBacktest(games, [], DEFAULT_PARAMS.nfl, { seasons: [2024], slot: "week" });
    expect(noLines.ats.graded).toBe(0);
    expect(noLines.accuracy.market).toBeNull();
    expect(Number.isFinite(noLines.accuracy.model.mae)).toBe(true);
  });
});
