/**
 * Pipeline command line. Runs locally and in GitHub Actions.
 *   npm run pipeline -- <job> [--sport nfl|ncaaf|nba] [--seasons 2019-2025] [--dry-run]
 * --dry-run uses an in-memory store: providers are called, nothing is written to Supabase.
 * --current limits a results job to the sport's current season (what the scheduled workflow uses).
 * Each run is recorded in pipeline_runs (success, failure, or skipped) with details.
 */
import { SPORT_KEYS, isSportKey } from "@bet207/core";
import { MemoryStore, SupabaseStore, type Store } from "./store";
import { currentFootballSeason, currentNbaSeason, parseSeasons, type Job, type JobContext } from "./jobs/context";
import { syncNcaaf, syncNba, syncNfl } from "./jobs/results";
import { syncOdds } from "./jobs/odds";
import { exportDemo } from "./jobs/demo";

const JOBS: Record<string, { run: Job; sport?: JobContext["sport"] }> = {
  "sync-nfl": { run: syncNfl, sport: "nfl" },
  "sync-ncaaf": { run: syncNcaaf, sport: "ncaaf" },
  "sync-nba": { run: syncNba, sport: "nba" },
  "sync-odds": { run: syncOdds },
  "export-demo": { run: exportDemo, sport: "nfl" },
};

function arg(rest: string[], flag: string): string | undefined {
  const i = rest.indexOf(flag);
  return i >= 0 ? rest[i + 1] : undefined;
}

async function main() {
  const [name, ...rest] = process.argv.slice(2);
  const job = name ? JOBS[name] : undefined;
  if (!job) {
    console.log(`Usage: npm run pipeline -- <job> [--sport ${SPORT_KEYS.join("|")}] [--seasons 2019-2025] [--dry-run]\nJobs: ${Object.keys(JOBS).join(", ")}`);
    process.exit(1);
  }
  const sportArg = arg(rest, "--sport");
  const dryRun = rest.includes("--dry-run") || name === "export-demo";
  const store: Store = dryRun ? new MemoryStore() : new SupabaseStore();
  const ctx: JobContext = {
    sport: job.sport ?? (sportArg && isSportKey(sportArg) ? sportArg : null),
    seasons: parseSeasons(arg(rest, "--seasons")),
    dryRun, store, now: new Date(),
    log: (m) => console.log(`[${name}] ${m}`),
  };
  if (rest.includes("--current") && ctx.sport) {
    ctx.seasons = [ctx.sport === "nba" ? currentNbaSeason(ctx.now) : currentFootballSeason(ctx.now)];
  }
  const runId = await store.startRun(name!, ctx.sport);
  try {
    const r = await job.run(ctx);
    await store.finishRun(runId, { status: r.skipped ? "skipped" : "success", rows: r.rows, details: { ...r.details, skipped: r.skipped } });
    ctx.log(`${r.skipped ? `skipped: ${r.skipped}` : "done"}: ${r.rows} rows${dryRun ? " (dry run: nothing written to Supabase)" : ""}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await store.finishRun(runId, { status: "failed", rows: 0, error: msg }).catch(() => {});
    console.error(`[${name}] failed: ${msg}`);
    process.exit(1);
  }
}

void main();
