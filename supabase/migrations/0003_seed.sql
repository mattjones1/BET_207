-- Reference rows. Teams are created by the ingestion jobs from provider data (never hand-typed).
insert into sports (id, key, name, config) values
  (1, 'nfl',   'NFL',              '{"slate":"week"}'),
  (2, 'ncaaf', 'College Football', '{"slate":"week","division":"fbs"}'),
  (3, 'nba',   'NBA',              '{"slate":"date"}')
on conflict (id) do nothing;

-- Sportsbooks are also added on first sight by the odds job; a few common US books up front.
insert into sportsbooks (key, name) values
  ('consensus', 'Market consensus'),
  ('draftkings', 'DraftKings'),
  ('fanduel', 'FanDuel'),
  ('betmgm', 'BetMGM'),
  ('caesars', 'Caesars'),
  ('espnbet', 'ESPN BET'),
  ('betrivers', 'BetRivers')
on conflict (key) do nothing;
