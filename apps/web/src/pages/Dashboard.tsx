import { useQuery } from "@tanstack/react-query";
import { SPORTS, SPORT_KEYS } from "@bet207/core";
import { getDataStatus } from "../data/source";
import { Chip, Empty, ErrorBox, PageHeader, Panel, timeAgo } from "../components/ui";

export function Dashboard() {
  const status = useQuery({ queryKey: ["data-status"], queryFn: getDataStatus });
  return (
    <>
      <PageHeader title="Dashboard" subtitle="Market vs. model across NFL, college football, and the NBA. A disagreement is a question, not a pick." />
      {status.error && <ErrorBox error={status.error} />}
      <div className="grid gap-4 lg:grid-cols-3">
        {SPORT_KEYS.map((k) => (
          <Panel key={k} title={SPORTS[k].name} right={<a className="text-xs text-accent" href={`#/${k}`}>Open slate →</a>}>
            <p className="num text-2xl">{status.data?.gameCounts[k] ?? 0}</p>
            <p className="text-mute text-xs">games stored</p>
          </Panel>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2 mt-4">
        <Panel title="Pipeline runs">
          {!status.data?.runs.length ? (
            <Empty title={status.data?.mode === "demo" ? "Demo mode: no pipeline yet" : "No pipeline runs recorded"}>
              Runs appear here after the ingestion workflow runs (GitHub Actions, or <code className="num">npm run pipeline</code> locally).
            </Empty>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-mute text-xs text-left"><tr><th className="py-1">Job</th><th>Sport</th><th>Status</th><th>Rows</th><th>When</th></tr></thead>
              <tbody>
                {status.data.runs.map((r, i) => (
                  <tr key={i} className="border-t border-line">
                    <td className="py-1.5">{r.job}</td>
                    <td>{r.sport ?? "—"}</td>
                    <td><Chip tone={r.status === "success" ? "pos" : r.status === "failed" ? "neg" : "neutral"} title={r.error ?? undefined}>{r.status}</Chip></td>
                    <td className="num">{r.rowsUpserted ?? "—"}</td>
                    <td className="text-mute">{timeAgo(r.finishedAt ?? r.startedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
        <Panel title="API quota">
          {!status.data?.quota.length ? (
            <Empty title="No quota readings yet">The Odds API's remaining credits are read from its response headers after each odds pull.</Empty>
          ) : (
            <ul className="space-y-2 text-sm">
              {status.data.quota.map((q) => (
                <li key={q.provider} className="flex items-center gap-3">
                  <span className="w-32">{q.provider}</span>
                  <span className="num">{q.remaining ?? "—"} left</span>
                  <span className="text-mute num">{q.used ?? "—"} used</span>
                  <span className="ml-auto text-mute text-xs">{timeAgo(q.checkedAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
