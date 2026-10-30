/**
 * The Odds API v4 adapter. Free plan: 500 credits/month. Cost per /odds call = markets × regions.
 *   GET /v4/sports/{sport}/odds?regions=us&markets=h2h,spreads,totals&oddsFormat=american&commenceTimeFrom=…
 *   Event { id, commence_time, home_team, away_team, bookmakers[{ key, title, last_update (deprecated),
 *           markets[{ key, last_update, outcomes[{ name, price, point }] }] }] }
 *   GET /v4/sports/{sport}/events  → same event identity, costs 0 (used to check for upcoming games for free).
 *   Quota headers: x-requests-remaining, x-requests-used, x-requests-last.
 * Spreads: the outcome named home_team carries the HOME SPREAD (sportsbook sign). We check the away outcome is
 * its mirror; asymmetric pairs are reported and skipped. Missing prices stay null.
 */
import { z } from "zod";
import type { SportKey } from "@bet207/core";
import { SPORTS } from "@bet207/core";
import { fetchWithRetry, RateLimiter } from "../lib/http";
import type { AdapterIssue } from "./types";

const BASE = "https://api.the-odds-api.com/v4";
const limiter = new RateLimiter(1000);
export const ODDS_MARKETS = ["h2h", "spreads", "totals"] as const;
export const ODDS_REGIONS = ["us"] as const;
export const COST_PER_CALL = ODDS_MARKETS.length * ODDS_REGIONS.length;

const Outcome = z.object({ name: z.string(), price: z.number().nullish(), point: z.number().nullish() });
const MarketZ = z.object({ key: z.string(), last_update: z.string().nullish(), outcomes: z.array(Outcome) });
const Book = z.object({ key: z.string(), title: z.string(), last_update: z.string().nullish(), markets: z.array(MarketZ) });
const Event = z.object({
  id: z.string(), commence_time: z.string(), home_team: z.string(), away_team: z.string(),
  bookmakers: z.array(Book).default([]),
});

export interface EventSnapshot {
  sportsbook: { key: string; name: string };
  market: "spread" | "total" | "h2h";
  homePoint: number | null; homePrice: number | null; awayPrice: number | null;
  totalPoint: number | null; overPrice: number | null; underPrice: number | null;
  sourceUpdatedAt: string;
}
export interface OddsEvent { eventId: string; commenceTime: string; homeName: string; awayName: string; snapshots: EventSnapshot[] }

export function parseOdds(json: unknown, retrievedAt: string): { events: OddsEvent[]; issues: AdapterIssue[] } {
  const issues: AdapterIssue[] = [];
  const events = z.array(Event).parse(json).map((e) => {
    const snapshots: EventSnapshot[] = [];
    for (const b of e.bookmakers) {
      for (const m of b.markets) {
        const updated = m.last_update ?? b.last_update ?? retrievedAt;
        const book = { key: b.key, name: b.title };
        const by = (name: string) => m.outcomes.find((o) => o.name === name);
        if (m.key === "spreads") {
          const h = by(e.home_team), a = by(e.away_team);
          if (!h || h.point == null) { issues.push({ providerEventId: e.id, problem: `${b.key}: spread without a home point` }); continue; }
          if (a?.point != null && Math.abs(a.point + h.point) > 1e-9) { issues.push({ providerEventId: e.id, problem: `${b.key}: spread points don't mirror (${h.point} / ${a.point})` }); continue; }
          snapshots.push({ sportsbook: book, market: "spread", homePoint: h.point, homePrice: h.price ?? null, awayPrice: a?.price ?? null, totalPoint: null, overPrice: null, underPrice: null, sourceUpdatedAt: updated });
        } else if (m.key === "totals") {
          const o = by("Over"), u = by("Under");
          const point = o?.point ?? u?.point ?? null;
          if (point === null) { issues.push({ providerEventId: e.id, problem: `${b.key}: total without a point` }); continue; }
          snapshots.push({ sportsbook: book, market: "total", homePoint: null, homePrice: null, awayPrice: null, totalPoint: point, overPrice: o?.price ?? null, underPrice: u?.price ?? null, sourceUpdatedAt: updated });
        } else if (m.key === "h2h") {
          snapshots.push({ sportsbook: book, market: "h2h", homePoint: null, homePrice: by(e.home_team)?.price ?? null, awayPrice: by(e.away_team)?.price ?? null, totalPoint: null, overPrice: null, underPrice: null, sourceUpdatedAt: updated });
        }
      }
    }
    return { eventId: e.id, commenceTime: new Date(e.commence_time).toISOString(), homeName: e.home_team, awayName: e.away_team, snapshots };
  });
  return { events, issues };
}

export interface Quota { remaining: number | null; used: number | null; last: number | null }
export function readQuota(h: Headers): Quota {
  const n = (k: string) => { const v = h.get(k); return v === null || v === "" ? null : Number(v); };
  return { remaining: n("x-requests-remaining"), used: n("x-requests-used"), last: n("x-requests-last") };
}

/** Free (cost 0): upcoming events for a sport. Also returns the quota headers. */
export async function fetchEvents(sport: SportKey, apiKey: string): Promise<{ events: { id: string; commence_time: string }[]; quota: Quota }> {
  const res = await fetchWithRetry(`${BASE}/sports/${SPORTS[sport].oddsApiKey}/events?apiKey=${apiKey}`, { label: `Odds API events ${sport}`, limiter });
  return { events: z.array(z.object({ id: z.string(), commence_time: z.string() })).parse(await res.json()), quota: readQuota(res.headers) };
}

export async function fetchOdds(sport: SportKey, apiKey: string, fromIso: string): Promise<{ json: unknown; quota: Quota }> {
  const q = new URLSearchParams({
    regions: ODDS_REGIONS.join(","), markets: ODDS_MARKETS.join(","), oddsFormat: "american", dateFormat: "iso",
    commenceTimeFrom: fromIso.replace(/\.\d{3}Z$/, "Z"),
  });
  const res = await fetchWithRetry(`${BASE}/sports/${SPORTS[sport].oddsApiKey}/odds?apiKey=${apiKey}&${q}`, { label: `Odds API odds ${sport}`, limiter, retries: 2 });
  return { json: await res.json(), quota: readQuota(res.headers) };
}
