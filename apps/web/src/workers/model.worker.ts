/// <reference lib="webworker" />
/**
 * Runs the @bet207/core engine off the main thread: Model Lab previews and in-browser backtests.
 */
import type { FitGame, ModelParams } from "@bet207/core";
import { computeModel } from "../data/compute";
import { runBacktest, type BacktestLine } from "@bet207/core";

export type WorkerRequest =
  | { id: number; kind: "current"; games: FitGame[]; params: ModelParams; asOf: string; label: string }
  | { id: number; kind: "backtest"; games: FitGame[]; lines: BacktestLine[]; params: ModelParams; seasons: number[]; slot: "week" | "day" };

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const m = e.data;
  try {
    const result = m.kind === "current"
      ? computeModel(m.games, m.params, m.asOf, m.label)
      : runBacktest(m.games, m.lines, m.params, { seasons: m.seasons, slot: m.slot });
    (self as unknown as Worker).postMessage({ id: m.id, ok: true, result });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id: m.id, ok: false, error: (err as Error).message });
  }
};
