import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { SPORTS, currentSeason, isSportKey, type SportKey } from "@bet207/core";
import { demoSeasons, getMarkets, getSeason } from "../data/source";
import { buildSlate, defaultGroup, groupSlates, type SlateRow } from "../data/slate";
import { Chip, Empty, ErrorBox, PageHeader, Panel, timeAgo } from "../components/ui";
import { favorite, kickoff, price } from "../lib/format";
import { env } from "../lib/env";
import { usePref } from "../lib/prefs";
import { NotFound } from "./NotFound";

type SortKey = "time" | "spread" | "total";
type FavFilter = "all" | "homefav" | "homedog";

export function SportSlate() {
  const { sport = "" } = useParams();
  if (!isSportKey(sport)) return <NotFound />;
  return <Slate key={sport} sport={sport} />;
}

function Slate({ sport }: { sport: SportKey }) {
  const now = useMemo(() => new Date(), []);
  const seasonsQ = useQuery({ queryKey: ["seasons", sport], queryFn: async () => {
    if (env.demo) return sport === "nfl" ? (await demoSeasons()).slice().reverse() : [currentSeason(sport, now)];
    const c = currentSeason(sport, now);
    return [c, c - 1, c - 2];
  } });
  const [season, setSeason] = useState<number | null>(null);
  const activeSeason = season ?? seasonsQ.data?.[0] ?? null;

  const seasonQ = useQuery({ queryKey: ["season", sport, activeSeason], queryFn: () => getSeason(sport, activeSeason!), enabled: activeSeason !== null });
  const groups = useMemo(() => (seasonQ.data ? groupSlates(sport, seasonQ.data.games) : []), [seasonQ.data, sport]);
  const [groupKey, setGroupKey] = useState<string | null>(null);
  const group = groups.find((g) => g.key === groupKey) ?? defaultGroup(groups, now);
  const ids = group?.games.map((g) => g.id) ?? [];
  const marketsQ = useQuery({ queryKey: ["markets", ids], queryFn: () => getMarkets(ids), enabled: ids.length > 0 });

  const [book, setBook] = usePref<string>("book", "consensus");
  const [fav, setFav] = useState<FavFilter>("all");
  const [onlyLines, setOnlyLines] = useState(false);
  const [conf, setConf] = useState("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "time", dir: 1 });

  const rows = useMemo(() => {
    if (!seasonQ.data || !group || !marketsQ.data) return [];
    let r = buildSlate(seasonQ.data, group.games, marketsQ.data, book, now);
    if (fav !== "all") r = r.filter((x) => x.market?.homeMargin != null && (fav === "homefav" ? x.market.homeMargin > 0 : x.market.homeMargin < 0));
    if (onlyLines) r = r.filter((x) => x.market?.homeMargin != null);
    if (conf) r = r.filter((x) => x.home.conference === conf || x.away.conference === conf);
    if (q.trim()) { const s = q.trim().toLowerCase(); r = r.filter((x) => [x.home.abbr, x.home.name, x.away.abbr, x.away.name].some((t) => t.toLowerCase().includes(s))); }
    const val = (x: SlateRow) => sort.key === "time" ? Date.parse(x.game.startTime)
      : sort.key === "spread" ? Math.abs(x.market?.homeMargin ?? -Infinity) : (x.market?.total ?? -Infinity);
    return [...r].sort((a, b) => (val(a) - val(b)) * sort.dir);
  }, [seasonQ.data, group, marketsQ.data, book, fav, onlyLines, conf, q, sort, now]);

  const conferences = useMemo(() => [...new Set([...(seasonQ.data?.teams.values() ?? [])].map((t) => t.conference).filter(Boolean) as string[])].sort(), [seasonQ.data]);
  const books = marketsQ.data?.books ?? [];
  const lastOdds = rows.map((r) => r.market?.updatedAt).filter(Boolean).sort().at(-1) ?? null;
  const err = seasonsQ.error ?? seasonQ.error ?? marketsQ.error;

  const th = (label: string, key?: SortKey, extra = "") => (
    <th scope="col" className={`px-2 py-2 font-medium ${extra}`} aria-sort={key && sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : undefined}>
      {key ? <button className="hover:text-ink" onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : key === "time" ? 1 : -1 }))}>{label}{sort.key === key ? (sort.dir === 1 ? " ▲" : " ▼") : ""}</button> : label}
    </th>
  );

  return (
    <>
      <PageHeader title={SPORTS[sport].name} subtitle="Market lines next to model projections. A disagreement is a question to research, not a pick."
        actions={<span className="text-xs text-mute self-center">Odds updated: {lastOdds ? timeAgo(lastOdds) : "no live odds"}</span>} />
      {err && <ErrorBox error={err} />}
      {seasonQ.data?.note && <p className="text-xs text-warn mb-3">{seasonQ.data.note}</p>}

      <Panel className="mb-4">
        <div className="flex flex-wrap gap-3 items-end text-sm">
          <Field label="Season">
            <select className="input" value={activeSeason ?? ""} onChange={(e) => { setSeason(Number(e.target.value)); setGroupKey(null); }}>
              {(seasonsQ.data ?? []).map((s) => <option key={s} value={s}>{sport === "nba" ? `${s}–${String(s + 1).slice(2)}` : s}</option>)}
            </select>
          </Field>
          <Field label={SPORTS[sport].slate === "week" ? "Week" : "Date"}>
            <select className="input" value={group?.key ?? ""} onChange={(e) => setGroupKey(e.target.value)}>
              {groups.map((g) => <option key={g.key} value={g.key}>{g.label} ({g.games.length})</option>)}
            </select>
          </Field>
          <Field label="Sportsbook">
            <select className="input" value={book} onChange={(e) => setBook(e.target.value)}>
              <option value="consensus">Consensus (median)</option>
              {books.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </Field>
          <Field label="Favorite">
            <select className="input" value={fav} onChange={(e) => setFav(e.target.value as FavFilter)}>
              <option value="all">All games</option><option value="homefav">Home favorites</option><option value="homedog">Home underdogs</option>
            </select>
          </Field>
          {SPORTS[sport].hasConferences && (
            <Field label="Conference">
              <select className="input" value={conf} onChange={(e) => setConf(e.target.value)}>
                <option value="">All</option>{conferences.map((c) => <option key={c}>{c}</option>)}
              </select>
            </Field>
          )}
          <Field label="Team"><input className="input" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} /></Field>
          <label className="flex items-center gap-2 pb-2"><input type="checkbox" checked={onlyLines} onChange={(e) => setOnlyLines(e.target.checked)} /> Only games with a line</label>
        </div>
      </Panel>

      {seasonQ.isLoading || marketsQ.isLoading ? <p className="text-mute" role="status">Loading slate…</p>
        : !group ? <Empty title="No games stored for this season">Run the ingestion job for {SPORTS[sport].name} (see docs/SETUP.md).</Empty>
        : (
          <div className="panel overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">{SPORTS[sport].name} {group.label} slate</caption>
              <thead className="text-xs text-mute text-left border-b border-line bg-panel-2/60 sticky top-0">
                <tr>
                  {th("Matchup")}{th("Time", "time")}{th("Spread", "spread", "text-right")}{th("Total", "total", "text-right")}{th("Moneyline", undefined, "text-right")}
                  {th("Model spread", undefined, "text-right")}{th("Model total", undefined, "text-right")}{th("Spread diff", undefined, "text-right")}{th("Total diff", undefined, "text-right")}{th("P(cover)", undefined, "text-right")}{th("Data")}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => <Row key={r.game.id} r={r} />)}
                {!rows.length && <tr><td colSpan={11} className="px-3 py-6 text-center text-mute">No games match these filters.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      <p className="text-[11px] text-faint mt-2">Spreads show the favorite (sportsbook sign). Model columns fill in once Phase 3 produces projections; until then they say “—”, never a guess.</p>
    </>
  );
}

function Row({ r }: { r: SlateRow }) {
  const m = r.market;
  const final = r.game.homeScore !== null;
  return (
    <tr className="border-t border-line hover:bg-panel-2/50">
      <td className="px-2 py-2">
        <Link to={`/game/${r.game.id}`} className="hover:text-accent">
          <span className="font-medium">{r.away.abbr}</span> <span className="text-faint text-xs">{r.awayRecord}</span>
          <span className="text-faint"> {r.game.neutralSite ? "vs" : "@"} </span>
          <span className="font-medium">{r.home.abbr}</span> <span className="text-faint text-xs">{r.homeRecord}</span>
        </Link>
        {final && <span className="ml-2 num text-xs text-mute">{r.game.awayScore}–{r.game.homeScore} F</span>}
      </td>
      <td className="px-2 py-2 text-mute whitespace-nowrap">{kickoff(r.game.startTime)}</td>
      <td className="px-2 py-2 text-right num whitespace-nowrap">
        {favorite(m?.homeMargin ?? null, r.home.abbr, r.away.abbr)}
        {m?.homeSpreadPrice != null && <span className="text-faint text-xs"> ({price(m.homeMargin! >= 0 ? m.homeSpreadPrice : m.awaySpreadPrice)})</span>}
      </td>
      <td className="px-2 py-2 text-right num">{m?.total ?? "—"}</td>
      <td className="px-2 py-2 text-right num whitespace-nowrap text-xs">{m?.homeMoneyline != null ? `${price(m.awayMoneyline)} / ${price(m.homeMoneyline)}` : "—"}</td>
      <td className="px-2 py-2 text-right num text-faint" title="Model projections arrive with Phase 3">—</td>
      <td className="px-2 py-2 text-right num text-faint" title="Model projections arrive with Phase 3">—</td>
      <td className="px-2 py-2 text-right num text-faint">—</td>
      <td className="px-2 py-2 text-right num text-faint">—</td>
      <td className="px-2 py-2 text-right num text-faint">—</td>
      <td className="px-2 py-2"><div className="flex flex-wrap gap-1">{r.flags.map((f) => <Chip key={f.key} tone={f.tone}>{f.label}</Chip>)}</div></td>
    </tr>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="flex flex-col gap-1 text-xs text-mute min-w-[9rem]">{label}{children}</label>;
}
