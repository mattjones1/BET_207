/**
 * Market views built from stored snapshots and lines. All on the home-margin axis; null when missing.
 */
import { marketMarginFromHomeSpread } from "./conventions";
import type { HistoricalLine, OddsSnapshot } from "./types";

export type LineSource = "snapshot" | "closing" | "provider" | "opening";

export interface MarketView {
  /** Market home margin (positive = home favored). */
  homeMargin: number | null;
  homeSpreadPrice: number | null;
  awaySpreadPrice: number | null;
  total: number | null;
  overPrice: number | null;
  underPrice: number | null;
  homeMoneyline: number | null;
  awayMoneyline: number | null;
  /** "consensus" or a sportsbook key. */
  book: string;
  /** How many books contributed (consensus only). */
  books: number;
  source: LineSource;
  /** Newest source update among the inputs (snapshots only). */
  updatedAt: string | null;
}

export const EMPTY_MARKET: MarketView = {
  homeMargin: null, homeSpreadPrice: null, awaySpreadPrice: null, total: null, overPrice: null, underPrice: null,
  homeMoneyline: null, awayMoneyline: null, book: "", books: 0, source: "snapshot", updatedAt: null,
};

export function median(xs: number[]): number | null {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m]! : (v[m - 1]! + v[m]!) / 2;
}

/** Latest snapshot per (book, market) for one game. */
export function latestByBook(snaps: OddsSnapshot[]): OddsSnapshot[] {
  const best = new Map<string, OddsSnapshot>();
  for (const s of snaps) {
    const k = `${s.sportsbook}|${s.market}`;
    const cur = best.get(k);
    if (!cur || (s.sourceUpdatedAt ?? s.retrievedAt) > (cur.sourceUpdatedAt ?? cur.retrievedAt)) best.set(k, s);
  }
  return [...best.values()];
}

/**
 * One game's market from captured snapshots: a single book, or the consensus (median of books' latest
 * numbers). Prices are only shown for a single book; a median of prices isn't a price anyone offers.
 */
export function marketFromSnapshots(snaps: OddsSnapshot[], book: string | "consensus"): MarketView | null {
  const latest = latestByBook(snaps).filter((s) => book === "consensus" || s.sportsbook === book);
  if (!latest.length) return null;
  const of = (m: OddsSnapshot["market"]) => latest.filter((s) => s.market === m);
  const spreads = of("spread"), totals = of("total"), h2h = of("h2h");
  const updatedAt = latest.map((s) => s.sourceUpdatedAt ?? s.retrievedAt).sort().at(-1) ?? null;
  if (book === "consensus") {
    const hs = median(spreads.map((s) => s.homePoint).filter((x): x is number => x !== null));
    return {
      ...EMPTY_MARKET, homeMargin: marketMarginFromHomeSpread(hs),
      total: median(totals.map((s) => s.totalPoint).filter((x): x is number => x !== null)),
      book: "consensus", books: new Set(latest.map((s) => s.sportsbook)).size, source: "snapshot", updatedAt,
    };
  }
  const sp = spreads[0], to = totals[0], ml = h2h[0];
  return {
    homeMargin: marketMarginFromHomeSpread(sp?.homePoint ?? null), homeSpreadPrice: sp?.homePrice ?? null, awaySpreadPrice: sp?.awayPrice ?? null,
    total: to?.totalPoint ?? null, overPrice: to?.overPrice ?? null, underPrice: to?.underPrice ?? null,
    homeMoneyline: ml?.homePrice ?? null, awayMoneyline: ml?.awayPrice ?? null,
    book, books: 1, source: "snapshot", updatedAt,
  };
}

/** A market view from an imported line (closing, provider, or opening). */
export function marketFromLine(l: HistoricalLine): MarketView {
  return {
    homeMargin: l.marketHomeMargin, homeSpreadPrice: l.homeSpreadPrice, awaySpreadPrice: l.awaySpreadPrice,
    total: l.total, overPrice: l.overPrice, underPrice: l.underPrice, homeMoneyline: l.homeMoneyline, awayMoneyline: l.awayMoneyline,
    book: l.sportsbook || l.provider || "", books: 1, source: l.lineType === "closing" ? "closing" : l.lineType === "opening" ? "opening" : "provider", updatedAt: null,
  };
}

/** Pick the best available market: live snapshots first, then an imported line (preferring consensus/closing). */
export function bestMarket(snaps: OddsSnapshot[], lines: HistoricalLine[], book: string | "consensus"): MarketView | null {
  const live = marketFromSnapshots(snaps, book);
  if (live && (live.homeMargin !== null || live.total !== null)) return live;
  const candidates = lines.filter((l) => l.lineType !== "opening");
  const pick = candidates.find((l) => l.lineType === "closing") ?? candidates.find((l) => /consensus/i.test(l.sportsbook)) ?? candidates[0];
  return pick ? marketFromLine(pick) : null;
}

export type Freshness = "fresh" | "stale" | "none";
/** Odds older than `hours` are stale. Lines imported from results sources have no freshness (null updatedAt). */
export function freshness(updatedAt: string | null, now: Date, hours = 14): Freshness {
  if (!updatedAt) return "none";
  return now.getTime() - Date.parse(updatedAt) > hours * 3_600_000 ? "stale" : "fresh";
}
