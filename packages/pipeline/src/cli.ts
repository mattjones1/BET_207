/**
 * Pipeline command line. Runs locally (`npm run pipeline -- <job> [--sport nfl] [--dry-run]`) and in
 * GitHub Actions. Jobs are added per phase; each is idempotent and records its outcome in pipeline_runs.
 */
import { SPORT_KEYS, isSportKey, type SportKey } from "@bet207/core";

export interface JobContext {
  sport: SportKey | null;
  dryRun: boolean;
  log: (msg: string) => void;
}
export type Job = (ctx: JobContext) => Promise<{ rows: number; details?: Record<string, unknown> }>;

const JOBS: Record<string, Job> = {};

export function registerJob(name: string, job: Job): void {
  JOBS[name] = job;
}

function usage(): never {
  console.log(`Usage: npm run pipeline -- <job> [--sport ${SPORT_KEYS.join("|")}] [--dry-run]\nJobs: ${Object.keys(JOBS).join(", ") || "(none yet)"}`);
  process.exit(1);
}

async function main() {
  const [name, ...rest] = process.argv.slice(2);
  if (!name || !JOBS[name]) usage();
  const sportArg = rest[rest.indexOf("--sport") + 1];
  const sport = rest.includes("--sport") && sportArg && isSportKey(sportArg) ? sportArg : null;
  const ctx: JobContext = { sport, dryRun: rest.includes("--dry-run"), log: (m) => console.log(`[${name}] ${m}`) };
  const res = await JOBS[name]!(ctx);
  ctx.log(`done: ${res.rows} rows${ctx.dryRun ? " (dry run, nothing written)" : ""}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
