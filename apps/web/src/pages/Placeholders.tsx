import { Empty, PageHeader } from "../components/ui";

/* Sections that later phases fill. Each says plainly what's missing, so nothing looks like real output. */

export function GamePage() {
  return (
    <>
      <PageHeader title="Game research" subtitle="Matchup, team comparison, situational, market, model explanation, and your notes." />
      <Empty title="The research page arrives with Phase 5"><a className="text-accent" href="#/">Back to the dashboard</a></Empty>
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
