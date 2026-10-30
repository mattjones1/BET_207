/**
 * Model output for the UI. Live: the newest successful production run (persisted by the pipeline).
 * Demo: computed in the browser by the same @bet207/core engine over the demo snapshot.
 */
import { DEFAULT_PARAMS, type Calibration, type Explanation, type ModelParams, type SportKey } from "@bet207/core";
import { env } from "../lib/env";
import { supabase } from "../lib/supabase";
import { SPORT_ID, getSeason } from "./source";

export * from "./compute";
import { computeModel, toFitGames, type GameProjection, type ModelData } from "./compute";

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export async function getModel(sport: SportKey, season: number): Promise<ModelData | null> {
  if (env.demo || !supabase) {
    if (sport !== "nfl") return null;
    // Demo: all demo seasons feed the priors; the engine only uses results known before "now".
    const all = (await Promise.all([season - 2, season - 1, season].map((s) => getSeason(sport, s)))).flatMap((d) => d.games);
    return computeModel(toFitGames(all), DEFAULT_PARAMS.nfl, new Date().toISOString(), "Default (computed in your browser, demo)");
  }
  const run = await supabase.from("model_runs")
    .select("id,finished_at,summary,model_configs!inner(sport_id,name,version,params,params_hash)")
    .eq("model_configs.sport_id", SPORT_ID[sport]).eq("kind", "production").eq("status", "success")
    .order("finished_at", { ascending: false }).limit(1);
  if (run.error) throw new Error(run.error.message);
  const r = run.data?.[0] as { id: string; finished_at: string; summary: ModelData["summary"] & { calibration?: Calibration | null }; model_configs: { name: string; version: number; params: ModelParams; params_hash: string } } | undefined;
  if (!r) return null;
  const [rat, proj] = await Promise.all([
    supabase.from("team_ratings").select("team_id,mov_rating,off_rating,def_rating,elo,games_used,uncertainty").eq("run_id", r.id),
    supabase.from("game_projections").select("game_id,proj_home_margin,proj_total,elo_home_margin,sigma,status,explanation").eq("run_id", r.id),
  ]);
  if (rat.error) throw new Error(rat.error.message);
  if (proj.error) throw new Error(proj.error.message);
  void season;
  return {
    source: "run", runId: r.id, configLabel: `${r.model_configs.name} v${r.model_configs.version}`, paramsHash: r.model_configs.params_hash,
    params: r.model_configs.params, finishedAt: r.finished_at, summary: r.summary ?? {}, calibration: r.summary?.calibration ?? null,
    ratings: new Map((rat.data ?? []).map((x) => [x.team_id, {
      teamId: x.team_id, mov: Number(x.mov_rating), off: Number(x.off_rating), def: Number(x.def_rating), elo: num(x.elo), gamesUsed: x.games_used, uncertainty: Number(x.uncertainty),
    }])),
    projections: new Map((proj.data ?? []).map((x) => {
      const e = x.explanation as (Explanation & { statusReason?: string }) | null;
      return [x.game_id, { gameId: x.game_id, homeMargin: Number(x.proj_home_margin), total: Number(x.proj_total), eloMargin: num(x.elo_home_margin),
        sigma: num(x.sigma), status: x.status, statusReason: e?.statusReason ?? null, explanation: e }];
    })),
  };
}
