-- ═══════════════════════════════════════════════════════════════
--  Permission + rule tests for the Gym Manager schema.
--  Each check prints PASS/FAIL; the run fails if any FAIL appears.
-- ═══════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on
set client_min_messages = warning;

create temp table results (n serial, name text, ok boolean, info text);
grant all on results to authenticated;
grant usage on sequence results_n_seq to authenticated;

-- Run `sql` as the given user; expect success (fragment null) or an error containing `fragment`
create function pg_temp.check(name text, uid uuid, sql text, fragment text default null) returns void
  language plpgsql as $$
declare err text;
begin
  perform set_config('request.jwt.claim.sub', coalesce(uid::text, ''), true);
  if uid is not null then execute 'set local role authenticated'; end if;
  begin
    execute sql;
    execute 'reset role';
    insert into results (name, ok, info) values (name, fragment is null, case when fragment is null then 'ok' else 'expected error: ' || fragment end);
  exception when others then
    err := sqlerrm;
    execute 'reset role';
    insert into results (name, ok, info) values (name, fragment is not null and err ilike '%' || fragment || '%', err);
  end;
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

-- Row count visible to a user (0 = hidden by RLS)
create function pg_temp.visible(uid uuid, sql text) returns int language plpgsql as $$
declare n int;
begin
  perform set_config('request.jwt.claim.sub', uid::text, true);
  execute 'set local role authenticated';
  execute sql into n;
  execute 'reset role';
  return n;
end $$;

-- ─── Fixtures (as the service/postgres role, like the Edge Function) ───
insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'boss@x', '{"username":"boss","display_name":"Boss"}', '{"gym_role":"admin"}'),
  ('00000000-0000-0000-0000-00000000000b', 'mody@x', '{"username":"mody","display_name":"Mody"}', '{"gym_role":"mod"}'),
  ('00000000-0000-0000-0000-00000000000c', 'ann@x',  '{"username":"ann","display_name":"Ann"}',   '{}'),
  ('00000000-0000-0000-0000-00000000000d', 'bob@x',  '{"username":"bob","display_name":"Bob"}',   '{}');

insert into public.pair_catalog (id, trainer, pokemon, type, role, ex_role, max_bonus) values
  ('p-sa', 'Cynthia', 'Garchomp', 'Dragon', 'Strike (Physical)', 'Tech', 10),
  ('p-5',  'Brock', 'Onix', 'Rock', 'Tech', '', 5);

-- Battle opened 3 days ago → 9 + 3×3 = 18 tickets granted so far
insert into public.seasons (name, battle_start, battle_end, leaders, circuits, is_active) values
  ('SS-test', now() - interval '3 days 1 hour', now() + interval '4 days',
   '[{"name":"Roark","type":"Rock"},{"name":"Gardenia","type":"Grass"}]',
   '[{"name":"Circuit 1","pts":10000,"kind":"Regular Battle"},{"name":"Circuit 2","pts":35000,"kind":"Regular Battle"},
     {"name":"Extra Battle 1 and onward","pts":100000,"kind":"Extra Battles"}]', true);

-- ─── Accounts & roles ───
select pg_temp.check('profile created from auth user with role',   null, $$ do $d$ begin
  assert (select role from public.profiles where username = 'boss') = 'admin';
  assert (select role from public.profiles where username = 'ann') = 'member'; end $d$ $$);
select pg_temp.check('member edits own nickname',                   '00000000-0000-0000-0000-00000000000c',
  $$ update public.profiles set display_name = 'Ann!' where username = 'ann' $$);
select pg_temp.check('member cannot promote self',                  '00000000-0000-0000-0000-00000000000c',
  $$ update public.profiles set role = 'admin' where username = 'ann' $$, 'Chỉ admin');
select pg_temp.check('mod cannot change roles',                     '00000000-0000-0000-0000-00000000000b',
  $$ update public.profiles set role = 'mod' where username = 'bob' $$, 'Chỉ admin');
select pg_temp.check('admin changes a role',                        '00000000-0000-0000-0000-00000000000a',
  $$ update public.profiles set role = 'member' where username = 'mody'; update public.profiles set role = 'mod' where username = 'mody' $$);
select pg_temp.check('member cannot edit another member',           '00000000-0000-0000-0000-00000000000c',
  $$ do $d$ declare n int; begin update public.profiles set note = 'x' where username = 'bob'; get diagnostics n = row_count; assert n = 0, 'updated'; end $d$ $$);
select pg_temp.check('mod edits another member',                    '00000000-0000-0000-0000-00000000000b',
  $$ do $d$ declare n int; begin update public.profiles set note = 'x' where username = 'bob'; get diagnostics n = row_count; assert n = 1; end $d$ $$);
select pg_temp.check('member cannot delete accounts',               '00000000-0000-0000-0000-00000000000c',
  $$ do $d$ declare n int; begin delete from public.profiles where username = 'bob'; get diagnostics n = row_count; assert n = 0, 'deleted'; end $d$ $$);

-- ─── Pairs & tower ───
select pg_temp.check('member adds own pair',                        '00000000-0000-0000-0000-00000000000c',
  $$ insert into public.member_pairs (user_id, pair_id, level, ex, ex_role) values ('00000000-0000-0000-0000-00000000000c', 'p-sa', 10, true, true) $$);
select pg_temp.check('level > 5 on a 5/5 pair is rejected',         '00000000-0000-0000-0000-00000000000c',
  $$ insert into public.member_pairs (user_id, pair_id, level) values ('00000000-0000-0000-0000-00000000000c', 'p-5', 6) $$, 'chỉ tới 5/5');
select pg_temp.check('EX Role on a pair without one is rejected',   '00000000-0000-0000-0000-00000000000c',
  $$ insert into public.member_pairs (user_id, pair_id, ex_role) values ('00000000-0000-0000-0000-00000000000c', 'p-5', true) $$, 'không có EX Role');
select pg_temp.check('unknown pair is rejected',                    '00000000-0000-0000-0000-00000000000c',
  $$ insert into public.member_pairs (user_id, pair_id) values ('00000000-0000-0000-0000-00000000000c', 'nope') $$, 'foreign key');
select pg_temp.check('member cannot add pairs for someone else',    '00000000-0000-0000-0000-00000000000c',
  $$ insert into public.member_pairs (user_id, pair_id) values ('00000000-0000-0000-0000-00000000000d', 'p-5') $$, 'row-level security');
select pg_temp.check('mod fills in pairs for a member',             '00000000-0000-0000-0000-00000000000b',
  $$ insert into public.member_pairs (user_id, pair_id, level) values ('00000000-0000-0000-0000-00000000000d', 'p-5', 5) $$);
select pg_temp.check('tower floor saved',                           '00000000-0000-0000-0000-00000000000c',
  $$ insert into public.tower_progress (user_id, type, floor) values ('00000000-0000-0000-0000-00000000000c', 'Dragon', 40) $$);
select pg_temp.check('tower floor above 40 is rejected',            '00000000-0000-0000-0000-00000000000c',
  $$ insert into public.tower_progress (user_id, type, floor) values ('00000000-0000-0000-0000-00000000000c', 'Rock', 41) $$, 'check constraint');
select pg_temp.check('unknown tower type is rejected',              '00000000-0000-0000-0000-00000000000c',
  $$ insert into public.tower_progress (user_id, type, floor) values ('00000000-0000-0000-0000-00000000000c', 'Sound', 1) $$, 'check constraint');

-- ─── Seasons (staff only) ───
select pg_temp.check('member cannot create a season',               '00000000-0000-0000-0000-00000000000c',
  $$ insert into public.seasons (name, battle_start, battle_end, leaders, circuits) values ('x', now(), now() + interval '1 day', '[]', '[]') $$, 'row-level security');
select pg_temp.check('mod bans a member for the season',            '00000000-0000-0000-0000-00000000000b',
  $$ insert into public.season_members (season_id, user_id, banned) select id, '00000000-0000-0000-0000-00000000000d', true from public.seasons $$);

-- ─── Runs: the Gym Battle rules ───
select pg_temp.check('member logs a run in the open round',         '00000000-0000-0000-0000-00000000000c',
  $$ insert into public.runs (season_id, user_id, leader, round, tickets, score) select id, '00000000-0000-0000-0000-00000000000c', 'Roark', 1, 3, 10000 from public.seasons $$);
select pg_temp.check('member_name snapshot filled in',              null,
  $$ do $d$ begin assert (select member_name from public.runs limit 1) = 'Ann!'; end $d$ $$);
select pg_temp.check('regular circuit must cost 3 tickets',         '00000000-0000-0000-0000-00000000000c',
  $$ insert into public.runs (season_id, user_id, leader, round, tickets, score) select id, '00000000-0000-0000-0000-00000000000c', 'Gardenia', 1, 1, 5000 from public.seasons $$, 'luôn tốn 3 vé');
select pg_temp.check('score above the round cap is rejected',       '00000000-0000-0000-0000-00000000000c',
  $$ insert into public.runs (season_id, user_id, leader, round, tickets, score) select id, '00000000-0000-0000-0000-00000000000c', 'Gardenia', 1, 3, 10001 from public.seasons $$, 'Vượt trần');
select pg_temp.check('member cannot log a closed/unopened round',   '00000000-0000-0000-0000-00000000000c',
  $$ insert into public.runs (season_id, user_id, leader, round, tickets, score) select id, '00000000-0000-0000-0000-00000000000c', 'Roark', 2, 3, 100 from public.seasons $$, 'round đang mở');
select pg_temp.check('member cannot log for someone else',          '00000000-0000-0000-0000-00000000000c',
  $$ insert into public.runs (season_id, user_id, leader, round, tickets, score) select id, '00000000-0000-0000-0000-00000000000b', 'Gardenia', 1, 3, 100 from public.seasons $$, 'row-level security');
select pg_temp.check('banned member cannot get new runs',           '00000000-0000-0000-0000-00000000000b',
  $$ insert into public.runs (season_id, user_id, leader, round, tickets, score) select id, '00000000-0000-0000-0000-00000000000d', 'Gardenia', 1, 3, 100 from public.seasons $$, 'bị khoá');
select pg_temp.check('clearing every leader opens round 2',         '00000000-0000-0000-0000-00000000000b',
  $$ insert into public.runs (season_id, user_id, leader, round, tickets, score) select id, '00000000-0000-0000-0000-00000000000b', 'Gardenia', 1, 3, 10000 from public.seasons;
     do $d$ begin assert public.season_active_round((select id from public.seasons)) = 2; end $d$ $$);
select pg_temp.check('ticket budget: 18 granted after 3 days',      null,
  $$ do $d$ begin assert public.season_tickets_granted((select s from public.seasons s)) = 18; end $d$ $$);
select pg_temp.check('running out of tickets is rejected',          '00000000-0000-0000-0000-00000000000c',
  $$ do $d$ declare sid bigint := (select id from public.seasons); begin
       for i in 1..6 loop insert into public.runs (season_id, user_id, leader, round, tickets, score) values (sid, '00000000-0000-0000-0000-00000000000c', 'Roark', 2, 3, 100); end loop; end $d$ $$, 'Không đủ vé');
select pg_temp.check('extra battle allows 1–3 tickets, repeats',    '00000000-0000-0000-0000-00000000000a',
  $$ insert into public.runs (season_id, user_id, leader, round, tickets, score) select id, '00000000-0000-0000-0000-00000000000a', 'Roark', 7, 1, 5000 from public.seasons $$);
select pg_temp.check('member cannot delete someone else''s run',    '00000000-0000-0000-0000-00000000000c',
  $$ do $d$ declare n int; begin delete from public.runs where user_id = '00000000-0000-0000-0000-00000000000b'; get diagnostics n = row_count; assert n = 0, 'deleted'; end $d$ $$);
select pg_temp.check('member edits own run',                        '00000000-0000-0000-0000-00000000000c',
  $$ do $d$ declare n int; begin update public.runs set note = 'gg' where user_id = '00000000-0000-0000-0000-00000000000c'; get diagnostics n = row_count; assert n >= 1; end $d$ $$);
select pg_temp.check('activity log hidden from members',            null,
  $$ do $d$ begin assert pg_temp.visible('00000000-0000-0000-0000-00000000000c', 'select count(*) from public.activity') = 0;
                  assert pg_temp.visible('00000000-0000-0000-0000-00000000000b', 'select count(*) from public.activity') > 0; end $d$ $$);

-- ─── A member leaves: account deleted, their runs keep the name ───
select pg_temp.check('deleting an account keeps its runs',          null,
  $$ delete from auth.users where id = '00000000-0000-0000-0000-00000000000c';
     do $d$ begin
       assert not exists (select 1 from public.profiles where username = 'ann');
       assert not exists (select 1 from public.member_pairs where user_id = '00000000-0000-0000-0000-00000000000c');
       assert exists (select 1 from public.runs where user_id is null and member_name = 'Ann!'); end $d$ $$);

-- ─── Report ───
select format('%s  %s%s', case when ok then 'PASS' else 'FAIL' end, name, case when ok then '' else '  → ' || info end) as result
  from results order by n;
do $$ begin
  if exists (select 1 from results where not ok) then raise exception '% test(s) failed', (select count(*) from results where not ok); end if;
end $$;
