-- EdgeBoard schema v1. Run in the Supabase SQL Editor (or `supabase db push`).
-- Conventions: home-margin axis everywhere (see packages/core/src/conventions.ts); missing values are NULL, never 0.
-- Every externally sourced row carries provider, provider ids, retrieved_at, source_updated_at, completeness.

-- gen_random_uuid() is built into Postgres 13+ (no extension needed).

-- ───────── Reference ─────────
create table sports (
  id          smallint primary key,
  key         text not null unique check (key ~ '^[a-z0-9_]+$'),
  name        text not null,
  config      jsonb not null default '{}'::jsonb
);

create table teams (
  id          uuid primary key default gen_random_uuid(),
  sport_id    smallint not null references sports(id),
  abbr        text not null,
  name        text not null,
  conference  text,
  division    text,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (sport_id, abbr)
);

-- Names used by each provider ("LA", "LAR", "Los Angeles Rams"…) → our team.
-- alias is stored normalized (lowercase, trimmed); one alias maps to one team per sport and provider.
create table team_aliases (
  sport_id    smallint not null references sports(id),
  provider    text not null,
  alias       text not null check (alias = lower(btrim(alias))),
  team_id     uuid not null references teams(id) on delete cascade,
  primary key (sport_id, provider, alias)
);
create index team_aliases_team on team_aliases (team_id);

create table sportsbooks (
  id          smallserial primary key,
  key         text not null unique,
  name        text not null
);

-- ───────── Games ─────────
create table games (
  id                 uuid primary key default gen_random_uuid(),
  sport_id           smallint not null references sports(id),
  season             smallint not null,
  season_type        text not null check (season_type in ('regular','postseason','preseason')),
  week               smallint,
  start_time         timestamptz not null,
  home_team_id       uuid not null references teams(id),
  away_team_id       uuid not null references teams(id),
  neutral_site       boolean,                       -- NULL = unknown (e.g. NBA free tier has no flag)
  venue              text,
  home_rest          smallint,
  away_rest          smallint,
  status             text not null default 'scheduled' check (status in ('scheduled','in_progress','final','postponed','canceled')),
  provider           text not null,
  provider_event_id  text not null,
  retrieved_at       timestamptz not null,
  source_updated_at  timestamptz,
  completeness       text not null default 'complete' check (completeness in ('complete','partial','missing')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (home_team_id <> away_team_id),
  unique (provider, provider_event_id)
);
create index games_sport_start on games (sport_id, start_time);
create index games_sport_season on games (sport_id, season, week);

-- Other providers' ids for the same game (e.g. The Odds API event id for an nflverse game).
create table game_provider_ids (
  game_id      uuid not null references games(id) on delete cascade,
  provider     text not null,
  provider_key text not null,
  matched_at   timestamptz not null default now(),
  primary key (provider, provider_key)
);
create index game_provider_ids_game on game_provider_ids (game_id);

create table game_results (
  game_id       uuid primary key references games(id) on delete cascade,
  home_score    smallint not null,
  away_score    smallint not null,
  overtime      boolean,
  final_at      timestamptz not null,               -- when the result became known (look-ahead guard)
  provider      text not null,
  retrieved_at  timestamptz not null
);

create table team_game_stats (
  game_id       uuid not null references games(id) on delete cascade,
  team_id       uuid not null references teams(id),
  stats         jsonb not null,
  provider      text not null,
  retrieved_at  timestamptz not null,
  primary key (game_id, team_id, provider)
);

-- ───────── Market ─────────
-- Prices we captured ourselves. One row per (game, book, market, source update time): retries never duplicate.
create table odds_snapshots (
  id                 bigserial primary key,
  game_id            uuid not null references games(id) on delete cascade,
  sportsbook_id      smallint not null references sportsbooks(id),
  market             text not null check (market in ('spread','total','h2h')),
  home_point         numeric(5,1),                  -- spread: home team's sportsbook spread
  home_price         smallint,
  away_price         smallint,
  total_point        numeric(5,1),
  over_price         smallint,
  under_price        smallint,
  source_updated_at  timestamptz not null,
  retrieved_at       timestamptz not null,
  provider           text not null,
  unique (game_id, sportsbook_id, market, source_updated_at)
);
create index odds_snapshots_game on odds_snapshots (game_id, market, retrieved_at);

-- Lines imported from results providers. "closing" lines are retrospective benchmarks, not prices
-- that were available when a pregame prediction would have been made.
create table historical_lines (
  id                  bigserial primary key,
  game_id             uuid not null references games(id) on delete cascade,
  provider            text not null,
  line_type           text not null check (line_type in ('closing','consensus','provider','opening')),
  sportsbook          text not null default '',      -- '' = provider consensus / unnamed
  market_home_margin  numeric(5,1),                  -- spread on the home-margin axis (positive = home favored)
  home_spread_price   smallint,
  away_spread_price   smallint,
  total               numeric(5,1),
  over_price          smallint,
  under_price         smallint,
  home_moneyline      integer,
  away_moneyline      integer,
  retrieved_at        timestamptz not null,
  unique (game_id, provider, line_type, sportsbook)
);

-- ───────── Models ─────────
create table model_configs (
  id           uuid primary key default gen_random_uuid(),
  sport_id     smallint not null references sports(id),
  owner        uuid references auth.users(id) on delete cascade,   -- NULL = system default
  name         text not null,
  version      integer not null,
  params       jsonb not null,
  params_hash  text not null,
  notes        text,
  created_at   timestamptz not null default now(),
  unique (sport_id, owner, name, version)
);
create unique index model_configs_hash on model_configs (sport_id, coalesce(owner, '00000000-0000-0000-0000-000000000000'::uuid), params_hash);

create table model_runs (
  id            uuid primary key default gen_random_uuid(),
  config_id     uuid not null references model_configs(id) on delete cascade,
  owner         uuid references auth.users(id) on delete cascade,
  kind          text not null check (kind in ('production','preview')),
  code_version  text not null,
  data_cutoff   timestamptz not null,
  status        text not null check (status in ('running','success','failed')),
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  summary       jsonb not null default '{}'::jsonb
);
create index model_runs_config on model_runs (config_id, started_at desc);

create table team_ratings (
  run_id        uuid not null references model_runs(id) on delete cascade,
  team_id       uuid not null references teams(id),
  as_of         timestamptz not null,
  mov_rating    numeric(6,2),
  off_rating    numeric(6,2),
  def_rating    numeric(6,2),
  elo           numeric(7,1),
  games_used    smallint not null,
  uncertainty   numeric(6,2),
  primary key (run_id, team_id)
);

create table game_projections (
  run_id           uuid not null references model_runs(id) on delete cascade,
  game_id          uuid not null references games(id) on delete cascade,
  proj_home_margin numeric(5,2),
  proj_total       numeric(5,1),
  elo_home_margin  numeric(5,2),
  sigma            numeric(5,2),
  p_home_cover     numeric(5,4),
  p_push           numeric(5,4),
  p_over           numeric(5,4),
  status           text not null check (status in ('ok','experimental','insufficient')),
  explanation      jsonb not null default '{}'::jsonb,
  primary key (run_id, game_id)
);
create index game_projections_game on game_projections (game_id);

-- ───────── Backtests ─────────
create table backtest_runs (
  id           uuid primary key default gen_random_uuid(),
  config_id    uuid not null references model_configs(id) on delete cascade,
  owner        uuid references auth.users(id) on delete cascade,
  sport_id     smallint not null references sports(id),
  seasons      smallint[] not null,
  method       text not null default 'walk_forward',
  line_source  text not null,                        -- e.g. 'nflverse:closing' (retrospective benchmark)
  code_version text not null,
  summary      jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

create table backtest_observations (
  run_id              uuid not null references backtest_runs(id) on delete cascade,
  game_id             uuid not null references games(id) on delete cascade,
  proj_home_margin    numeric(5,2) not null,
  market_home_margin  numeric(5,1),
  actual_margin       smallint not null,
  edge                numeric(5,2),
  bucket              text,
  ats_result          char(1) check (ats_result in ('W','L','P')),
  proj_total          numeric(5,1),
  market_total        numeric(5,1),
  actual_total        smallint not null,
  ou_result           char(1) check (ou_result in ('W','L','P')),
  p_cover             numeric(5,4),
  price               smallint,
  units               numeric(6,3),
  primary key (run_id, game_id)
);

-- ───────── User (private) ─────────
create table research_notes (
  id              uuid primary key default gen_random_uuid(),
  owner           uuid not null default auth.uid() references auth.users(id) on delete cascade,
  game_id         uuid not null references games(id) on delete cascade,
  lean            text,
  observations    text,
  injuries        text,
  disagreement    text,
  would_consider  text check (would_consider in ('yes','no','maybe')),
  pass_reasons    text,
  updated_at      timestamptz not null default now(),
  unique (owner, game_id)
);

create table saved_games (
  owner      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  game_id    uuid not null references games(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (owner, game_id)
);

create table user_settings (
  owner           uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  default_book    text,
  default_sport   text,
  prefs           jsonb not null default '{}'::jsonb,
  updated_at      timestamptz not null default now()
);

-- ───────── Operations ─────────
create table pipeline_runs (
  id             bigserial primary key,
  job            text not null,
  sport          text,
  status         text not null check (status in ('running','success','failed','skipped')),
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  rows_upserted  integer,
  error          text,
  details        jsonb not null default '{}'::jsonb
);
create index pipeline_runs_started on pipeline_runs (started_at desc);

create table api_quota (
  id          bigserial primary key,
  provider    text not null,
  checked_at  timestamptz not null default now(),
  remaining   integer,
  used        integer,
  last_cost   integer
);
create index api_quota_provider on api_quota (provider, checked_at desc);

-- ───────── Views (security_invoker so RLS applies to the caller) ─────────
create view api_quota_latest with (security_invoker = true) as
  select distinct on (provider) provider, checked_at, remaining, used, last_cost
  from api_quota order by provider, checked_at desc;

create view game_counts with (security_invoker = true) as
  select s.key as sport_key, count(g.id)::int as games
  from sports s left join games g on g.sport_id = s.id group by s.key;

create view odds_latest with (security_invoker = true) as
  select distinct on (game_id, sportsbook_id, market) *
  from odds_snapshots order by game_id, sportsbook_id, market, source_updated_at desc;

-- Earliest snapshot WE captured. Never call it the "opening line" unless the source says so.
create view odds_first_captured with (security_invoker = true) as
  select distinct on (game_id, sportsbook_id, market) *
  from odds_snapshots order by game_id, sportsbook_id, market, source_updated_at asc;

-- updated_at maintenance
create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger games_touch before update on games for each row execute function touch_updated_at();
create trigger notes_touch before update on research_notes for each row execute function touch_updated_at();
create trigger settings_touch before update on user_settings for each row execute function touch_updated_at();
