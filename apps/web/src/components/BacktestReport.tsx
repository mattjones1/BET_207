import { Bar, BarChart, CartesianGrid, ErrorBar, Line, LineChart, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { MIN_SAMPLE, type AtsStats, type BacktestResult } from "@bet207/core";
import { Chip, Panel } from "./ui";
import { pct } from "../lib/format";

type Summary = Omit<BacktestResult, "observations">;
const BREAK_EVEN = 110 / 210;   // −110 both sides
const axis = { stroke: "#64738a", fontSize: 11 };
const grid = { stroke: "#232d3f", strokeDasharray: "3 3" };
const asPct = (v: unknown) => (typeof v === "number" ? pct(v) : String(v));
const tip = { contentStyle: { background: "#111723", border: "1px solid #232d3f", fontSize: 12 }, labelStyle: { color: "#93a1b5" } };

export function record(s: AtsStats): string {
  return `${s.wins}-${s.losses}${s.pushes ? `-${s.pushes}` : ""}`;
}

function Ats({ s, label }: { s: AtsStats; label?: string }) {
  return (
    <span className="num">
      {label && <span className="text-mute font-sans">{label} </span>}
      {record(s)} · {pct(s.coverRate)} {s.ci95 && <span className="text-faint">[{pct(s.ci95[0])}, {pct(s.ci95[1])}]</span>}
      {!s.sufficient && <Chip tone="warn" title={`Fewer than ${MIN_SAMPLE} decided games`}>insufficient sample</Chip>}
    </span>
  );
}

function roi(s: AtsStats) {
  return (
    <span className="num">
      {s.roi !== null ? <>{pct(s.roi)} <span className="text-faint">({s.pricedBets} priced)</span></> : <span className="text-faint">no recorded prices</span>}
      {s.roiAssumed !== null && <span className="text-faint"> · {pct(s.roiAssumed)} at assumed −110</span>}
    </span>
  );
}

export function BacktestReport({ r, title }: { r: Summary; title?: string }) {
  const verdictBeats = r.ats.ci95 && r.ats.ci95[0] > BREAK_EVEN;
  const closing = r.lineSources.some((s) => s.includes("closing"));
  const buckets = r.buckets.map((b) => ({
    label: b.label, rate: b.stats.coverRate ?? 0, n: b.stats.wins + b.stats.losses,
    err: b.stats.ci95 && b.stats.coverRate !== null ? [b.stats.coverRate - b.stats.ci95[0], b.stats.ci95[1] - b.stats.coverRate] : [0, 0],
    fill: b.stats.sufficient ? "#38bdf8" : "#38bdf855",
  }));
  const acc = [
    { name: "Model (MOV)", ...r.accuracy.model },
    ...(r.accuracy.elo ? [{ name: "Elo", ...r.accuracy.elo }] : []),
    ...(r.accuracy.blend ? [{ name: "50/50 blend", ...r.accuracy.blend }] : []),
    ...(r.accuracy.market ? [{ name: "Market line", mae: r.accuracy.market.mae, rmse: r.accuracy.market.rmse }] : []),
  ];
  const cal = r.calibration;
  return (
    <div className="space-y-4">
      {title && <h2 className="text-lg font-semibold">{title}</h2>}
      <Panel title="Summary">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
          <Stat label="Games evaluated" value={r.games.toLocaleString()} sub={`${r.seasons[0]}–${r.seasons.at(-1)} · walk-forward by ${r.slot}`} />
          <Stat label="Against the spread (model's side)" value={<Ats s={r.ats} />} sub="95% interval in brackets" />
          <Stat label="ROI" value={roi(r.ats)} sub="Recorded prices where available" />
          <Stat label="Over / under (model's lean)" value={<Ats s={r.ou} />} sub="Totals model is experimental" />
        </div>
        <div className="mt-3 text-xs space-y-1">
          <p className={verdictBeats ? "text-pos" : "text-mute"}>
            {verdictBeats
              ? "The lower end of the 95% interval is above the −110 break-even rate (52.4%). That's evidence worth testing further, not proof of an edge."
              : "The 95% interval includes the −110 break-even rate (52.4%), so this test shows no demonstrated edge against these lines."}
          </p>
          <p className="text-faint">Line source: {r.lineSources.join(", ") || "none (accuracy only)"}. {closing && "Closing lines are a retrospective benchmark: they weren't necessarily available when each projection would have been made."}</p>
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Cover rate by model–market disagreement">
          <div className="h-56">
            <ResponsiveContainer>
              <BarChart data={buckets} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid {...grid} vertical={false} />
                <XAxis dataKey="label" {...axis} />
                <YAxis domain={[0.35, 0.65]} tickFormatter={(v: number) => `${Math.round(v * 100)}%`} {...axis} />
                <Tooltip {...tip} formatter={asPct} />
                <ReferenceLine y={BREAK_EVEN} stroke="#fbbf24" strokeDasharray="4 4" label={{ value: "break-even −110", fill: "#fbbf24", fontSize: 10, position: "insideTopRight" }} />
                <Bar dataKey="rate" name="Cover rate" fill="#38bdf8" isAnimationActive={false}>
                  <ErrorBar dataKey="err" width={4} stroke="#93a1b5" />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <table className="w-full text-xs mt-2">
            <thead className="text-mute text-left"><tr><th className="py-1">Disagreement (pts)</th><th>Record</th><th>Cover</th><th>95% interval</th><th>ROI</th></tr></thead>
            <tbody>{r.buckets.map((b) => (
              <tr key={b.key} className="border-t border-line">
                <td className="py-1">{b.label}</td><td className="num">{record(b.stats)}</td><td className="num">{pct(b.stats.coverRate)}</td>
                <td className="num text-faint">{b.stats.ci95 ? `${pct(b.stats.ci95[0])} – ${pct(b.stats.ci95[1])}` : "—"} {!b.stats.sufficient && <Chip tone="warn">small</Chip>}</td>
                <td className="num">{pct(b.stats.roi ?? b.stats.roiAssumed)}</td>
              </tr>))}</tbody>
          </table>
        </Panel>

        <Panel title="Prediction accuracy (actual − predicted home margin)">
          <table className="w-full text-sm">
            <thead className="text-mute text-xs text-left"><tr><th className="py-1">Predictor</th><th className="text-right">MAE</th><th className="text-right">RMSE</th></tr></thead>
            <tbody>{acc.map((a) => (
              <tr key={a.name} className="border-t border-line"><td className="py-1.5">{a.name}</td><td className="text-right num">{a.mae.toFixed(2)}</td><td className="text-right num">{a.rmse.toFixed(2)}</td></tr>))}
              <tr className="border-t border-line"><td className="py-1.5">Totals model</td><td className="text-right num">{r.accuracy.totals.mae.toFixed(2)}</td><td className="text-right num">{r.accuracy.totals.rmse.toFixed(2)}</td></tr>
              {r.accuracy.totals.marketMae !== null && <tr className="border-t border-line"><td className="py-1.5">Market total</td><td className="text-right num">{r.accuracy.totals.marketMae.toFixed(2)}</td><td /></tr>}
            </tbody>
          </table>
          <p className="text-xs text-faint mt-2">Lower is better. The market usually wins this comparison; a model can still disagree usefully, which is what the buckets test. A blend is listed for comparison only: it isn't used unless it proves better out of sample.</p>
        </Panel>

        <Panel title="Probability calibration (out of sample)">
          <table className="w-full text-sm">
            <thead className="text-mute text-xs text-left"><tr><th className="py-1">Method</th><th className="text-right">Brier score</th></tr></thead>
            <tbody>
              {[["Normal(σ)", cal.chosen.brier.normal], ["Disagreement-fitted (logistic)", cal.chosen.brier.edge], ["Coin flip (50%)", cal.chosen.brier.coinFlip]].map(([n, v]) => (
                <tr key={n as string} className="border-t border-line"><td className="py-1.5">{n}</td><td className="text-right num">{typeof v === "number" ? v.toFixed(4) : "—"}</td></tr>
              ))}
            </tbody>
          </table>
          <p className={`text-xs mt-2 ${cal.chosen.passes ? "text-pos" : "text-warn"}`}>
            {cal.chosen.passes ? `Using ${cal.chosen.method === "edge" ? "the disagreement-fitted" : "the normal"} method for P(cover): it beat a coin flip on ${cal.chosen.brier.n} games.`
              : "No method beat a coin flip, so the app shows no P(cover) or expected value for this configuration."}
          </p>
          <p className="text-xs text-faint mt-1">Lower Brier is better. σ for each season comes only from earlier seasons. Spread σ {cal.spreadSigma?.toFixed(2) ?? "—"}, totals σ {cal.totalSigma?.toFixed(2) ?? "—"}.</p>
          {cal.bins.length > 0 && (
            <div className="h-48 mt-2">
              <ResponsiveContainer>
                <ScatterChart margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                  <CartesianGrid {...grid} />
                  <XAxis type="number" dataKey="predicted" name="Predicted" domain={[0.48, 0.72]} tickFormatter={(v: number) => `${Math.round(v * 100)}%`} {...axis} />
                  <YAxis type="number" dataKey="actual" name="Actual" domain={[0.35, 0.75]} tickFormatter={(v: number) => `${Math.round(v * 100)}%`} {...axis} />
                  <ZAxis type="number" dataKey="n" range={[30, 200]} name="Games" />
                  <Tooltip {...tip} formatter={(v: unknown, n: unknown) => (n === "Games" ? String(v) : asPct(v))} />
                  <ReferenceLine segment={[{ x: 0.48, y: 0.48 }, { x: 0.72, y: 0.72 }]} stroke="#64738a" strokeDasharray="4 4" />
                  <Scatter data={cal.bins} fill="#38bdf8" isAnimationActive={false} />
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          )}
          <p className="text-[11px] text-faint">Reliability (normal method): dots on the dashed line would mean well-calibrated probabilities.</p>
        </Panel>

        <Panel title="By season and side">
          <div className="h-40">
            <ResponsiveContainer>
              <LineChart data={r.bySeason.map((s) => ({ season: s.season, rate: s.stats.coverRate, mae: s.mae }))} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid {...grid} />
                <XAxis dataKey="season" {...axis} />
                <YAxis domain={[0.35, 0.65]} tickFormatter={(v: number) => `${Math.round(v * 100)}%`} {...axis} />
                <Tooltip {...tip} formatter={asPct} />
                <ReferenceLine y={BREAK_EVEN} stroke="#fbbf24" strokeDasharray="4 4" />
                <Line dataKey="rate" name="Cover rate" stroke="#38bdf8" dot isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <table className="w-full text-xs mt-2">
            <tbody>
              {([["Model took home", r.bySide.home], ["Model took away", r.bySide.away], ["Model took the favorite", r.bySide.favorite], ["Model took the underdog", r.bySide.underdog]] as const).map(([l, s]) => (
                <tr key={l} className="border-t border-line"><td className="py-1">{l}</td><td className="text-right"><Ats s={s} /></td></tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div>
      <p className="text-xs text-mute">{label}</p>
      <p className="mt-0.5">{value}</p>
      {sub && <p className="text-[11px] text-faint">{sub}</p>}
    </div>
  );
}
