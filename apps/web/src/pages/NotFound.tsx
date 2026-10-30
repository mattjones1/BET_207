import { Empty, PageHeader } from "../components/ui";

export function NotFound() {
  return (
    <>
      <PageHeader title="Not found" />
      <Empty title="That page doesn't exist."><a className="text-accent" href="#/">Back to the dashboard</a></Empty>
    </>
  );
}
