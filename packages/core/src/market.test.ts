import { describe, expect, it } from "vitest";
import { bestMarket, freshness, marketFromSnapshots, median } from "./market";
import type { HistoricalLine, OddsSnapshot } from "./types";

const snap = (book: string, market: OddsSnapshot["market"], v: Partial<OddsSnapshot>, at = "2026-11-01T12:00:00Z"): OddsSnapshot => ({
  gameId: "g", sportsbook: book, market, homePoint: null, homePrice: null, awayPrice: null, totalPoint: null, overPrice: null, underPrice: null,
  sourceUpdatedAt: at, retrievedAt: at, provider: "the-odds-api", ...v,
});

describe("market from snapshots", () => {
  const snaps = [
    snap("dk", "spread", { homePoint: -3, homePrice: -115, awayPrice: -105 }, "2026-11-01T10:00:00Z"),
    snap("dk", "spread", { homePoint: -3.5, homePrice: -110, awayPrice: -110 }, "2026-11-01T14:00:00Z"),
    snap("fd", "spread", { homePoint: -2.5, homePrice: -110, awayPrice: -110 }),
    snap("mgm", "spread", { homePoint: -3 }),
    snap("dk", "total", { totalPoint: 44.5, overPrice: -110, underPrice: -110 }),
    snap("fd", "total", { totalPoint: 45 }),
    snap("dk", "h2h", { homePrice: -170, awayPrice: 145 }),
  ];
  it("uses each book's latest number", () => {
    expect(marketFromSnapshots(snaps, "dk")).toMatchObject({ homeMargin: 3.5, homeSpreadPrice: -110, total: 44.5, homeMoneyline: -170 });
  });
  it("consensus is the median line across books, with no invented price", () => {
    const c = marketFromSnapshots(snaps, "consensus")!;
    expect(c).toMatchObject({ homeMargin: 3, total: 44.75, books: 3, homeSpreadPrice: null });
  });
  it("returns null for a book with no prices", () => {
    expect(marketFromSnapshots(snaps, "caesars")).toBeNull();
  });
  it("median handles even and empty lists", () => {
    expect(median([1, 3])).toBe(2);
    expect(median([])).toBeNull();
  });
});

describe("best market", () => {
  const closing: HistoricalLine = { gameId: "g", provider: "nflverse", lineType: "closing", sportsbook: "", marketHomeMargin: 3, homeSpreadPrice: -110,
    awaySpreadPrice: -110, total: 47, overPrice: null, underPrice: null, homeMoneyline: null, awayMoneyline: null };
  it("falls back to an imported line, labeled with its type", () => {
    expect(bestMarket([], [closing], "consensus")).toMatchObject({ homeMargin: 3, source: "closing", updatedAt: null });
  });
  it("never uses an opening line as the current market", () => {
    expect(bestMarket([], [{ ...closing, lineType: "opening" }], "consensus")).toBeNull();
  });
});

describe("freshness", () => {
  const now = new Date("2026-11-01T20:00:00Z");
  it("flags old snapshots and has no freshness for imported lines", () => {
    expect(freshness("2026-11-01T14:00:00Z", now)).toBe("fresh");
    expect(freshness("2026-10-31T14:00:00Z", now)).toBe("stale");
    expect(freshness(null, now)).toBe("none");
  });
});
