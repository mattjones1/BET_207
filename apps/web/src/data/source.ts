/**
 * The app's only door to data. Pages call these functions through TanStack Query; they never touch
 * Supabase or fixtures directly. Two implementations: Supabase (live) and demo (labeled fixtures).
 */
import type { SportKey } from "@bet207/core";
import { env } from "../lib/env";
import { supabase } from "../lib/supabase";

export interface PipelineRun {
  job: string;
  sport: string | null;
  status: "running" | "success" | "failed" | "skipped";
  startedAt: string;
  finishedAt: string | null;
  rowsUpserted: number | null;
  error: string | null;
}

export interface QuotaStatus {
  provider: string;
  checkedAt: string;
  remaining: number | null;
  used: number | null;
  lastCost: number | null;
}

export interface DataStatus {
  mode: "live" | "demo";
  runs: PipelineRun[];
  quota: QuotaStatus[];
  gameCounts: Partial<Record<SportKey, number>>;
}

export async function getDataStatus(): Promise<DataStatus> {
  if (env.demo || !supabase) return { mode: "demo", runs: [], quota: [], gameCounts: {} };
  const [runs, quota, counts] = await Promise.all([
    supabase.from("pipeline_runs").select("job,sport,status,started_at,finished_at,rows_upserted,error").order("started_at", { ascending: false }).limit(20),
    supabase.from("api_quota_latest").select("provider,checked_at,remaining,used,last_cost"),
    supabase.from("game_counts").select("sport_key,games"),
  ]);
  for (const r of [runs, quota, counts]) if (r.error) throw new Error(r.error.message);
  return {
    mode: "live",
    runs: (runs.data ?? []).map((r) => ({
      job: r.job, sport: r.sport, status: r.status, startedAt: r.started_at, finishedAt: r.finished_at,
      rowsUpserted: r.rows_upserted, error: r.error,
    })),
    quota: (quota.data ?? []).map((q) => ({ provider: q.provider, checkedAt: q.checked_at, remaining: q.remaining, used: q.used, lastCost: q.last_cost })),
    gameCounts: Object.fromEntries((counts.data ?? []).map((c) => [c.sport_key, c.games])),
  };
}
