import { useAuth } from "../lib/auth";
import { env } from "../lib/env";
import { PageHeader, Panel } from "../components/ui";

export function Settings() {
  const { user } = useAuth();
  return (
    <>
      <PageHeader title="Settings" subtitle="Account, defaults, and data connections." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Account">
          <dl className="grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
            <dt className="text-mute">Signed in as</dt><dd>{user?.demo ? "Demo (no account)" : user?.email}</dd>
            <dt className="text-mute">Data mode</dt><dd>{env.demo ? "Demo fixtures" : "Live (Supabase)"}</dd>
          </dl>
        </Panel>
        <Panel title="Data connections">
          <p className="text-sm text-mute">
            Provider keys live only in GitHub Actions secrets and the pipeline's local <code className="num">.env</code>.
            The browser never sees them. See <code className="num">docs/SETUP.md</code>.
          </p>
        </Panel>
      </div>
    </>
  );
}
