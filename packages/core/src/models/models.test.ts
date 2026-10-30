import { describe, expect, it } from "vitest";
import { hash53, normCdf, solveSpd, stableStringify } from "./linalg";
import { DEFAULT_PARAMS, paramsDiff, paramsHash, type ModelParams } from "./params";
import { fitRatings, type FitGame } from "./fit";
import { runElo } from "./elo";
import { RatingEngine } from "./engine";
import { empiricalProbabilities, spreadProbabilities } from "./probability";

// Deterministic pseudo-random numbers so tests are reproducible.
function rng(seed: number) { return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296); }

/** Simulated league: known strengths, round robin, noiseless or noisy margins. */
function league(opts: { seasons?: number[]; noise?: number; hfa?: number; neutralEvery?: number; seed?: number } = {}) {
  const r = rng(opts.seed ?? 7);
  const teams = ["A", "B", "C", "D", "E", "F"];
  const strength: Record<string, number> = { A: 7, B: 4, C: 1, D: -2, E: -4, F: -6 };
  const games: FitGame[] = [];
  let k = 0;
  for (const season of opts.seasons ?? [2024]) {
    let day = Date.UTC(season, 8, 1);
    for (let rep = 0; rep < 2; rep++) for (const h of teams) for (const a of teams) {
      if (h === a) continue;
      const neutral = opts.neutralEvery ? k % opts.neutralEvery === 0 : false;
      const margin = Math.round(strength[h]! - strength[a]! + (neutral ? 0 : opts.hfa ?? 2) + (opts.noise ?? 0) * (r() + r() + r() - 1.5) * 2);
      const start = new Date(day).toISOString();
      games.push({ id: `g${k++}`, season, startTime: start, finalAt: new Date(day + 3 * 3600e3).toISOString(), homeTeamId: h, awayTeamId: a,
        neutralSite: neutral, homeRest: 7, awayRest: 7, homeScore: 24 + Math.max(0, margin), awayScore: 24 + Math.max(0, -margin) });
      day += 86_400_000;
    }
  }
  return { teams, strength, games };
}

const P = (over: Partial<ModelParams> = {}): ModelParams => ({ ...DEFAULT_PARAMS.nfl, decayPerWeek: 1, priorGames: 0.01, marginCap: 1000, hfaStrength: 0.01, useRest: false, ...over });

describe("linear algebra and hashing", () => {
  it("solves an SPD system", () => {
    const x = solveSpd(new Float64Array([4, 1, 1, 3]), new Float64Array([1, 2]), 2);
    expect(x[0]).toBeCloseTo(1 / 11, 10); expect(x[1]).toBeCloseTo(7 / 11, 10);
  });
  it("normal CDF", () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 7);
    expect(normCdf(1.96)).toBeCloseTo(0.975, 3);
  });
  it("hashes equal objects equally regardless of key order", () => {
    expect(stableStringify({ b: 1, a: [1, { d: 2, c: 3 }] })).toBe(stableStringify({ a: [1, { c: 3, d: 2 }], b: 1 }));
    expect(hash53("x")).not.toBe(hash53("y"));
    expect(paramsHash(DEFAULT_PARAMS.nfl)).toBe(paramsHash(structuredClone(DEFAULT_PARAMS.nfl)));
    expect(paramsDiff(DEFAULT_PARAMS.nfl, { ...DEFAULT_PARAMS.nfl, hfa: 2.1, elo: { ...DEFAULT_PARAMS.nfl.elo, k: 25 } })).toEqual(["hfa: 1.8 → 2.1", "elo.k: 20 → 25"]);
  });
});

describe("MOV ratings", () => {
  it("recover known team strengths and home advantage from clean data", () => {
    const { teams, strength, games } = league();
    const fit = fitRatings(games, teams, P(), "2030-01-01T00:00:00Z");
    const mean = teams.reduce((s, t) => s + fit.ratings.get(t)!, 0) / teams.length;
    for (const t of teams) expect(fit.ratings.get(t)! - mean).toBeCloseTo(strength[t]! - 0, 0);
    expect(fit.hfa).toBeCloseTo(2, 1);
  });
  it("neutral-site games carry no home advantage", () => {
    const { teams, games } = league({ neutralEvery: 3 });
    const fit = fitRatings(games, teams, P(), "2030-01-01T00:00:00Z");
    expect(fit.hfa).toBeCloseTo(2, 1);
  });
  it("shrinks toward the prior when there's little data", () => {
    const { teams, games } = league();
    const few = games.slice(0, 3);
    const priors = new Map(teams.map((t) => [t, { rating: t === "F" ? 5 : 0, off: 0, def: 0 }]));
    const fit = fitRatings(few, teams, P({ priorGames: 10 }), "2030-01-01T00:00:00Z", priors);
    expect(fit.ratings.get("F")!).toBeGreaterThan(4);
  });
  it("soft-caps blowouts", () => {
    const g: FitGame = { id: "x", season: 2024, startTime: "2024-09-01T00:00:00Z", finalAt: "2024-09-01T03:00:00Z", homeTeamId: "A", awayTeamId: "B",
      neutralSite: true, homeRest: null, awayRest: null, homeScore: 70, awayScore: 0 };
    const capped = fitRatings([g], ["A", "B"], P({ marginCap: 21, priorGames: 1e-6 }), "2030-01-01T00:00:00Z");
    expect(capped.ratings.get("A")! - capped.ratings.get("B")!).toBeLessThan(21.01);
  });
  it("refuses to fit with a result that wasn't known yet (look-ahead guard)", () => {
    const { teams, games } = league();
    expect(() => fitRatings(games, teams, P(), games[5]!.startTime)).toThrow(/Look-ahead/);
  });
  it("totals: recovers league scoring and sums parts exactly", () => {
    const { games } = league({ seasons: [2023, 2024] });
    const eng = new RatingEngine(games, P({ priorGames: 2, totals: { priorGames: 2, carryover: 0.5 } }));
    const cur = eng.fitAt(2024, "2030-01-01T00:00:00Z");
    expect(cur.mu).toBeGreaterThan(24);
    const proj = eng.project(cur, { ...games.at(-1)!, homeScore: null, awayScore: null, finalAt: null });
    expect(proj.explanation.totalParts.reduce((s, p) => s + p.points, 0)).toBeCloseTo(proj.total, 9);
    expect(proj.explanation.parts.reduce((s, p) => s + p.points, 0)).toBeCloseTo(proj.homeMargin, 9);
  });
});

describe("engine: no look-ahead, reproducible", () => {
  const { games } = league({ seasons: [2023, 2024], noise: 10 });
  const cut = games.filter((g) => g.season === 2024)[20]!.startTime;
  it("changing future results never changes an earlier projection", () => {
    const a = new RatingEngine(games, DEFAULT_PARAMS.nfl);
    const tampered = games.map((g) => (g.startTime > cut ? { ...g, homeScore: 0, awayScore: 99 } : g));
    const b = new RatingEngine(tampered, DEFAULT_PARAMS.nfl);
    const target = games.find((g) => g.startTime >= cut)!;
    const pa = a.project(a.fitAt(2024, cut), target), pb = b.project(b.fitAt(2024, cut), target);
    expect(pb.homeMargin).toBe(pa.homeMargin);
    expect(pb.total).toBe(pa.total);
    expect(pb.eloMargin).toBe(pa.eloMargin);
  });
  it("same data and parameters give identical output", () => {
    const x = new RatingEngine(games, DEFAULT_PARAMS.nfl).current("2024-09-15T00:00:00Z");
    const y = new RatingEngine(structuredClone(games), structuredClone(DEFAULT_PARAMS.nfl)).current("2024-09-15T00:00:00Z");
    expect(JSON.stringify([...x!.fit.ratings])).toBe(JSON.stringify([...y!.fit.ratings]));
  });
  it("a team with no games and no prior is 'insufficient'; few games is 'experimental'", () => {
    const eng = new RatingEngine([...games, { ...games[0]!, id: "new", season: 2024, homeTeamId: "Z", startTime: "2025-01-05T00:00:00Z", homeScore: null, awayScore: null, finalAt: null }], DEFAULT_PARAMS.nfl);
    const fit = eng.fitAt(2024, "2025-01-01T00:00:00Z");
    expect(eng.project(fit, eng.games.find((g) => g.id === "new")!).status).toBe("insufficient");
    const early = eng.fitAt(2024, games.find((g) => g.season === 2024)!.startTime);
    expect(eng.project(early, games.find((g) => g.season === 2024)!).status).toBe("experimental");
  });
});

describe("Elo", () => {
  it("a home win over an equal team raises the home rating; ratings regress between seasons", () => {
    const g = (id: string, season: number, t: string, hs: number, as: number): FitGame => ({ id, season, startTime: t, finalAt: t, homeTeamId: "A", awayTeamId: "B",
      neutralSite: true, homeRest: null, awayRest: null, homeScore: hs, awayScore: as });
    const { state, pre } = runElo([g("1", 2023, "2023-09-01", 30, 10), g("2", 2024, "2024-09-01", 20, 20)], DEFAULT_PARAMS.nfl.elo);
    expect(pre.get("1")).toEqual({ home: 1500, away: 1500 });
    const after1 = pre.get("2")!.home;
    expect(after1).toBeGreaterThan(1500);
    expect(after1 - 1500).toBeLessThan(state.ratings.get("A")! - 1500 + 1e-9 + 100); // regressed by carryover
    expect(state.ratings.get("A")! + state.ratings.get("B")!).toBeCloseTo(3000, 9);   // zero-sum
  });
});

describe("probabilities", () => {
  it("are symmetric and sum to one", () => {
    const p = spreadProbabilities(3, 3, 13)!;
    expect(p.pHome).toBeCloseTo(p.pAway, 9);
    expect(p.pHome + p.pAway + p.pPush).toBeCloseTo(1, 12);
  });
  it("give push probability only on whole-number lines", () => {
    expect(spreadProbabilities(3, 3, 13)!.pPush).toBeGreaterThan(0.02);
    expect(spreadProbabilities(3, 3.5, 13)!.pPush).toBe(0);
  });
  it("favor the side the projection favors", () => {
    expect(spreadProbabilities(6, 3, 13)!.pHome).toBeGreaterThan(0.5);
    expect(spreadProbabilities(0, 3, 13)!.pAway).toBeGreaterThan(0.5);
  });
  it("refuse missing inputs; empirical needs enough residuals", () => {
    expect(spreadProbabilities(3, Number.NaN, 13)).toBeNull();
    expect(spreadProbabilities(3, 3, 0)).toBeNull();
    expect(empiricalProbabilities(3, 3, [1, 2])).toBeNull();
    const res = Array.from({ length: 1000 }, (_, i) => i - 500);
    expect(empiricalProbabilities(0, 0.5, res)!.pHome).toBeCloseTo(0.499, 2);
  });
});
