import type { SportKey } from "@bet207/core";
import type { Store } from "../store";

export interface JobContext {
  sport: SportKey | null;
  /** Explicit seasons (--seasons 2019-2025); empty = the job's default (usually the current season). */
  seasons: number[];
  dryRun: boolean;
  store: Store;
  now: Date;
  log: (msg: string) => void;
}

export interface JobResult { rows: number; details?: Record<string, unknown>; skipped?: string }
export type Job = (ctx: JobContext) => Promise<JobResult>;

/** Football seasons start in August/September; a January playoff game belongs to the previous season. */
export function currentFootballSeason(now: Date): number {
  return now.getUTCMonth() + 1 >= 3 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
}

/** BALLDONTLIE names NBA seasons by their starting year (2025 = 2025–26). */
export function currentNbaSeason(now: Date): number {
  return now.getUTCMonth() + 1 >= 8 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
}

export function parseSeasons(arg: string | undefined): number[] {
  if (!arg) return [];
  const out: number[] = [];
  for (const part of arg.split(",")) {
    const [a, b] = part.split("-").map((x) => Number(x.trim()));
    if (!a || !Number.isInteger(a)) throw new Error(`Bad --seasons value: ${arg}`);
    for (let y = a; y <= (b && Number.isInteger(b) ? b : a); y++) out.push(y);
  }
  return out;
}
