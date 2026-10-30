/** Promise wrapper around the model worker. One worker, many requests. */
import type { BacktestLine, BacktestResult, FitGame, ModelParams } from "@bet207/core";
import type { ModelData } from "../data/compute";

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

function get(): Worker {
  if (!worker) {
    worker = new Worker(new URL("../workers/model.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<{ id: number; ok: boolean; result?: unknown; error?: string }>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.ok) p.resolve(e.data.result); else p.reject(new Error(e.data.error));
    };
  }
  return worker;
}

export function computeInWorker(games: FitGame[], params: ModelParams, asOf: string, label: string): Promise<ModelData> {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    get().postMessage({ id, kind: "current", games, params, asOf, label });
  });
}

export function backtestInWorker(games: FitGame[], lines: BacktestLine[], params: ModelParams, seasons: number[], slot: "week" | "day"): Promise<BacktestResult> {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    get().postMessage({ id, kind: "backtest", games, lines, params, seasons, slot });
  });
}
