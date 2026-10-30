import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { SPORTS, SPORT_KEYS, currentSeason, formatFavorite, type SportKey } from "@bet207/core";
import { getDataStatus, getMarkets, getSeason } from "../data/source";
import { getModel } from "../data/model";
import { buildSlate, type SlateRow } from "../data/slate";
import { savedGameIds } from "../data/research";
import { Chip, Empty, ErrorBox, PageHeader, Panel, timeAgo } from "../components/ui";
import { kickoff, pct } from "../lib/format";
import { usePref } from "../lib/prefs";

interface SportUpcoming { sport: SportKey; rows: SlateRow[]; modelAt: string | null; modelSource: string | null; calibrated: boolean | null; lastOdds: string | null; all: SlateRow[] }

async function upcoming(sport: SportKey, book: string, now: Date, saved: string[]): Promise<SportUpcoming> {
  const season = currentSeason(sport, now);
  const [data, model] = await Promise.all([getSeason(sport, season), getModel(sport, season)]);
  const horizon = now.getTime() + 7 * 86_400_000;
  const soon = data.games.filter((g) => g.status !== "final" && Date.parse(g.startTime) >= now.getTime() - 3 * 3_600_000 && Date.parse(g.startTime) <= horizon);
  const savedGames = data.games.filter((g) => saved.includes(g.id));
  const pick = [...new Map([...soon, ...savedGames].map((g) => [g.id, g])).values()];
  const markets = await getMarkets(pick.map((g) => g.id));
  const all = buildSlate(data, pick, markets, book, now, model);
  return {
    sport, all,
    rows: all.filter((r) => soon.some((g) => g.id === r.game.id)),
    modelAt: model?.finishedAt ?? null, modelSource: model?.source ?? null,
    calibrated: model ? !!model.calibration?.passes : null,
    lastOdds: all.map((r) => r.market?.updatedAt).filter(Boolean).sort().at(-1) ?? null,
  };
}

export function Dashboard() {
  const now = useMemo(() => new Date(), []);
  const [book] = usePref<string>("book", "consensus");
  const status = useQuery({ queryKey: ["data-status"], queryFn: getDataStatus });
  const saved = useQuery({ queryKey: ["saved"], queryFn: savedGameIds });
  const sports = useQuery({
    queryKey: ["dashboard", book, saved.data],
    queryFn: () => Promise.all(SPORT_KEYS.map((s) => upcoming(s, book, now, saved.data ?? []))),
    enabled: saved.data !== undefined,
  });
  const biggest = (sports.data ?? []).flatMap((s) => s.rows.map((r) => ({ ...r, sport: s.sport }))).filter((r) => r.edge?.favors)
    .sort((a, b) => Math.abs(b.edge!.points) - Math.abs(a.edge!.points)).slice(0, 12);
  const savedRows = (sports.data ?? []).flatMap((s) => s.all.filter((r) => saved.data?.includes(r.game.id)).map((r) => ({ ...r, sport: s.sport })));

  return (
    <>
      <PageHeader title="Dashboard" subtitle="Market vs. model for the next 7 days. A disagreement is a question to research, not a pick." />
      {(status.error || sports.error) && <ErrorBox error={status.error ?? sports.error} />}

      <div className="grid gap-4 lg:grid-cols-3">
        {SPORT_KEYS.map((k) => {
          const s = sports.data?.find((x) => x.sport === k);
          return (
            <Panel key={k} title={SPORTS[k].name} right={<Link className="text-xs text-accent" to={`/${k}`}>Open slate →</Link>}>
              <div className="flex items-end gap-6">
                <div><p className="num text-2xl">{s?.rows.length ?? "—"}</p><p className="text-mute text-xs">games in 7 days</p></div>
                <div><p className="num text-2xl">{status.data?.gameCounts[k] ?? 0}</p><p className="text-mute text-xs">games stored</p></div>
              </div>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs mt-3">
                <dt className="text-mute">Odds</dt><dd>{s?.lastOdds ? `updated ${timeAgo(s.lastOdds)}` : <span className="text-faint">no live snapshots</span>}</dd>
                <dt className="text-mute">Model</dt><dd>{!s?.modelSource ? <span className="text-faint">no run yet</span> : s.modelSource === "demo" ? "computed in browser (demo)" : `run ${timeAgo(s.modelAt)}`}</dd>
                <dt className="text-mute">P(cover)</dt><dd>{s?.calibrated === null || s?.calibrated === undefined ? "—" : s.calibrated ? <Chip tone="pos">calibrated</Chip> : <Chip>hidden: not calibrated</Chip>}</dd>
              </dl>
            </Panel>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_22rem] mt-4">
        <Panel title="Largest model–market disagreements (next 7 days)">
          {sports.isLoading ? <p className="text-mute text-sm" role="status">Loading…</p> : !biggest.length ? (
            <Empty title="No disagreements to show">Needs upcoming games with both a market line and a model projection.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-mute text-left"><tr><th className="py-1">Game</th><th>Time</th><th className="text-right">Market</th><th className="text-right">Model</th><th className="text-right">Model favors</th><th className="text-right">P(cover)</th><th>Data</th></tr></thead>
                <tbody>{biggest.map((r) => (
                  <tr key={r.game.id} className="border-t border-line">
                    <td className="py-1.5"><Link to={`/game/${r.game.id}`} className="hover:text-accent"><span className="text-faint text-xs">{SPORTS[r.sport].short}</span> {r.away.abbr} @ {r.home.abbr}</Link></td>
                    <td className="text-mute whitespace-nowrap">{kickoff(r.game.startTime)}</td>
                    <td className="text-right num">{formatFavorite(r.market!.homeMargin, r.home.abbr, r.away.abbr)}</td>
                    <td className="text-right num">{formatFavorite(r.model!.homeMargin, r.home.abbr, r.away.abbr)}</td>
                    <td className="text-right num">{r.edge!.favors === "home" ? r.home.abbr : r.away.abbr} +{Math.abs(r.edge!.points).toFixed(1)}</td>
                    <td className="text-right num">{r.cover ? pct(r.cover.p) : <span className="text-faint">—</span>}</td>
                    <td><div className="flex flex-wrap gap-1">{r.flags.filter((f) => f.tone !== "neutral").map((f) => <Chip key={f.key} tone={f.tone}>{f.label}</Chip>)}</div></td>
                  </tr>))}</tbody>
              </table>
              <p className="text-[11px] text-faint mt-2">Sorted by size of disagreement. Check Backtesting for how this model has done at each size before treating any of these as an opportunity.</p>
            </div>
          )}
        </Panel>
        <div className="space-y-4">
          <Panel title="Saved games">
            {!savedRows.length ? <p className="text-sm text-mute">Save games from their research page to track them here.</p> : (
              <ul className="space-y-1.5 text-sm">{savedRows.map((r) => (
                <li key={r.game.id}><Link className="hover:text-accent" to={`/game/${r.game.id}`}><span className="text-faint text-xs">{SPORTS[r.sport].short}</span> {r.away.abbr} @ {r.home.abbr}</Link>
                  <span className="text-xs text-mute"> · {kickoff(r.game.startTime)}</span>{r.game.homeScore !== null && <span className="text-xs num"> · F {r.game.awayScore}–{r.game.homeScore}</span>}</li>))}</ul>
            )}
          </Panel>
          <Panel title="Pipeline">
            {!status.data?.runs.length ? <p className="text-sm text-mute">{status.data?.mode === "demo" ? "Demo mode: no pipeline." : "No runs recorded yet."}</p> : (
              <ul className="space-y-1 text-xs">{status.data.runs.slice(0, 8).map((r, i) => (
                <li key={i} className="flex gap-2"><Chip tone={r.status === "success" ? "pos" : r.status === "failed" ? "neg" : "neutral"} title={r.error ?? undefined}>{r.status}</Chip>
                  <span>{r.job}{r.sport ? ` (${r.sport})` : ""}</span><span className="ml-auto text-faint">{timeAgo(r.finishedAt ?? r.startedAt)}</span></li>))}</ul>
            )}
          </Panel>
          <Panel title="API quota">
            {!status.data?.quota.length ? <p className="text-sm text-mute">No readings yet.</p> : (
              <ul className="space-y-1 text-xs">{status.data.quota.map((q) => (
                <li key={q.provider} className="flex gap-2"><span>{q.provider}</span><span className="num ml-auto">{q.remaining ?? "—"} left</span><span className="text-faint">{timeAgo(q.checkedAt)}</span></li>))}</ul>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
