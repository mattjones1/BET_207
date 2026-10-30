import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  EDGE_BUCKETS, SPORTS, edgeBucket, expectedValue, formatFavorite, latestByBook, type SportKey,
} from "@bet207/core";
import { getMarkets, getSeason } from "../data/source";
import { getModel } from "../data/model";
import { listBacktests } from "../data/backtests";
import { buildSlate } from "../data/slate";
import { EMPTY_NOTE, getNote, locateGame, saveNote, savedGameIds, setSaved, type Note } from "../data/research";
import { headToHead, lineMovement, recentForm, situations, splits, strengthOfSchedule } from "../data/context";
import { Chip, Empty, ErrorBox, PageHeader, Panel, timeAgo } from "../components/ui";
import { kickoff, pct, price, signed } from "../lib/format";
import { usePref } from "../lib/prefs";

export function GamePage() {
  const { id = "" } = useParams();
  const loc = useQuery({ queryKey: ["locate", id], queryFn: () => locateGame(id) });
  if (loc.error) return <ErrorBox error={loc.error} />;
  if (loc.isLoading) return <p className="text-mute" role="status">Loading game…</p>;
  if (!loc.data) return <Empty title="Game not found"><Link className="text-accent" to="/">Back to the dashboard</Link></Empty>;
  return <Research id={id} sport={loc.data.sport} season={loc.data.season} />;
}

function Research({ id, sport, season }: { id: string; sport: SportKey; season: number }) {
  const now = useMemo(() => new Date(), []);
  const [book, setBook] = usePref<string>("book", "consensus");
  const seasonQ = useQuery({ queryKey: ["season", sport, season], queryFn: () => getSeason(sport, season) });
  const prevQ = useQuery({ queryKey: ["season", sport, season - 1], queryFn: () => getSeason(sport, season - 1) });
  const prev2Q = useQuery({ queryKey: ["season", sport, season - 2], queryFn: () => getSeason(sport, season - 2) });
  const marketsQ = useQuery({ queryKey: ["markets", [id]], queryFn: () => getMarkets([id]) });
  const modelQ = useQuery({ queryKey: ["model", sport, season], queryFn: () => getModel(sport, season) });
  const btQ = useQuery({ queryKey: ["backtests", sport], queryFn: () => listBacktests(sport) });

  const game = seasonQ.data?.games.find((g) => g.id === id);
  const row = useMemo(() => (seasonQ.data && game && marketsQ.data ? buildSlate(seasonQ.data, [game], marketsQ.data, book, now, modelQ.data ?? null)[0] : null),
    [seasonQ.data, game, marketsQ.data, book, now, modelQ.data]);
  const err = seasonQ.error ?? marketsQ.error ?? modelQ.error;
  if (err) return <ErrorBox error={err} />;
  if (!row || !game || !seasonQ.data) return <p className="text-mute" role="status">Loading research…</p>;

  const teams = seasonQ.data.teams;
  const H = row.home.abbr, A = row.away.abbr;
  const allGames = [...(prev2Q.data?.games ?? []), ...(prevQ.data?.games ?? []), ...seasonQ.data.games];
  const ratings = modelQ.data?.ratings ?? new Map();
  const bt = btQ.data?.find((b) => !b.owner) ?? btQ.data?.[0];
  const bucket = row.edge ? bt?.summary.buckets.find((b) => b.key === edgeBucket(row.edge!.points)) : undefined;
  const m = row.market, p = row.model;
  const favoredTeam = row.edge?.favors === "home" ? H : row.edge?.favors === "away" ? A : null;
  const evPrice = row.cover ? (row.cover.side === "home" ? m?.homeSpreadPrice : m?.awaySpreadPrice) : null;
  const ev = row.cover && evPrice != null ? expectedValue(row.cover.p, evPrice, row.cover.pPush) : null;

  return (
    <>
      <PageHeader
        title={`${row.away.name} ${game.neutralSite ? "vs" : "at"} ${row.home.name}`}
        subtitle={<>{SPORTS[sport].name} · {kickoff(game.startTime)}{game.venue ? ` · ${game.venue}` : ""}{game.week ? ` · Week ${game.week}` : ""}</>}
        actions={<SaveButton gameId={id} />}
      />
      <div className="flex flex-wrap gap-1 mb-4">{row.flags.map((f) => <Chip key={f.key} tone={f.tone}>{f.label}</Chip>)}</div>

      {/* A. Matchup summary */}
      <Panel title="Matchup summary" className="mb-4">
        <div className="grid gap-4 md:grid-cols-4 text-sm">
          <Block label="Records (entering)">{A} {row.awayRecord} · {H} {row.homeRecord}{game.homeScore !== null && <p className="num mt-1">Final: {A} {game.awayScore} – {H} {game.homeScore}</p>}</Block>
          <Block label={`Market (${m?.book === "consensus" ? `consensus of ${m.books}` : m?.book || "—"})`}>
            <p className="num">{m ? formatFavorite(m.homeMargin, H, A) : "No line"} · Total {m?.total ?? "—"}</p>
            {m?.homeMoneyline != null && <p className="num text-mute text-xs">ML {A} {price(m.awayMoneyline)} / {H} {price(m.homeMoneyline)}</p>}
            <p className="text-faint text-xs">{m?.source === "snapshot" ? `Updated ${timeAgo(m.updatedAt)}` : m ? (game.status === "final" ? "Closing line (retrospective)" : "Imported pre-game line, time unknown") : ""}</p>
          </Block>
          <Block label="Model">
            {p ? <><p className="num">{formatFavorite(p.homeMargin, H, A)} · Total {p.total.toFixed(1)}</p><p className="text-mute text-xs num">Elo: {p.eloMargin !== null ? formatFavorite(p.eloMargin, H, A) : "—"}</p></>
              : <p className="text-mute">{game.status === "final" ? "Past game: see Backtesting" : "No projection (not in the latest run)"}</p>}
          </Block>
          <Block label="Disagreement">
            {row.edge ? (row.edge.favors ? <p className="num">Model favors <strong>{favoredTeam}</strong> by {Math.abs(row.edge.points).toFixed(1)} vs the line</p> : <p>Model agrees with the line</p>) : <p className="text-mute">—</p>}
            {row.totalEdge?.lean && <p className="num text-xs text-mute">Total: model {row.totalEdge.lean} by {Math.abs(row.totalEdge.points).toFixed(1)} (experimental)</p>}
          </Block>
        </div>
        <div className="mt-4 border-t border-line pt-3 grid gap-3 md:grid-cols-3 text-sm">
          <Block label="How this model has done at this disagreement size">
            {!row.edge ? <p className="text-mute">—</p> : !bucket ? <p className="text-mute">No stored backtest yet. <Link to="/backtests" className="text-accent">Run one</Link>.</p> : (
              <p className="num">{EDGE_BUCKETS.find((b) => b.key === bucket.key)!.label} pts: {bucket.stats.wins}-{bucket.stats.losses}{bucket.stats.pushes ? `-${bucket.stats.pushes}` : ""}, {pct(bucket.stats.coverRate)}
                {bucket.stats.ci95 && <span className="text-faint"> [{pct(bucket.stats.ci95[0])}, {pct(bucket.stats.ci95[1])}]</span>}
                {!bucket.stats.sufficient && <Chip tone="warn">insufficient sample</Chip>}
                <span className="block text-xs text-faint font-sans">{bt?.lineSource}; {bt?.summary.seasons[0]}–{bt?.summary.seasons.at(-1)}</span></p>
            )}
          </Block>
          <Block label="Estimated cover probability">
            {row.cover ? <p className="num">{row.cover.side === "home" ? H : A}: {pct(row.cover.p)}{row.cover.pPush > 0.005 && ` (push ${pct(row.cover.pPush)})`}
              {row.cover.breakEven !== null && <span className="text-faint"> · break-even {pct(row.cover.breakEven)}</span>}</p>
              : <p className="text-mute">Not shown: {modelQ.data?.calibration ? "no probability method beat a coin flip in backtesting" : "no calibration yet (run a backtest)"}.</p>}
          </Block>
          <Block label="Expected value per unit">
            {ev !== null ? <p className="num">{signed(ev * 100, 1)}% at {price(evPrice)} <span className="text-faint font-sans text-xs">(model probability × this price; an estimate, not a guarantee)</span></p>
              : <p className="text-mute">Not shown: needs a calibrated probability and a real price from a single book.</p>}
          </Block>
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* B. Team comparison */}
        <Panel title="Team comparison">
          <table className="w-full text-sm">
            <thead className="text-xs text-mute"><tr><th className="text-left py-1 font-medium" /><th className="text-right font-medium">{A}</th><th className="text-right font-medium">{H}</th></tr></thead>
            <tbody>
              {([
                ["Power rating", (t: string) => signed(ratings.get(t)?.mov)],
                ["± uncertainty", (t: string) => ratings.get(t)?.uncertainty?.toFixed(1) ?? "—"],
                ["Elo", (t: string) => ratings.get(t)?.elo?.toFixed(0) ?? "—"],
                ["Offense (pts vs avg)", (t: string) => signed(ratings.get(t)?.off)],
                ["Defense (allowed vs avg)", (t: string) => signed(ratings.get(t)?.def)],
                ["Points for / against", (t: string) => { const s = splits(t, seasonQ.data!.games, game.startTime).all; return s.avgFor === null ? "—" : `${s.avgFor.toFixed(1)} / ${s.avgAgainst!.toFixed(1)}`; }],
                ["Home margin (avg)", (t: string) => { const s = splits(t, seasonQ.data!.games, game.startTime).home; return s.games ? `${signed(s.avgMargin)} (${s.games})` : "—"; }],
                ["Road margin (avg)", (t: string) => { const s = splits(t, seasonQ.data!.games, game.startTime).away; return s.games ? `${signed(s.avgMargin)} (${s.games})` : "—"; }],
                ["Schedule strength (avg opp rating)", (t: string) => signed(strengthOfSchedule(t, seasonQ.data!.games, game.startTime, ratings))],
                ["Recent schedule (last 3 opp)", (t: string) => signed(strengthOfSchedule(t, seasonQ.data!.games, game.startTime, ratings, 3))],
              ] as const).map(([label, f]) => (
                <tr key={label} className="border-t border-line"><td className="py-1.5 text-mute">{label}</td><td className="text-right num">{f(game.awayTeamId)}</td><td className="text-right num">{f(game.homeTeamId)}</td></tr>
              ))}
            </tbody>
          </table>
          <p className="text-[11px] text-faint mt-2">Ratings are from the latest model run (current season). Splits and schedule use this season's games before kickoff.</p>
          <div className="grid grid-cols-2 gap-4 mt-3">
            {[game.awayTeamId, game.homeTeamId].map((t) => (
              <div key={t}>
                <p className="panel-h mb-1">{teams.get(t)?.abbr} recent results</p>
                <ul className="text-xs space-y-0.5 num">
                  {recentForm(t, allGames, game.startTime).map((r) => (
                    <li key={r.gameId}><Link to={`/game/${r.gameId}`} className="hover:text-accent">{r.result} {r.for}-{r.against} {r.home ? "vs" : "@"} {teams.get(r.opponentId)?.abbr ?? "?"}</Link>
                      <span className="text-faint"> {new Date(r.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span></li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Panel>

        {/* C. Situational */}
        <Panel title="Situational">
          <ul className="space-y-1.5 text-sm">
            <li className="num">Rest: {A} {game.awayRest ?? "unknown"} days · {H} {game.homeRest ?? "unknown"} days</li>
            {situations(game, sport, H, A).map((s) => <li key={s.key}><Chip tone="accent">{s.label}</Chip> <span className="text-mute text-xs">{s.detail}</span></li>)}
          </ul>
          <p className="panel-h mt-4 mb-1">Head-to-head (last meetings in stored seasons)</p>
          {(() => {
            const h2h = headToHead(game.homeTeamId, game.awayTeamId, allGames, game.startTime);
            return h2h.length ? (
              <ul className="text-xs num space-y-0.5">{h2h.map((x) => (
                <li key={x.id}>{new Date(x.startTime).getFullYear()}: {teams.get(x.awayTeamId)?.abbr} {x.awayScore} @ {teams.get(x.homeTeamId)?.abbr} {x.homeScore}</li>))}</ul>
            ) : <p className="text-xs text-mute">No meetings in the stored seasons.</p>;
          })()}
          <p className="text-[11px] text-faint mt-2">Head-to-head is context, not predictive evidence; rosters change and samples are tiny. Injuries and travel aren't modeled yet; record them in your notes.</p>
        </Panel>

        {/* D. Market */}
        <MarketPanel snaps={marketsQ.data?.snaps.get(id) ?? []} lines={marketsQ.data?.lines.get(id) ?? []} home={H} away={A} book={book} setBook={setBook} books={marketsQ.data?.books ?? []} />

        {/* E. Model explanation */}
        <Panel title="Model explanation">
          {!p?.explanation ? <p className="text-sm text-mute">No projection for this game in the latest run.</p> : (
            <>
              <table className="w-full text-sm">
                <tbody>
                  <tr><td className="py-1 text-mute">{H} rating</td><td className="text-right num">{signed(p.explanation.homeRating, 2)}</td></tr>
                  <tr><td className="py-1 text-mute">{A} rating</td><td className="text-right num">{signed(p.explanation.awayRating, 2)}</td></tr>
                  {p.explanation.parts.map((x) => (
                    <tr key={x.key} className="border-t border-line"><td className="py-1.5">{x.label}</td><td className="text-right num">{signed(x.points, 2)}</td></tr>
                  ))}
                  <tr className="border-t border-line font-medium"><td className="py-1.5">Projected {H} margin</td><td className="text-right num">{signed(p.homeMargin, 2)}</td></tr>
                  {m?.homeMargin != null && <tr><td className="py-1 text-mute">Market {H} margin</td><td className="text-right num">{signed(m.homeMargin, 1)}</td></tr>}
                </tbody>
              </table>
              <p className="text-sm mt-2">
                {row.edge?.favors ? <>The model makes it <strong className="num">{formatFavorite(p.homeMargin, H, A)}</strong> against a market of <strong className="num">{formatFavorite(m!.homeMargin, H, A)}</strong>, so it prefers <strong>{favoredTeam}</strong> by {Math.abs(row.edge.points).toFixed(1)} points. The largest contributor is the {[...p.explanation.parts].sort((a, b) => Math.abs(b.points) - Math.abs(a.points))[0]!.label.toLowerCase()}.</>
                  : "No market line to compare against."}
              </p>
              <p className="panel-h mt-3 mb-1">Total (experimental)</p>
              <table className="w-full text-xs"><tbody>{p.explanation.totalParts.map((x) => (
                <tr key={x.key}><td className="py-0.5 text-mute">{x.label.replace("Home", H).replace("Away", A)}</td><td className="text-right num">{x.points.toFixed(1)}</td></tr>))}
                <tr className="border-t border-line"><td className="py-1">Projected total</td><td className="text-right num">{p.total.toFixed(1)}</td></tr></tbody></table>
              {p.statusReason && <p className="text-xs text-warn mt-2">{p.statusReason}</p>}
              <p className="text-[11px] text-faint mt-2">Only modeled factors are listed. Injuries, weather, and matchups aren't in this model.</p>
            </>
          )}
        </Panel>
      </div>

      {/* F. Notes */}
      <NotesPanel gameId={id} />
    </>
  );
}

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><p className="text-xs text-mute mb-1">{label}</p><div>{children}</div></div>;
}

function MarketPanel({ snaps, lines, home, away, book, setBook, books }: {
  snaps: import("@bet207/core").OddsSnapshot[]; lines: import("@bet207/core").HistoricalLine[];
  home: string; away: string; book: string; setBook: (b: string) => void; books: string[];
}) {
  const latest = latestByBook(snaps);
  const bookKeys = [...new Set(latest.map((s) => s.sportsbook))].sort();
  const first = useMemo(() => {
    const sp = snaps.filter((s) => s.market === "spread").sort((a, b) => (a.sourceUpdatedAt ?? "").localeCompare(b.sourceUpdatedAt ?? ""))[0];
    return sp ?? null;
  }, [snaps]);
  const moves = lineMovement(snaps, book);
  const opening = lines.find((l) => l.lineType === "opening");
  return (
    <Panel title="Market" right={
      <select className="input py-1 w-auto text-xs" aria-label="Sportsbook" value={book} onChange={(e) => setBook(e.target.value)}>
        <option value="consensus">Consensus</option>{books.map((b) => <option key={b}>{b}</option>)}
      </select>}>
      {!snaps.length && !lines.length ? <p className="text-sm text-mute">No market data stored for this game.</p> : (
        <>
          {moves.length > 1 ? (
            <div className="h-44">
              <ResponsiveContainer>
                <LineChart data={moves.map((x) => ({ ...x, label: new Date(x.t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric" }) }))} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid stroke="#232d3f" strokeDasharray="3 3" />
                  <XAxis dataKey="label" stroke="#64738a" fontSize={10} />
                  <YAxis yAxisId="s" stroke="#64738a" fontSize={10} domain={["auto", "auto"]} />
                  <YAxis yAxisId="t" orientation="right" stroke="#64738a" fontSize={10} domain={["auto", "auto"]} />
                  <Tooltip contentStyle={{ background: "#111723", border: "1px solid #232d3f", fontSize: 12 }} />
                  <Line yAxisId="s" dataKey="homeSpread" name={`${home} spread`} stroke="#38bdf8" dot isAnimationActive={false} connectNulls />
                  <Line yAxisId="t" dataKey="total" name="Total" stroke="#a78bfa" dot={false} isAnimationActive={false} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : <p className="text-xs text-mute mb-2">{snaps.length ? "Only one captured update so far; movement appears after the next odds pull." : "No captured sportsbook snapshots (live odds need the Odds API key)."}</p>}
          {latest.length > 0 && (
            <table className="w-full text-xs mt-2">
              <thead className="text-mute text-left"><tr><th className="py-1">Book</th><th className="text-right">{home} spread</th><th className="text-right">Total</th><th className="text-right">ML {away} / {home}</th><th className="text-right">Updated</th></tr></thead>
              <tbody>{bookKeys.map((b) => {
                const sp = latest.find((s) => s.sportsbook === b && s.market === "spread"), to = latest.find((s) => s.sportsbook === b && s.market === "total"), ml = latest.find((s) => s.sportsbook === b && s.market === "h2h");
                return (
                  <tr key={b} className="border-t border-line">
                    <td className="py-1">{b}</td>
                    <td className="text-right num">{sp?.homePoint != null ? `${signed(sp.homePoint)} (${price(sp.homePrice)})` : "—"}</td>
                    <td className="text-right num">{to?.totalPoint ?? "—"}</td>
                    <td className="text-right num">{ml ? `${price(ml.awayPrice)} / ${price(ml.homePrice)}` : "—"}</td>
                    <td className="text-right text-faint">{timeAgo(sp?.sourceUpdatedAt ?? to?.sourceUpdatedAt)}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          )}
          <ul className="text-xs text-mute mt-3 space-y-0.5">
            {first && <li>Earliest line we captured: {first.sportsbook} {home} {signed(first.homePoint)} on {new Date(first.sourceUpdatedAt ?? first.retrievedAt).toLocaleString()} (our first capture, not necessarily the opening line).</li>}
            {opening && <li>Provider-reported opening ({opening.sportsbook || opening.provider}): {opening.marketHomeMargin !== null ? formatFavorite(opening.marketHomeMargin, home, away) : "—"}, total {opening.total ?? "—"}.</li>}
            {lines.filter((l) => l.lineType !== "opening").map((l, i) => (
              <li key={i}>{l.lineType === "closing" ? "Imported line" : `Provider line (${l.sportsbook})`} from {l.provider}: {formatFavorite(l.marketHomeMargin, home, away)}, total {l.total ?? "—"}.</li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}

function SaveButton({ gameId }: { gameId: string }) {
  const qc = useQueryClient();
  const saved = useQuery({ queryKey: ["saved"], queryFn: savedGameIds });
  const on = saved.data?.includes(gameId) ?? false;
  const m = useMutation({ mutationFn: () => setSaved(gameId, !on), onSuccess: () => void qc.invalidateQueries({ queryKey: ["saved"] }) });
  return <button className={`btn ${on ? "border-accent text-accent" : ""}`} aria-pressed={on} onClick={() => m.mutate()} disabled={m.isPending}>{on ? "★ Saved" : "☆ Save game"}</button>;
}

function NotesPanel({ gameId }: { gameId: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["note", gameId], queryFn: () => getNote(gameId) });
  const [n, setN] = useState<Note>(EMPTY_NOTE);
  useEffect(() => { if (q.data) setN(q.data); }, [q.data]);
  const save = useMutation({ mutationFn: () => saveNote(gameId, n), onSuccess: (d) => qc.setQueryData(["note", gameId], d) });
  const dirty = JSON.stringify({ ...n, updatedAt: null }) !== JSON.stringify({ ...(q.data ?? EMPTY_NOTE), updatedAt: null });
  const field = (k: keyof Note, label: string, rows = 2) => (
    <label className="block text-sm"><span className="text-mute text-xs">{label}</span>
      <textarea className="input mt-1" rows={rows} value={n[k] ?? ""} onChange={(e) => setN({ ...n, [k]: e.target.value })} /></label>
  );
  return (
    <Panel title="My research notes (private)" className="mt-4" right={<span className="text-xs text-faint">{q.data?.updatedAt ? `Saved ${timeAgo(q.data.updatedAt)}` : "Not saved yet"}</span>}>
      {q.error && <ErrorBox error={q.error} />}
      <div className="grid gap-3 md:grid-cols-2">
        {field("lean", "Initial lean", 1)}
        <label className="block text-sm"><span className="text-mute text-xs">Would I consider a bet?</span>
          <select className="input mt-1" value={n.wouldConsider} onChange={(e) => setN({ ...n, wouldConsider: e.target.value as Note["wouldConsider"] })}>
            <option value="">Undecided</option><option value="yes">Yes, at the right price</option><option value="maybe">Maybe</option><option value="no">No</option>
          </select></label>
        {field("observations", "Matchup observations", 3)}
        {field("injuries", "Injury considerations", 3)}
        {field("disagreement", "Why I disagree with the model", 3)}
        {field("passReasons", "Reasons to pass", 3)}
      </div>
      <div className="flex items-center gap-3 mt-3">
        <button className="btn btn-primary" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Save notes"}</button>
        {save.error && <span className="text-neg text-sm" role="alert">{(save.error as Error).message}</span>}
        <span className="text-xs text-faint">Visible only to your account (in demo mode, stored in this browser only).</span>
      </div>
    </Panel>
  );
}
