import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DEFAULT_PARAMS, SPORTS, SPORT_KEYS, currentSeason, formatFavorite, paramsDiff, paramsHash,
  type BacktestResult, type ModelParams, type SportKey,
} from "@bet207/core";
import { getHistory } from "../data/history";
import { getModel } from "../data/model";
import { getSeason } from "../data/source";
import { activeConfigId, listConfigs, promoteConfig, saveBacktest, saveConfig } from "../data/backtests";
import { backtestInWorker, computeInWorker } from "../lib/worker";
import { env } from "../lib/env";
import { usePref } from "../lib/prefs";
import { pct, signed } from "../lib/format";
import { Chip, Empty, ErrorBox, PageHeader, Panel } from "../components/ui";
import { record } from "../components/BacktestReport";

interface Field { path: string; label: string; help: string; min?: number; max?: number; step?: number; kind?: "bool" }
const FIELDS: { group: string; fields: Field[] }[] = [
  { group: "Margin-of-victory ratings", fields: [
    { path: "hfa", label: "Home advantage (pts)", help: "Prior for the fitted home edge.", min: 0, max: 6, step: 0.1 },
    { path: "hfaStrength", label: "Home edge firmness (games)", help: "How strongly the fit holds the home edge at the prior. Large = fixed.", min: 0, max: 1000, step: 5 },
    { path: "decayPerWeek", label: "Recency decay per week", help: "1 = all games equal; 0.95 = a game 4 weeks old counts ~81%.", min: 0.8, max: 1, step: 0.005 },
    { path: "marginCap", label: "Blowout cap (pts)", help: "Soft cap: c·tanh(margin/c). Smaller = blowouts count less.", min: 5, max: 80, step: 1 },
    { path: "priorGames", label: "Prior strength (games)", help: "Shrinkage toward last season's carried rating. Larger = slower to react early.", min: 0, max: 40, step: 0.5 },
    { path: "carryover", label: "Season carryover", help: "Share of last season's rating kept (0–1).", min: 0, max: 1, step: 0.05 },
    { path: "minGames", label: "Minimum games for 'ok' status", help: "Below this, projections are labeled early-season.", min: 0, max: 20, step: 1 },
  ] },
  { group: "Rest", fields: [
    { path: "useRest", label: "Fit a rest term", help: "Adds points for a rest-day edge.", kind: "bool" },
    { path: "restCap", label: "Rest edge cap (days)", help: "Rest differences beyond this count as this many.", min: 1, max: 10, step: 1 },
    { path: "restStrength", label: "Rest term shrinkage (games)", help: "Pulls the rest effect toward zero.", min: 0, max: 1000, step: 5 },
  ] },
  { group: "Elo", fields: [
    { path: "elo.k", label: "K-factor", help: "How much one game moves Elo.", min: 4, max: 60, step: 1 },
    { path: "elo.hfa", label: "Home advantage (Elo pts)", help: "", min: 0, max: 150, step: 1 },
    { path: "elo.carryover", label: "Season carryover", help: "Share of distance from 1500 kept each new season.", min: 0, max: 1, step: 0.05 },
    { path: "elo.eloPerPoint", label: "Elo points per point of margin", help: "Converts Elo difference to a spread.", min: 10, max: 60, step: 1 },
    { path: "elo.movMultiplier", label: "Margin-of-victory multiplier", help: "Bigger wins move Elo more (with favorite dampening).", kind: "bool" },
  ] },
  { group: "Totals (experimental)", fields: [
    { path: "totals.priorGames", label: "Prior strength (games)", help: "", min: 0, max: 40, step: 0.5 },
    { path: "totals.carryover", label: "Season carryover", help: "", min: 0, max: 1, step: 0.05 },
  ] },
];

const getAt = (o: unknown, path: string): unknown => path.split(".").reduce<unknown>((x, k) => (x as Record<string, unknown>)?.[k], o);
function setAt(p: ModelParams, path: string, v: unknown): ModelParams {
  const next = structuredClone(p) as unknown as Record<string, unknown>;
  const keys = path.split(".");
  let cur = next;
  for (const k of keys.slice(0, -1)) cur = cur[k] as Record<string, unknown>;
  cur[keys.at(-1)!] = v;
  return next as unknown as ModelParams;
}

export function ModelLab() {
  const [sport, setSport] = usePref<SportKey>("lab.sport", "nfl");
  return (
    <>
      <PageHeader title="Model Lab" subtitle="Change parameters, preview projections, and test against history. Every saved change is a new immutable version." />
      <div className="flex gap-2 mb-4" role="tablist" aria-label="Sport">
        {SPORT_KEYS.map((k) => <button key={k} role="tab" aria-selected={sport === k} className={`btn ${sport === k ? "border-accent text-ink" : "text-mute"}`} onClick={() => setSport(k)}>{SPORTS[k].name}</button>)}
      </div>
      <Lab key={sport} sport={sport} />
    </>
  );
}

type BtSummary = Omit<BacktestResult, "observations">;

function Lab({ sport }: { sport: SportKey }) {
  const qc = useQueryClient();
  const now = useMemo(() => new Date(), []);
  const season = currentSeason(sport, now);
  const model = useQuery({ queryKey: ["model", sport, season], queryFn: () => getModel(sport, season) });
  const seasonQ = useQuery({ queryKey: ["season", sport, season], queryFn: () => getSeason(sport, season) });
  const history = useQuery({ queryKey: ["history", sport], queryFn: () => getHistory(sport), staleTime: 10 * 60_000 });
  const configs = useQuery({ queryKey: ["configs", sport], queryFn: () => listConfigs(sport) });
  const active = useQuery({ queryKey: ["active-config", sport], queryFn: () => activeConfigId(sport) });

  const baseline = model.data?.params ?? DEFAULT_PARAMS[sport];
  const [params, setParams] = useState<ModelParams>(baseline);
  useEffect(() => { setParams(baseline); }, [model.data?.paramsHash]);   // reset when the production config loads
  const changes = paramsDiff(baseline, params);
  const seasons = useMemo(() => [...new Set(history.data?.games.map((g) => g.season) ?? [])].sort((a, b) => a - b), [history.data]);
  const doneSeasons = seasons.filter((s) => s < season);
  const testSeasons = doneSeasons.slice(Math.min(2, Math.max(0, doneSeasons.length - 1))).slice(-8);

  const preview = useMutation({ mutationFn: () => computeInWorker(history.data!.games, params, now.toISOString(), "Preview") });
  const compare = useMutation({
    mutationFn: async () => {
      const h = history.data!, slot = sport === "nba" ? "day" : "week";
      const [a, b] = await Promise.all([backtestInWorker(h.games, h.lines, baseline, testSeasons, slot), backtestInWorker(h.games, h.lines, params, testSeasons, slot)]);
      const strip = ({ observations: _o, ...r }: BacktestResult): BtSummary => r;
      return { base: strip(a), next: strip(b) };
    },
  });
  const [name, setName] = useState("my-model");
  const save = useMutation({
    mutationFn: async () => {
      const id = await saveConfig(sport, name.trim() || "my-model", params, changes.join("; "));
      if (compare.data) await saveBacktest(sport, id, compare.data.next);
      return id;
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["configs", sport] }); void qc.invalidateQueries({ queryKey: ["backtests", sport] }); },
  });
  const promote = useMutation({
    mutationFn: (id: string | null) => promoteConfig(sport, id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["active-config", sport] }),
  });

  const teams = seasonQ.data?.teams;
  const label = (id: string) => teams?.get(id)?.abbr ?? id;
  const err = model.error ?? history.error ?? configs.error ?? preview.error ?? compare.error ?? save.error ?? promote.error;

  if (history.isLoading) return <p className="text-mute" role="status">Loading history…</p>;
  if (!history.data?.games.length) return <Empty title={`No ${SPORTS[sport].name} history stored`}>Ingest results first; the lab runs models over stored games.</Empty>;

  return (
    <div className="grid gap-4 xl:grid-cols-[24rem_1fr]">
      <div className="space-y-4">
        <Panel title="Parameters" right={<span className="text-[11px] text-faint num">hash {paramsHash(params)}</span>}>
          <p className="text-xs text-mute mb-3">Starting from <strong>{model.data?.configLabel ?? "the default"}</strong>. Defaults are reasonable starting points, not validated values.</p>
          {FIELDS.map((g) => (
            <fieldset key={g.group} className="mb-3">
              <legend className="panel-h mb-2">{g.group}</legend>
              <div className="space-y-2">
                {g.fields.map((f) => {
                  const v = getAt(params, f.path), changed = getAt(baseline, f.path) !== v;
                  return f.kind === "bool" ? (
                    <label key={f.path} className="flex items-center gap-2 text-sm" title={f.help}>
                      <input type="checkbox" checked={Boolean(v)} onChange={(e) => setParams(setAt(params, f.path, e.target.checked))} />
                      {f.label} {changed && <Chip tone="accent">changed</Chip>}
                    </label>
                  ) : (
                    <label key={f.path} className="grid grid-cols-[1fr_6rem] items-center gap-2 text-sm" title={f.help}>
                      <span>{f.label} {changed && <Chip tone="accent">changed</Chip>}</span>
                      <input className="input py-1 num text-right" type="number" min={f.min} max={f.max} step={f.step} value={Number(v)}
                        onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n)) setParams(setAt(params, f.path, Math.min(f.max ?? n, Math.max(f.min ?? n, n)))); }} />
                    </label>
                  );
                })}
              </div>
            </fieldset>
          ))}
          <div className="flex flex-wrap gap-2">
            <button className="btn" onClick={() => setParams(baseline)} disabled={!changes.length}>Reset</button>
            <button className="btn" onClick={() => setParams(DEFAULT_PARAMS[sport])}>System defaults</button>
          </div>
        </Panel>

        <Panel title="Saved configurations">
          {env.demo ? <p className="text-sm text-mute">Saving and promoting need Supabase. Demo mode previews and tests in your browser only.</p> : (
            <>
              <div className="flex gap-2 mb-3">
                <input className="input" aria-label="Configuration name" value={name} onChange={(e) => setName(e.target.value)} />
                <button className="btn btn-primary whitespace-nowrap" disabled={!changes.length || save.isPending} onClick={() => save.mutate()}>Save version</button>
              </div>
              {save.isSuccess && <p className="text-pos text-xs mb-2">Saved{compare.data ? " with its backtest" : ""}.</p>}
              <ul className="space-y-1.5 text-sm">
                {(configs.data ?? []).map((c) => (
                  <li key={c.id} className="flex items-center gap-2">
                    <span>{c.name} v{c.version}</span>
                    {active.data === c.id && <Chip tone="pos">production</Chip>}
                    <button className="text-accent text-xs ml-auto" onClick={() => setParams(c.params)}>Load</button>
                    {!c.name.endsWith("(system)") && active.data !== c.id && <button className="text-accent text-xs" onClick={() => promote.mutate(c.id)}>Promote</button>}
                  </li>
                ))}
              </ul>
              {active.data && <button className="text-xs text-mute mt-2" onClick={() => promote.mutate(null)}>Revert production to the system default</button>}
              <p className="text-[11px] text-faint mt-2">Promoting changes what the nightly pipeline uses. Past runs and predictions are never overwritten.</p>
            </>
          )}
        </Panel>
      </div>

      <div className="space-y-4">
        {err && <ErrorBox error={err} />}
        <Panel title="Changes from the starting configuration">
          {changes.length ? <ul className="text-sm num list-disc pl-5">{changes.map((c) => <li key={c}>{c}</li>)}</ul> : <p className="text-sm text-mute">No changes yet.</p>}
          <div className="flex flex-wrap gap-2 mt-3">
            <button className="btn" disabled={preview.isPending} onClick={() => preview.mutate()}>{preview.isPending ? "Computing…" : "Preview upcoming projections"}</button>
            <button className="btn btn-primary" disabled={compare.isPending || !testSeasons.length} onClick={() => compare.mutate()}>
              {compare.isPending ? "Backtesting both…" : `Backtest vs. starting config (${testSeasons[0] ?? "—"}–${testSeasons.at(-1) ?? "—"})`}
            </button>
          </div>
        </Panel>

        {compare.data && <Comparison base={compare.data.base} next={compare.data.next} />}

        {preview.data && model.data && (
          <Panel title="Upcoming projections: starting config vs. these parameters">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-mute text-xs text-left"><tr><th className="py-1">Game</th><th className="text-right">Current</th><th className="text-right">Preview</th><th className="text-right" title="Change in projected home margin">Δ home margin</th><th className="text-right">Total now → preview</th></tr></thead>
                <tbody>
                  {[...preview.data.projections.values()].slice(0, 40).map((p) => {
                    const g = history.data!.games.find((x) => x.id === p.gameId)!;
                    const b = model.data!.projections.get(p.gameId);
                    return (
                      <tr key={p.gameId} className="border-t border-line">
                        <td className="py-1.5">{label(g.awayTeamId)} @ {label(g.homeTeamId)}</td>
                        <td className="text-right num">{b ? formatFavorite(b.homeMargin, label(g.homeTeamId), label(g.awayTeamId)) : "—"}</td>
                        <td className="text-right num">{formatFavorite(p.homeMargin, label(g.homeTeamId), label(g.awayTeamId))}</td>
                        <td className="text-right num">{b ? signed(p.homeMargin - b.homeMargin) : "—"}</td>
                        <td className="text-right num">{b ? b.total.toFixed(1) : "—"} → {p.total.toFixed(1)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>
        )}

        {preview.data && (
          <Panel title="Team strength with these parameters (top 15)">
            <ol className="grid sm:grid-cols-3 gap-x-6 gap-y-1 text-sm">
              {[...preview.data.ratings.values()].sort((a, b) => b.mov - a.mov).slice(0, 15).map((r, i) => (
                <li key={r.teamId} className="flex gap-2"><span className="text-faint num w-5">{i + 1}</span><span className="font-medium">{label(r.teamId)}</span><span className="ml-auto num">{signed(r.mov)}</span></li>
              ))}
            </ol>
          </Panel>
        )}
      </div>
    </div>
  );
}

function Comparison({ base, next }: { base: BtSummary; next: BtSummary }) {
  const rows: [string, (r: BtSummary) => string][] = [
    ["Games", (r) => r.games.toLocaleString()],
    ["Margin MAE (lower is better)", (r) => r.accuracy.model.mae.toFixed(3)],
    ["Margin RMSE", (r) => r.accuracy.model.rmse.toFixed(3)],
    ["Elo MAE", (r) => r.accuracy.elo?.mae.toFixed(3) ?? "—"],
    ["Totals MAE", (r) => r.accuracy.totals.mae.toFixed(3)],
    ["ATS record", (r) => `${record(r.ats)} (${pct(r.ats.coverRate)})`],
    ["ATS 95% interval", (r) => (r.ats.ci95 ? `${pct(r.ats.ci95[0])} – ${pct(r.ats.ci95[1])}` : "—")],
    ["ROI (recorded prices)", (r) => pct(r.ats.roi)],
    ["3+ point disagreements", (r) => { const s = [r.buckets[3]!.stats, r.buckets[4]!.stats]; const w = s[0]!.wins + s[1]!.wins, l = s[0]!.losses + s[1]!.losses; return `${w}-${l} (${pct(w + l ? w / (w + l) : null)})`; }],
    ["P(cover) calibration", (r) => (r.calibration.chosen.passes ? `passes (${r.calibration.chosen.method})` : "none passed")],
  ];
  const overlap = base.ats.ci95 && next.ats.ci95 && next.ats.ci95[0] <= base.ats.ci95[1] && base.ats.ci95[0] <= next.ats.ci95[1];
  return (
    <Panel title="Backtest comparison (same seasons, walk-forward)">
      <table className="w-full text-sm">
        <thead className="text-mute text-xs text-left"><tr><th className="py-1">Measure</th><th className="text-right">Starting config</th><th className="text-right">These parameters</th></tr></thead>
        <tbody>{rows.map(([l, f]) => (
          <tr key={l} className="border-t border-line"><td className="py-1.5">{l}</td><td className="text-right num">{f(base)}</td><td className="text-right num">{f(next)}</td></tr>
        ))}</tbody>
      </table>
      <p className="text-xs text-warn mt-2">
        {overlap ? "The two ATS intervals overlap: the difference is consistent with noise. " : ""}
        Tuning parameters on the same seasons you test on overfits. Prefer changes that lower MAE and hold up on seasons you didn't tune on.
      </p>
    </Panel>
  );
}
