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


