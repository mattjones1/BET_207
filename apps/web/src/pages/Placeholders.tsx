import { useParams } from "react-router-dom";
import { SPORTS, isSportKey } from "@bet207/core";
import { Empty, PageHeader } from "../components/ui";
import { NotFound } from "./NotFound";

/* Sections that later phases fill. Each says plainly what's missing, so nothing looks like real output. */

export function SportSlate() {
  const { sport = "" } = useParams();
  if (!isSportKey(sport)) return <NotFound />;
  return (
    <>
      <PageHeader title={SPORTS[sport].name} subtitle="Upcoming slate: market lines, model projections, and disagreements." />
      <Empty title="No games yet">Schedules, results, and lines arrive with Phase 2 (data integration).</Empty>
    </>
  );
}

export function Ratings() {
  return (
    <>
      <PageHeader title="Power Ratings" subtitle="Margin-of-victory ratings and Elo, by sport." />
      <Empty title="No model runs yet">Ratings appear after Phase 3 (modeling) produces its first run.</Empty>
    </>
  );
}

export function ModelLab() {
  return (
    <>
      <PageHeader title="Model Lab" subtitle="Configurations, parameters, and saved runs. Every change creates a new version." />
      <Empty title="No configurations yet">Default configurations for each sport arrive with Phase 3.</Empty>
    </>
  );
}

export function Backtests() {
  return (
    <>
      <PageHeader title="Backtesting" subtitle="Walk-forward evaluation. No future information enters a past prediction." />
      <Empty title="No backtests yet">The walk-forward engine arrives with Phase 4.</Empty>
    </>
  );
}
