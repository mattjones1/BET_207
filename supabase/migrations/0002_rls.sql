-- Row Level Security.
--   Shared sports data: readable by signed-in users only; no client writes (the pipeline writes with the
--   service_role key, which bypasses RLS and never reaches the browser).
--   Private data: only its owner can read or write it.
--   Model configs, runs, and backtests: system rows (owner NULL) are readable by signed-in users;
--   a user's own rows are fully theirs.

do $$
declare t text;
begin
  foreach t in array array[
    'sports','teams','team_aliases','sportsbooks','games','game_provider_ids','game_results','team_game_stats',
    'odds_snapshots','historical_lines','team_ratings','game_projections','backtest_observations',
    'pipeline_runs','api_quota'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for select to authenticated using (true)', t || '_read', t);
  end loop;
end $$;

-- Owned model objects
alter table model_configs enable row level security;
create policy model_configs_read on model_configs for select to authenticated using (owner is null or owner = auth.uid());
create policy model_configs_insert on model_configs for insert to authenticated with check (owner = auth.uid());
create policy model_configs_delete on model_configs for delete to authenticated using (owner = auth.uid());
-- No update policy: configurations are immutable. A change is a new version.

alter table model_runs enable row level security;
create policy model_runs_read on model_runs for select to authenticated using (owner is null or owner = auth.uid());
create policy model_runs_write on model_runs for insert to authenticated with check (owner = auth.uid() and kind = 'preview');
create policy model_runs_delete on model_runs for delete to authenticated using (owner = auth.uid());

alter table backtest_runs enable row level security;
create policy backtest_runs_read on backtest_runs for select to authenticated using (owner is null or owner = auth.uid());
create policy backtest_runs_insert on backtest_runs for insert to authenticated with check (owner = auth.uid());
create policy backtest_runs_delete on backtest_runs for delete to authenticated using (owner = auth.uid());

-- Team ratings, projections, and observations follow their parent run's visibility for reads (above: readable
-- by signed-in users). Users may add observations only to their own backtest runs.
create policy backtest_observations_insert on backtest_observations for insert to authenticated
  with check (exists (select 1 from backtest_runs r where r.id = run_id and r.owner = auth.uid()));

-- Private research
alter table research_notes enable row level security;
create policy research_notes_owner on research_notes for all to authenticated using (owner = auth.uid()) with check (owner = auth.uid());

alter table saved_games enable row level security;
create policy saved_games_owner on saved_games for all to authenticated using (owner = auth.uid()) with check (owner = auth.uid());

alter table user_settings enable row level security;
create policy user_settings_owner on user_settings for all to authenticated using (owner = auth.uid()) with check (owner = auth.uid());

-- The anon role gets nothing: no policies grant it access. Revoke default table privileges for clarity.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
