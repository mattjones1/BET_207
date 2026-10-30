/**
 * sync-odds: live market snapshots from The Odds API, on a strict budget (see quota.ts).
 * 1. Free /events call per in-season sport to find the next game (costs 0).
 * 2. Plan which sports to pull this run.
 * 3. Pull /odds for those sports only, record the real quota from response headers.
 * 4. Match each event to our game (same teams, start within 36 hours), link the ids, insert snapshots.
 *    Snapshots are keyed by source update time, so a retry or an unchanged price adds nothing.
 */
import { SPORT_KEYS, inSeason, type SportKey } from "@bet207/core";
import * as oddsApi from "../adapters/oddsApi";
import { env, requireEnv } from "../lib/env";
import { planOddsPull, type SportDemand } from "../quota";
import type { MatchGame, OddsRow, Store } from "../store";
import type { Job } from "./context";

const MATCH_WINDOW_MS = 36 * 3_600_000;

export function matchEvent(e: oddsApi.OddsEvent, aliases: Map<string, string>, candidates: MatchGame[]): { gameId: string } | { problem: string } {
  const home = aliases.get(e.homeName.trim().toLowerCase()), away = aliases.get(e.awayName.trim().toLowerCase());
  if (!home || !away) return { problem: `unknown team name: ${!home ? e.homeName : e.awayName}` };
  const t = Date.parse(e.commenceTime);
  const hits = candidates.filter((g) => Math.abs(Date.parse(g.startTime) - t) <= MATCH_WINDOW_MS
    && ((g.homeTeamId === home && g.awayTeamId === away) || (g.homeTeamId === away && g.awayTeamId === home)));
  if (hits.length !== 1) return { problem: hits.length ? "more than one matching game" : "no matching game in our schedule" };
  const g = hits[0]!;
  if (g.homeTeamId !== home) return { problem: "home/away reversed versus our schedule; skipped to protect spread signs" };
  return { gameId: g.id };
}

export async function storeOdds(store: Store, sport: SportKey, events: oddsApi.OddsEvent[], retrievedAt: string) {
  const aliases = await store.aliasMap(sport);
  const times = events.map((e) => Date.parse(e.commenceTime));
  const candidates = events.length
    ? await store.gamesBetween(sport, new Date(Math.min(...times) - MATCH_WINDOW_MS).toISOString(), new Date(Math.max(...times) + MATCH_WINDOW_MS).toISOString())
    : [];
  const books = await store.upsertSportsbooks([...new Map(events.flatMap((e) => e.snapshots.map((s) => [s.sportsbook.key, s.sportsbook]))).values()]);
  const rows: OddsRow[] = [], links: { gameId: string; key: string }[] = [], unmatched: { event: string; problem: string }[] = [];
  for (const e of events) {
    const m = matchEvent(e, aliases, candidates);
    if ("problem" in m) { unmatched.push({ event: `${e.awayName} @ ${e.homeName} ${e.commenceTime}`, problem: m.problem }); continue; }
    links.push({ gameId: m.gameId, key: e.eventId });
    for (const s of e.snapshots) rows.push({
      gameId: m.gameId, sportsbookId: books.get(s.sportsbook.key)!, market: s.market, homePoint: s.homePoint, homePrice: s.homePrice,
      awayPrice: s.awayPrice, totalPoint: s.totalPoint, overPrice: s.overPrice, underPrice: s.underPrice,
      sourceUpdatedAt: s.sourceUpdatedAt, retrievedAt, provider: "the-odds-api",
    });
  }
  await store.linkProviderIds("the-odds-api", links);
  const inserted = await store.insertOdds(rows);
  return { inserted, matched: links.length, unmatched };
}

export const syncOdds: Job = async ({ store, sport, log, now }) => {
  const key = requireEnv("ODDS_API_KEY");
  const reserve = Number(env("ODDS_API_RESERVE") ?? 60);
  const sports = sport ? [sport] : SPORT_KEYS;
  const demand: SportDemand[] = [];
  for (const s of sports) {
    if (!inSeason(s, now)) { demand.push({ sport: s, nextGame: null, inSeason: false }); continue; }
    const ev = await oddsApi.fetchEvents(s, key);   // free
    const next = ev.events.map((e) => e.commence_time).filter((t) => Date.parse(t) > now.getTime()).sort()[0] ?? null;
    demand.push({ sport: s, nextGame: next, inSeason: true });
  }
  const remaining = await store.latestQuota("the-odds-api");
  const plan = planOddsPull({ now, remaining, reserve, costPerSport: oddsApi.COST_PER_CALL, runsPerDay: 2, lookAheadDays: 7, demand });
  log(`plan: fetch [${plan.fetch.join(", ")}]; skip ${plan.skipped.map((s) => `${s.sport} (${s.reason})`).join(", ") || "none"}`);
  if (!plan.fetch.length) return { rows: 0, skipped: "nothing to fetch within budget", details: { plan } };

  let rows = 0;
  const perSport: Record<string, unknown> = {};
  for (const s of plan.fetch) {
    const { json, quota } = await oddsApi.fetchOdds(s, key, now.toISOString());
    await store.recordQuota("the-odds-api", quota);
    const parsed = oddsApi.parseOdds(json, now.toISOString());
    const r = await storeOdds(store, s, parsed.events, now.toISOString());
    rows += r.inserted;
    perSport[s] = { events: parsed.events.length, matched: r.matched, inserted: r.inserted, unmatched: r.unmatched.slice(0, 20), issues: parsed.issues.slice(0, 20), quota };
    log(`${s}: ${parsed.events.length} events, ${r.matched} matched, ${r.inserted} new snapshots, ${quota.remaining ?? "?"} credits left`);
  }
  return { rows, details: { plan, perSport } };
};
