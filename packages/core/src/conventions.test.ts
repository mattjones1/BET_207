import { describe, expect, it } from "vitest";
import {
  edgeBucket, formatFavorite, formatHomeSpread, gradeSpread, gradeTotal, homeSpreadFromMargin,
  marketMarginFromHomeSpread, marketMarginFromNflverse, spreadEdge, totalEdge,
} from "./conventions";

describe("spread sign conventions", () => {
  it("a home spread of −6.5 means the market expects home by 6.5", () => {
    expect(marketMarginFromHomeSpread(-6.5)).toBe(6.5);
    expect(marketMarginFromHomeSpread(3)).toBe(-3);
  });
  it("round-trips margin ↔ spread", () => {
    for (const m of [-14, -3, -0.5, 0, 2.5, 7]) expect(marketMarginFromHomeSpread(homeSpreadFromMargin(m))).toBe(m);
  });
  it("pick'em is 0 (never -0) and distinct from missing", () => {
    expect(Object.is(marketMarginFromHomeSpread(0), 0)).toBe(true);
    expect(marketMarginFromHomeSpread(null)).toBeNull();
    expect(marketMarginFromHomeSpread(undefined)).toBeNull();
    expect(marketMarginFromHomeSpread(Number.NaN)).toBeNull();
  });
  it("nflverse spread_line is already the home margin (positive = home favored)", () => {
    // 2024 week 1: KC (home) favored by 3 over BAL → spread_line 3 → home spread −3.
    expect(marketMarginFromNflverse(3)).toBe(3);
    expect(homeSpreadFromMargin(marketMarginFromNflverse(3))).toBe(-3);
    expect(marketMarginFromNflverse(null)).toBeNull();
  });
});

describe("display", () => {
  it("shows a predicted home margin as the conventional spread", () => {
    expect(formatHomeSpread(6.5)).toBe("HOME −6.5");
    expect(formatHomeSpread(-3)).toBe("HOME +3");
    expect(formatHomeSpread(0)).toBe("HOME PK");
    expect(formatHomeSpread(null)).toBe("—");
  });
  it("names the favorite", () => {
    expect(formatFavorite(6.5, "BUF", "MIA")).toBe("BUF −6.5");
    expect(formatFavorite(-3, "BUF", "MIA")).toBe("MIA −3");
    expect(formatFavorite(0, "BUF", "MIA")).toBe("PK");
    expect(formatFavorite(-0.04, "BUF", "MIA")).toBe("PK");   // rounds to zero: never "−0"
    expect(formatFavorite(6.46, "BUF", "MIA")).toBe("BUF −6.5");
  });
});

describe("edges", () => {
  it("positive edge favors home, negative favors away", () => {
    // Model: home by 6. Market: home −3.5 (home by 3.5). Model likes home by 2.5.
    expect(spreadEdge(6, marketMarginFromHomeSpread(-3.5))).toEqual({ points: 2.5, favors: "home" });
    // Model: home by 1. Market: home −3.5. Model likes away by 2.5.
    expect(spreadEdge(1, 3.5)).toEqual({ points: -2.5, favors: "away" });
    expect(spreadEdge(3.5, 3.5)).toEqual({ points: 0, favors: null });
  });
  it("never invents an edge from a missing line", () => {
    expect(spreadEdge(5, null)).toBeNull();
    expect(spreadEdge(null, 3)).toBeNull();
    expect(totalEdge(44, null)).toBeNull();
  });
  it("totals lean over when the model is higher", () => {
    expect(totalEdge(47.5, 44.5)).toEqual({ points: 3, lean: "over" });
    expect(totalEdge(41, 44.5)).toEqual({ points: -3.5, lean: "under" });
  });
  it("buckets by absolute disagreement", () => {
    expect(edgeBucket(0.5)).toBe("lt1");
    expect(edgeBucket(-1)).toBe("1to2");
    expect(edgeBucket(2.99)).toBe("2to3");
    expect(edgeBucket(3)).toBe("3to5");
    expect(edgeBucket(-12)).toBe("5plus");
  });
});

describe("grading", () => {
  it("home −3 (market home margin 3): win by 4 covers, by 3 pushes, by 2 loses", () => {
    expect(gradeSpread("home", 3, 4)).toBe("W");
    expect(gradeSpread("home", 3, 3)).toBe("P");
    expect(gradeSpread("home", 3, 2)).toBe("L");
    expect(gradeSpread("away", 3, 2)).toBe("W");
    expect(gradeSpread("away", 3, 3)).toBe("P");
  });
  it("home underdog +7 (market home margin −7): lose by 6 covers", () => {
    expect(gradeSpread("home", -7, -6)).toBe("W");
    expect(gradeSpread("away", -7, -10)).toBe("W");
  });
  it("grades totals with pushes", () => {
    expect(gradeTotal("over", 44, 45)).toBe("W");
    expect(gradeTotal("under", 44, 44)).toBe("P");
    expect(gradeTotal("under", 44.5, 41)).toBe("W");
  });
});
