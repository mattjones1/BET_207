/**
 * The rating engine: season-to-season priors, point-in-time fits, Elo, and projections with an exact
 * additive explanation. Used by the pipeline (production runs), the backtest (walk-forward), and the browser
 * (Model Lab previews) — one implementation everywhere.
 */
import type { ProjectionStatus } from "../types";
import { carryPriors, fitRatings, homeFlag, isCompleted, restEdge, type Fit, type FitGame, type TeamPrior } from "./fit";
import { eloMargin, runElo, type EloPre } from "./elo";
import type { ModelParams } from "./params";

export interface Explanation {
  /** Each part is in points on the home-margin axis; they sum exactly to the projected margin. */
  parts: { key: "rating" | "home" | "rest"; label: string; points: number }[];
  homeRating: number;
  awayRating: number;
  restDiff: number | null;
  neutral: boolean | null;
  /** Total components: league baseline plus each side's offense/defense (points). */
  totalParts: { key: string; label: string; points: number }[];
}

export interface Projection {
  gameId: string;
  homeMargin: number;
  total: number;
  eloMargin: number | null;
  status: ProjectionStatus;
  statusReason: string | null;
  explanation: Explanation;
  homeUncertainty: number;
  awayUncertainty: number;
}

export class RatingEngine {
  private bySeason = new Map<number, FitGame[]>();
  private priorCache = new Map<number, Map<string, TeamPrior>>();
  readonly elo: Map<string, EloPre>;
  /** Elo after every completed game passed in. */
  readonly eloNow: Map<string, number>;
  readonly seasons: number[];

  constructor(readonly games: FitGame[], readonly params: ModelParams) {
    for (const g of [...games].sort((a, b) => a.startTime.localeCompare(b.startTime))) {
      (this.bySeason.get(g.season) ?? this.bySeason.set(g.season, []).get(g.season)!).push(g);
    }
    this.seasons = [...this.bySeason.keys()].sort((a, b) => a - b);
    const elo = runElo(games, params.elo);
    this.elo = elo.pre;   // pre-game Elo: out-of-sample by construction
    this.eloNow = elo.state.ratings;
  }

  teamsIn(season: number): string[] {
    const s = new Set<string>();
    for (const g of this.bySeason.get(season) ?? []) { s.add(g.homeTeamId); s.add(g.awayTeamId); }
    return [...s].sort();
  }

  /** Priors entering `season`: the previous season's final fit, carried over. Empty for the first season. */
  priorsFor(season: number): Map<string, TeamPrior> {
    const cached = this.priorCache.get(season);
    if (cached) return cached;
    const prev = this.seasons.filter((s) => s < season).at(-1);
    let priors = new Map<string, TeamPrior>();
    if (prev !== undefined) {
      const done = (this.bySeason.get(prev) ?? []).filter(isCompleted);
      const end = done.length ? new Date(Math.max(...done.map((g) => Date.parse(g.finalAt!))) + 1000).toISOString() : null;
      if (end) priors = carryPriors(this.fitAt(prev, end), this.params);
    }
    this.priorCache.set(season, priors);
    return priors;
  }

  /** Ratings for `season` using only results known before `asOf`. */
  fitAt(season: number, asOf: string): Fit {
    const t = Date.parse(asOf);
    const games = (this.bySeason.get(season) ?? []).filter((g) => isCompleted(g) && Date.parse(g.finalAt!) < t);
    const priors = this.priorsFor(season);
    const teams = [...new Set([...this.teamsIn(season), ...priors.keys()])].sort();
    return fitRatings(games, teams, this.params, asOf, priors);
  }

  project(fit: Fit, g: FitGame): Projection {
    const p = this.params;
    const rh = fit.ratings.get(g.homeTeamId) ?? 0, ra = fit.ratings.get(g.awayTeamId) ?? 0;
    const hf = homeFlag(g);
    const rest = p.useRest ? restEdge(g, p.restCap) : 0;
    const parts: Explanation["parts"] = [
      { key: "rating", label: "Rating difference (home − away)", points: rh - ra },
      { key: "home", label: g.neutralSite === true ? "Home advantage (neutral site: none)" : g.neutralSite === null ? "Home advantage (site assumed home)" : "Home advantage", points: fit.hfa * hf },
    ];
    if (p.useRest) parts.push({ key: "rest", label: "Rest edge", points: fit.restCoef * rest });
    const homeMargin = parts.reduce((s, x) => s + x.points, 0);

    const oh = fit.off.get(g.homeTeamId) ?? 0, dh = fit.def.get(g.homeTeamId) ?? 0, oa = fit.off.get(g.awayTeamId) ?? 0, da = fit.def.get(g.awayTeamId) ?? 0;
    const totalParts = [
      { key: "league", label: "League scoring baseline (two teams)", points: 2 * fit.mu },
      { key: "homeOff", label: "Home offense", points: oh },
      { key: "awayDef", label: "Away defense (points allowed above average)", points: da },
      { key: "awayOff", label: "Away offense", points: oa },
      { key: "homeDef", label: "Home defense (points allowed above average)", points: dh },
    ];
    const total = totalParts.reduce((s, x) => s + x.points, 0);

    const priors = this.priorsFor(g.season);
    const gh = fit.gamesUsed.get(g.homeTeamId) ?? 0, ga = fit.gamesUsed.get(g.awayTeamId) ?? 0;
    let status: ProjectionStatus = "ok", statusReason: string | null = null;
    const noInfo = (t: string, n: number) => n === 0 && !priors.has(t);
    if (noInfo(g.homeTeamId, gh) || noInfo(g.awayTeamId, ga)) { status = "insufficient"; statusReason = "A team has no games this season and no prior-season rating."; }
    else if (gh < p.minGames || ga < p.minGames) { status = "experimental"; statusReason = `Fewer than ${p.minGames} games this season for a team; the projection leans on last season's carried-over rating.`; }

    const pre = this.elo.get(g.id);
    return {
      gameId: g.id, homeMargin, total,
      eloMargin: pre ? eloMargin(pre, g, p.elo) : null,
      status, statusReason,
      explanation: { parts, homeRating: rh, awayRating: ra, restDiff: p.useRest && g.homeRest !== null && g.awayRest !== null ? g.homeRest - g.awayRest : null, neutral: g.neutralSite, totalParts },
      homeUncertainty: fit.uncertainty.get(g.homeTeamId) ?? NaN,
      awayUncertainty: fit.uncertainty.get(g.awayTeamId) ?? NaN,
    };
  }

  /** Current ratings and projections for every unplayed game at `asOf` (production / Model Lab). */
  current(asOf: string): { season: number; fit: Fit; projections: Projection[] } | null {
    const upcoming = this.games.filter((g) => !isCompleted(g) && g.startTime >= asOf).sort((a, b) => a.startTime.localeCompare(b.startTime));
    const season = upcoming[0]?.season ?? this.seasons.at(-1);
    if (season === undefined) return null;
    const fit = this.fitAt(season, asOf);
    return { season, fit, projections: upcoming.filter((g) => g.season === season).map((g) => this.project(fit, g)) };
  }
}
