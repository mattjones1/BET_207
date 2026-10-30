/** Stored backtest runs (system runs from the pipeline, plus the user's own saved runs). */
import type { BacktestResult, ModelParams, SportKey } from "@bet207/core";
import { paramsHash } from "@bet207/core";
import { env } from "../lib/env";
import { supabase } from "../lib/supabase";
import { SPORT_ID } from "./source";

export interface StoredBacktest {
  id: string; createdAt: string; owner: string | null; configLabel: string; lineSource: string;
  summary: Omit<BacktestResult, "observations">;
}

export async function listBacktests(sport: SportKey): Promise<StoredBacktest[]> {
  if (env.demo || !supabase) return [];
  const r = await supabase.from("backtest_runs").select("id,created_at,owner,line_source,summary,model_configs(name,version)")
    .eq("sport_id", SPORT_ID[sport]).order("created_at", { ascending: false }).limit(20);
  if (r.error) throw new Error(r.error.message);
  return (r.data ?? []).map((x) => {
    const c = x.model_configs as unknown as { name: string; version: number } | null;
    return { id: x.id, createdAt: x.created_at, owner: x.owner, lineSource: x.line_source, summary: x.summary,
      configLabel: c ? `${c.name} v${c.version}` : "?" };
  });
}

/** Save a config the user made (immutable, versioned by name). Returns the config id. */
export async function saveConfig(sport: SportKey, name: string, params: ModelParams, notes: string): Promise<string> {
  if (!supabase) throw new Error("Saving needs Supabase (demo mode is read-only).");
  const { data: u } = await supabase.auth.getUser();
  const owner = u.user?.id;
  if (!owner) throw new Error("Not signed in.");
  const hash = paramsHash(params);
  const found = await supabase.from("model_configs").select("id").eq("sport_id", SPORT_ID[sport]).eq("owner", owner).eq("params_hash", hash).limit(1);
  if (found.data?.[0]) return found.data[0].id;
  const prev = await supabase.from("model_configs").select("version").eq("sport_id", SPORT_ID[sport]).eq("owner", owner).eq("name", name).order("version", { ascending: false }).limit(1);
  const ins = await supabase.from("model_configs").insert({ sport_id: SPORT_ID[sport], owner, name, version: (prev.data?.[0]?.version ?? 0) + 1, params, params_hash: hash, notes })
    .select("id").single();
  if (ins.error) throw new Error(ins.error.message);
  return ins.data.id;
}

export async function saveBacktest(sport: SportKey, configId: string, summary: Omit<BacktestResult, "observations">): Promise<void> {
  if (!supabase) throw new Error("Saving needs Supabase.");
  const { data: u } = await supabase.auth.getUser();
  const r = await supabase.from("backtest_runs").insert({
    config_id: configId, owner: u.user?.id, sport_id: SPORT_ID[sport], seasons: summary.seasons, method: "walk_forward",
    line_source: summary.lineSources.join(", ") || "none", code_version: "browser", summary,
  });
  if (r.error) throw new Error(r.error.message);
}

export interface UserConfig { id: string; name: string; version: number; params: ModelParams; notes: string | null; createdAt: string }
export async function listConfigs(sport: SportKey): Promise<UserConfig[]> {
  if (env.demo || !supabase) return [];
  const r = await supabase.from("model_configs").select("id,name,version,params,notes,created_at,owner").eq("sport_id", SPORT_ID[sport]).order("created_at", { ascending: false });
  if (r.error) throw new Error(r.error.message);
  return (r.data ?? []).map((c) => ({ id: c.id, name: c.owner ? c.name : `${c.name} (system)`, version: c.version, params: c.params, notes: c.notes, createdAt: c.created_at }));
}

/** Promote a config for production: the pipeline reads user_settings.prefs.activeConfig[sport]. */
export async function promoteConfig(sport: SportKey, configId: string | null): Promise<void> {
  if (!supabase) throw new Error("Needs Supabase.");
  const cur = await supabase.from("user_settings").select("prefs").maybeSingle();
  const prefs = (cur.data?.prefs ?? {}) as { activeConfig?: Record<string, string> };
  const activeConfig = { ...(prefs.activeConfig ?? {}) };
  if (configId) activeConfig[sport] = configId; else delete activeConfig[sport];
  const r = await supabase.from("user_settings").upsert({ prefs: { ...prefs, activeConfig } });
  if (r.error) throw new Error(r.error.message);
}

export async function activeConfigId(sport: SportKey): Promise<string | null> {
  if (env.demo || !supabase) return null;
  const r = await supabase.from("user_settings").select("prefs").maybeSingle();
  return ((r.data?.prefs ?? {}) as { activeConfig?: Record<string, string> }).activeConfig?.[sport] ?? null;
}
