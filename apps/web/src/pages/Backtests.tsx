import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { DEFAULT_PARAMS, SPORTS, SPORT_KEYS, currentSeason, type BacktestResult, type SportKey } from "@bet207/core";
import { getHistory } from "../data/history";
import { getModel } from "../data/model";
import { listBacktests } from "../data/backtests";
import { backtestInWorker } from "../lib/worker";
import { BacktestReport, record } from "../components/BacktestReport";
import { Empty, ErrorBox, PageHeader, Panel, timeAgo } from "../components/ui";
import { usePref } from "../lib/prefs";
import { pct } from "../lib/format";

export function Backtests() {
  const [sport, setSport] = usePref<SportKey>("bt.sport", "nfl");
  return (
    <>
      <PageHeader title="Backtesting" subtitle="Walk-forward evaluation: every projection uses only results known before that game. This is where a model earns (or doesn't earn) trust." />
      <div className="flex gap-2 mb-4" role="tablist" aria-label="Sport">
        {SPORT_KEYS.map((k) => <button key={k} role="tab" aria-selected={sport === k} className={`btn ${sport === k ? "border-accent text-ink" : "text-mute"}`} onClick={() => setSport(k)}>{SPORTS[k].name}</button>)}
      </div>
      <SportBacktests key={sport} sport={sport} />
    </>
  );
}

function SportBacktests({ sport }: { sport: SportKey }) {
  const now = useMemo(() => new Date(), []);
  const stored = useQuery({ queryKey: ["backtests", sport], queryFn: () => listBacktests(sport) });
  const history = useQuery({ queryKey: ["history", sport], queryFn: () => getHistory(sport), staleTime: 10 * 60_000 });
  const model = useQuery({ queryKey: ["model", sport, currentSeason(sport, now)], queryFn: () => getModel(sport, currentSeason(sport, now)) });
  const seasons = useMemo(() => [...new Set(history.data?.games.map((g) => g.season) ?? [])].sort((a, b) => a - b), [history.data]);
  const [from, setFrom] = useState<number | null>(null);
  const [to, setTo] = useState<number | null>(null);
  const cur = currentSeason(sport, now);
  // Default: skip the first seasons (they seed priors), stop before the unfinished current season.
  const done = seasons.filter((s) => s < cur);
  const hi = to ?? done.at(-1) ?? seasons.at(-1) ?? null;
  const lo = from ?? done[Math.min(2, Math.max(0, done.length - 1))] ?? hi;
  const [selected, setSelected] = useState<string | null>(null);

  const run = useMutation({
    mutationFn: async (): Promise<Omit<BacktestResult, "observations">> => {
      const h = history.data!;
      const params = model.data?.params ?? DEFAULT_PARAMS[sport];
      const list = seasons.filter((s) => s >= lo! && s <= hi!);
      const { observations: _o, ...rest } = await backtestInWorker(h.games, h.lines, params, list, sport === "nba" ? "day" : "week");
      return rest;
    },
  });
  const shown = run.data ?? stored.data?.find((b) => b.id === selected)?.summary ?? stored.data?.[0]?.summary ?? null;

  return (
    <div className="space-y-4">
      {(stored.error || history.error) && <ErrorBox error={stored.error ?? history.error} />}
      <Panel title="Run a backtest">
        {history.isLoading ? <p className="text-mute text-sm" role="status">Loading game history…</p> : !seasons.length ? (
          <Empty title={`No ${SPORTS[sport].name} history stored`}>Ingest results first (docs/PIPELINE.md).</Empty>
        ) : (
          <div className="flex flex-wrap gap-3 items-end text-sm">
            <label className="flex flex-col gap-1 text-xs text-mute">From season
              <select className="input" value={lo ?? ""} onChange={(e) => setFrom(Number(e.target.value))}>{seasons.map((s) => <option key={s}>{s}</option>)}</select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-mute">To season
              <select className="input" value={hi ?? ""} onChange={(e) => setTo(Number(e.target.value))}>{seasons.map((s) => <option key={s}>{s}</option>)}</select>
            </label>
            <button className="btn btn-primary" disabled={run.isPending || lo === null || hi === null || lo > hi} onClick={() => run.mutate()}>
              {run.isPending ? "Running in your browser…" : "Run walk-forward backtest"}
            </button>
            <p className="text-xs text-faint basis-full">
              Uses {model.data ? model.data.configLabel : "the default configuration"}. The first seasons of data seed the priors, so start a couple of seasons after the earliest.
              {sport === "nba" && " NBA has no free historical lines: this test measures accuracy only, and market comparisons will grow from captured odds."}
              {history.data && ` ${history.data.lines.length.toLocaleString()} historical lines available.`}
            </p>
          </div>
        )}
        {run.error && <p className="text-neg text-sm mt-2" role="alert">{(run.error as Error).message}</p>}
      </Panel>

      {!!stored.data?.length && (
        <Panel title="Stored backtests">
          <table className="w-full text-sm">
            <thead className="text-mute text-xs text-left"><tr><th className="py-1">When</th><th>Config</th><th>Seasons</th><th>Games</th><th>ATS</th><th>Calibration</th><th /></tr></thead>
            <tbody>{stored.data.map((b) => (
              <tr key={b.id} className="border-t border-line">
                <td className="py-1.5 text-mute">{timeAgo(b.createdAt)}{b.owner ? "" : " · pipeline"}</td><td>{b.configLabel}</td>
                <td className="num">{b.summary.seasons[0]}–{b.summary.seasons.at(-1)}</td><td className="num">{b.summary.games}</td>
                <td className="num">{record(b.summary.ats)} ({pct(b.summary.ats.coverRate)})</td>
                <td>{b.summary.calibration.chosen.passes ? b.summary.calibration.chosen.method : "none passed"}</td>
                <td><button className="text-accent text-xs" onClick={() => { run.reset(); setSelected(b.id); }}>View</button></td>
              </tr>))}</tbody>
          </table>
        </Panel>
      )}

      {shown ? <BacktestReport r={shown} title={run.data ? "This run (not saved)" : "Stored run"} />
        : !run.isPending && <Empty title="No backtest results yet">Run one above, or let the pipeline's backtest job store one.</Empty>}
    </div>
  );
}
