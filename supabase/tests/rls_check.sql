-- RLS verification. Run in the Supabase SQL Editor AFTER creating two test users (Authentication → Users),
-- then replace the two UUIDs below. Each check returns a row with ok = true. Nothing here changes real data:
-- it runs in a transaction that is rolled back.
begin;

-- A game to attach notes to (rolled back at the end).
insert into teams (sport_id, abbr, name) values (1, 'ZZA', 'RLS Test A'), (1, 'ZZB', 'RLS Test B');
insert into games (sport_id, season, season_type, start_time, home_team_id, away_team_id, provider, provider_event_id, retrieved_at)
  select 1, 2099, 'regular', now(), a.id, b.id, 'rls-test', 'rls-1', now()
  from teams a, teams b where a.abbr = 'ZZA' and b.abbr = 'ZZB';

-- User 1 writes a note.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'USER-1-UUID', 'role', 'authenticated')::text, true);
insert into research_notes (game_id, lean) select id, 'user 1 private' from games where provider_event_id = 'rls-1';
select 'user 1 sees own note' as check, count(*) = 1 as ok from research_notes;
select 'user 1 can read shared games' as check, count(*) >= 1 as ok from games where provider_event_id = 'rls-1';

-- User 2 can't see it.
select set_config('request.jwt.claims', json_build_object('sub', 'USER-2-UUID', 'role', 'authenticated')::text, true);
select 'user 2 cannot see user 1 note' as check, count(*) = 0 as ok from research_notes;

-- Anonymous sees nothing at all.
reset role;
select 'anon has no table access' as check,
  not has_table_privilege('anon', 'games', 'select') and not has_table_privilege('anon', 'research_notes', 'select') as ok;

rollback;
