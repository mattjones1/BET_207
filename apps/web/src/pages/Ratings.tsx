import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { SPORTS, SPORT_KEYS, currentSeason, type SportKey } from "@bet207/core";
import { getSeason } from "../data/source";
import { getModel } from "../data/model";
import { Empty, ErrorBox, PageHeader, Panel, timeAgo } from "../components/ui";
import { signed } from "../lib/format";
import { usePref } from "../lib/prefs";

type Col = "mov" | "off" | "def" | "elo" | "games";

export function Ratings() {
  const [sport, setSport] = usePref<SportKey>("ratings.sport", "nfl");
  const now = useMemo(() => new Date(), []);
  const season = currentSeason(sport, now);
  const seasonQ = useQuery({ queryKey: ["season", sport, season], queryFn: () => getSeason(sport, season) });
  const modelQ = useQuery({ queryKey: ["model", sport, season], queryFn: () => getModel(sport, season) });
  const [sort, setSort] = useState<{ col: Col; dir: 1 | -1 }>({ col: "mov", dir: -1 });
  const [conf, setConf] = useState("");

  const rows = useMemo(() => {
    const m = modelQ.data, teams = seasonQ.data?.teams;
    if (!m || !teams) return [];
    let r = [...m.ratings.values()].map((x) => ({ ...x, team: teams.get(x.teamId) }));
    if (conf) r = r.filter((x) => x.team?.conference === conf);
    const v = (x: (typeof r)[number]) => sort.col === "mov" ? x.mov : sort.col === "off" ? x.off : sort.col === "def" ? -x.def : sort.col === "elo" ? (x.elo ?? -1e9) : x.gamesUsed;
    return r.sort((a, b) => (v(a) - v(b)) * sort.dir);
  }, [modelQ.data, seasonQ.data, sort, conf]);
  const conferences = useMemo(() => [...new Set([...(seasonQ.data?.teams.values() ?? [])].map((t) => t.conference).filter(Boolean) as string[])].sort(), [seasonQ.data]);
  const m = modelQ.data;

  const th = (label: string, col: Col, hint: string) => (
    <th scope="col" className="px-2 py-2 text-right font-medium" title={hint} aria-sort={sort.col === col ? (sort.dir === 1 ? "ascending" : "descending") : undefined}>
      <button className="hover:text-ink" onClick={() => setSort((s) => ({ col, dir: s.col === col ? (s.dir === 1 ? -1 : 1) : -1 }))}>{label}{sort.col === col ? (sort.dir === 1 ? " ▲" : " ▼") : ""}</button>
    </th>
  );

  return (
    <>
      <PageHeader title="Power Ratings" subtitle="Points better than an average team on a neutral field, from opponent-adjusted scoring margins. Elo is an independent second opinion." />
      <div className="flex flex-wrap gap-2 mb-4" role="tablist" aria-label="Sport">
        {SPORT_KEYS.map((k) => (
          <button key={k} role="tab" aria-selected={sport === k} className={`btn ${sport === k ? "border-accent text-ink" : "text-mute"}`} onClick={() => { setSport(k); setConf(""); }}>{SPORTS[k].name}</button>
        ))}
        {SPORTS[sport].hasConferences && (
          <select className="input w-auto ml-auto" aria-label="Conference" value={conf} onChange={(e) => setConf(e.target.value)}>
            <option value="">All conferences</option>{conferences.map((c) => <option key={c}>{c}</option>)}
          </select>
        )}
      </div>
      {(modelQ.error || seasonQ.error) && <ErrorBox error={modelQ.error ?? seasonQ.error} />}
      {modelQ.isLoading ? <p className="text-mute" role="status">Loading ratings…</p> : !m ? (
        <Empty title={`No ${SPORTS[sport].name} model run yet`}>Ratings appear after the data is ingested and <code className="num">rebuild-ratings</code> runs.</Empty>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
          <div className="panel overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">{SPORTS[sport].name} power ratings</caption>
              <thead className="text-xs text-mute text-left border-b border-line bg-panel-2/60">
                <tr>
                  <th scope="col" className="px-2 py-2 font-medium w-10">#</th>
                  <th scope="col" className="px-2 py-2 font-medium">Team</th>
                  {th("Rating", "mov", "Margin-of-victory rating, points vs. an average team on a neutral field")}
                  <th scope="col" className="px-2 py-2 text-right font-medium" title="Approximate ± one standard deviation">±</th>
                  {th("Offense", "off", "Points scored per game above league average (opponent-adjusted)")}
                  {th("Defense", "def", "Points allowed per game vs. league average; negative is better")}
                  {th("Elo", "elo", "Independent Elo rating (1500 = average)")}
                  {th("Games", "games", "Games this season used in the fit")}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.teamId} className="border-t border-line">
                    <td className="px-2 py-1.5 text-faint num">{i + 1}</td>
                    <td className="px-2 py-1.5"><span className="font-medium">{r.team?.abbr ?? "?"}</span> <span className="text-mute text-xs">{r.team?.name}</span></td>
                    <td className="px-2 py-1.5 text-right num">{signed(r.mov)}</td>
                    <td className="px-2 py-1.5 text-right num text-faint">{r.uncertainty.toFixed(1)}</td>
                    <td className="px-2 py-1.5 text-right num">{signed(r.off)}</td>
                    <td className="px-2 py-1.5 text-right num">{signed(r.def)}</td>
                    <td className="px-2 py-1.5 text-right num">{r.elo?.toFixed(0) ?? "—"}</td>
                    <td className="px-2 py-1.5 text-right num">{r.gamesUsed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Panel title="This run">
            <dl className="grid grid-cols-[1fr_auto] gap-y-1.5 text-sm">
              <dt className="text-mute">Config</dt><dd className="text-right">{m.configLabel}</dd>
              <dt className="text-mute">Computed</dt><dd className="text-right">{m.source === "demo" ? "in your browser" : timeAgo(m.finishedAt)}</dd>
              <dt className="text-mute">Season</dt><dd className="text-right num">{m.summary.season ?? "—"}</dd>
              <dt className="text-mute">Fitted home edge</dt><dd className="text-right num">{m.summary.hfa?.toFixed(2) ?? "—"} pts</dd>
              <dt className="text-mute">Rest term (full edge)</dt><dd className="text-right num">{m.summary.restCoef?.toFixed(2) ?? "—"} pts</dd>
              <dt className="text-mute">Scoring baseline</dt><dd className="text-right num">{m.summary.mu?.toFixed(1) ?? "—"} per team</dd>
              <dt className="text-mute">Fit residual SD</dt><dd className="text-right num">{m.summary.residualSd?.toFixed(1) ?? "—"}</dd>
              <dt className="text-mute">Params hash</dt><dd className="text-right num text-xs">{m.paramsHash}</dd>
            </dl>
            <p className="text-xs text-faint mt-3">Ratings are estimates with uncertainty (±). Early in a season they lean on last season's carried-over rating.</p>
          </Panel>
        </div>
      )}
    </>
  );
}
