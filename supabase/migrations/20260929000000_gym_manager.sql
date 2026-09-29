-- ═══════════════════════════════════════════════════════════════
--  PMEX Gym Manager — schema, row-level security, validation
--
--  Roles: admin (1) · mod (2) · member (~20). Accounts are created by the
--  admin through the `admin-users` Edge Function (username + password; the
--  email is synthetic). Everything below is enforced in the database, so the
--  web app cannot be bypassed with a hand-written API call.
-- ═══════════════════════════════════════════════════════════════

create type public.gym_role as enum ('admin', 'mod', 'member');

create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  username     text not null unique check (username ~ '^[a-z0-9_.-]{3,32}$'),
  display_name text not null default '',          -- in-game nickname
  facebook     text not null default '',
  role         public.gym_role not null default 'member',
  note         text not null default '',
  joined_at    date not null default current_date,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ─── Role helpers (security definer: read the caller's role without tripping RLS) ───
create function public.my_role() returns public.gym_role
  language sql stable security definer set search_path = public
  as $$ select role from public.profiles where id = auth.uid() $$;

create function public.is_staff() returns boolean
  language sql stable security definer set search_path = public
  as $$ select coalesce(public.my_role() in ('admin', 'mod'), false) $$;

create function public.is_admin() returns boolean
  language sql stable security definer set search_path = public
  as $$ select coalesce(public.my_role() = 'admin', false) $$;

-- A profile row appears automatically for every new auth user. The role comes from
-- app_metadata, which only the service role (Edge Function) can set.
create function public.handle_new_user() returns trigger
  language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, username, display_name, role)
  values (
    new.id,
    lower(coalesce(new.raw_user_meta_data ->> 'username', split_part(new.email, '@', 1))),
    coalesce(new.raw_user_meta_data ->> 'display_name', ''),
    coalesce((new.raw_app_meta_data ->> 'gym_role')::public.gym_role, 'member')
  );
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Only the admin may change a role or a username. Calls without a user (SQL editor,
-- service role) are allowed so the first admin can be promoted by hand.
create function public.guard_profile_update() returns trigger
  language plpgsql set search_path = public
as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    if new.role is distinct from old.role then
      raise exception 'Chỉ admin được đổi vai trò.' using errcode = '42501';
    end if;
    if new.username is distinct from old.username then
      raise exception 'Chỉ admin được đổi username.' using errcode = '42501';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger profiles_guard before update on public.profiles
  for each row execute function public.guard_profile_update();

-- ─── Pair catalog (synced from the Dex build by the admin) ───
create table public.pair_catalog (
  id         text primary key,                   -- Dex pair id, e.g. "0-sygna-suit-red-charizard"
  trainer    text not null,
  pokemon    text not null,
  type       text not null default '',
  role       text not null default '',
  ex_role    text not null default '',           -- '' = no EX Role
  rarity     smallint not null default 5,
  max_bonus  smallint not null default 5 check (max_bonus in (5, 10)),   -- 10 ⇔ can Superawaken
  updated_at timestamptz not null default now()
);

-- ─── What each member owns ───
-- level: 1–5 = move level x/5; 6–10 = Superawakened (6/5 … 10/5), only for max_bonus = 10
create table public.member_pairs (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  pair_id    text not null references public.pair_catalog (id) on update cascade,
  level      smallint not null default 1 check (level between 1 and 10),
  ex         boolean not null default false,     -- 6★ EX unlocked
  ex_role    boolean not null default false,     -- EX Role unlocked
  note       text not null default '',
  updated_at timestamptz not null default now(),
  primary key (user_id, pair_id)
);

create function public.check_member_pair() returns trigger
  language plpgsql set search_path = public
as $$
declare c public.pair_catalog;
begin
  select * into c from public.pair_catalog where id = new.pair_id;
  if new.level > c.max_bonus then
    raise exception '% & % chỉ tới %/5.', c.trainer, c.pokemon, c.max_bonus;
  end if;
  if new.ex_role and c.ex_role = '' then
    raise exception '% & % không có EX Role.', c.trainer, c.pokemon;
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger member_pairs_check before insert or update on public.member_pairs
  for each row execute function public.check_member_pair();

-- ─── Pasio Tower: one tower per type, floors 0–40 ───
create table public.tower_progress (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  type       text not null check (type in ('Normal', 'Fire', 'Water', 'Electric', 'Grass', 'Ice', 'Fighting', 'Poison',
               'Ground', 'Flying', 'Psychic', 'Bug', 'Rock', 'Ghost', 'Dragon', 'Dark', 'Steel', 'Fairy')),
  floor      smallint not null default 0 check (floor between 0 and 40),
  updated_at timestamptz not null default now(),
  primary key (user_id, type)
);

-- ─── Gym Battle seasons ───
-- leaders / circuits are a snapshot of the Dex gym at creation time, so old seasons
-- keep working after the datamine moves on. A last circuit named "… and onward"
-- repeats forever (Extra Battle 12, 13, …).
create table public.seasons (
  id             bigint generated always as identity primary key,
  name           text not null,                          -- "SS4 Sinnoh"
  gym_key        text,                                    -- Dex gym name, e.g. "Pasio Gym Battle No. 4"
  battle_start   timestamptz not null,
  battle_end     timestamptz not null check (battle_end > battle_start),
  leaders        jsonb not null check (jsonb_typeof(leaders) = 'array'),   -- [{ name, type, weakness: [..] }]
  circuits       jsonb not null check (jsonb_typeof(circuits) = 'array'),  -- [{ name, pts, kind, ball }]
  tickets_day1   smallint not null default 9,
  tickets_daily  smallint not null default 3,
  ticket_cap     smallint not null default 30,            -- per member
  gym_ticket_cap integer  not null default 600,           -- whole gym
  target_score   bigint,                                  -- e.g. last season's Top-100 line
  is_active      boolean not null default false,
  created_by     uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now()
);
create unique index seasons_one_active on public.seasons (is_active) where is_active;

create table public.season_members (
  season_id bigint not null references public.seasons (id) on delete cascade,
  user_id   uuid   not null references public.profiles (id) on delete cascade,
  banned    boolean not null default false,               -- locked out of new runs; score excluded
  note      text not null default '',
  primary key (season_id, user_id)
);

-- Who is assigned to which Gym Leader this season
create table public.assignments (
  season_id bigint not null references public.seasons (id) on delete cascade,
  leader    text   not null,
  user_id   uuid   not null references public.profiles (id) on delete cascade,
  note      text   not null default '',
  primary key (season_id, leader, user_id)
);

-- Strategy note per Gym Leader
create table public.leader_notes (
  season_id  bigint not null references public.seasons (id) on delete cascade,
  leader     text   not null,
  note       text   not null default '',
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (season_id, leader)
);

-- ─── Run log (one row = one battle) ───
create table public.runs (
  id          bigint generated always as identity primary key,
  season_id   bigint not null references public.seasons (id) on delete cascade,
  user_id     uuid references public.profiles (id) on delete set null,
  member_name text not null default '',                  -- snapshot: survives account deletion
  leader      text not null,
  round       smallint not null check (round >= 1),
  tickets     smallint not null check (tickets between 1 and 3),
  score       integer  not null check (score > 0),
  team        jsonb    not null default '[]' check (jsonb_typeof(team) = 'array' and jsonb_array_length(team) <= 3),
  note        text     not null default '',
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index runs_season_round on public.runs (season_id, round, leader);
create index runs_season_user  on public.runs (season_id, user_id);

-- Circuit config for round n: past the last circuit, an "… and onward" circuit repeats
create function public.season_circuit(s public.seasons, n int) returns jsonb
  language sql immutable
as $$
  select case
    when n between 1 and jsonb_array_length(s.circuits) then s.circuits -> (n - 1)
    when (s.circuits -> -1 ->> 'name') ilike '%and onward%' then s.circuits -> -1
  end
$$;

-- Tickets handed out so far: day1 at Battle start, then +daily per day, capped
create function public.season_tickets_granted(s public.seasons, at timestamptz default now()) returns int
  language sql stable
as $$
  select case when at < s.battle_start then 0 else
    least(s.ticket_cap, s.tickets_day1 + s.tickets_daily *
      least(floor(extract(epoch from (least(at, s.battle_end) - s.battle_start)) / 86400)::int,
            greatest(ceil(extract(epoch from (s.battle_end - s.battle_start)) / 86400)::int - 1, 0)))
  end
$$;

-- First round whose Gym Leaders aren't all at the cap (null = everything cleared)
create function public.season_active_round(p_season bigint, p_skip bigint default null) returns int
  language plpgsql stable set search_path = public
as $$
declare
  s public.seasons; c jsonb; n int := 1; leaders int; done int;
begin
  select * into s from public.seasons where id = p_season;
  leaders := jsonb_array_length(s.leaders);
  loop
    c := public.season_circuit(s, n);
    exit when c is null or n > 500;
    select count(*) into done from (
      select r.leader from public.runs r
      where r.season_id = p_season and r.round = n and r.id is distinct from p_skip
      group by r.leader having sum(r.score) >= (c ->> 'pts')::int
    ) x;
    if done < leaders then return n; end if;
    n := n + 1;
  end loop;
  return null;
end $$;

-- Every rule of the Gym Battle, checked on insert and update. Staff may backfill any
-- round (e.g. importing an old sheet); members can only log the round that is open.
create function public.check_run() returns trigger
  language plpgsql security definer set search_path = public
as $$
declare
  s public.seasons; c jsonb; used int; have int; gym_used int; active int; label text;
begin
  select * into s from public.seasons where id = new.season_id;
  if not exists (select 1 from jsonb_array_elements(s.leaders) l where l ->> 'name' = new.leader) then
    raise exception 'Gym Leader "%" không có trong mùa này.', new.leader;
  end if;

  c := public.season_circuit(s, new.round);
  if c is null then raise exception 'Round % không tồn tại trong mùa này.', new.round; end if;
  label := coalesce(c ->> 'name', 'Round ' || new.round);
  if (c ->> 'kind') ilike 'regular%' and new.tickets <> 3 then
    raise exception '% luôn tốn 3 vé mỗi lượt (chọn 1–3 vé chỉ có từ Extra Battle).', label;
  end if;

  if new.user_id is not null then
    if exists (select 1 from public.season_members m where m.season_id = s.id and m.user_id = new.user_id and m.banned)
       and (tg_op = 'INSERT' or new.user_id is distinct from old.user_id) then
      raise exception 'Thành viên này đang bị khoá trong mùa, không ghi lượt mới được.';
    end if;
    if new.member_name = '' then
      select coalesce(nullif(display_name, ''), username) into new.member_name from public.profiles where id = new.user_id;
    end if;
    select coalesce(sum(tickets), 0) into used from public.runs
      where season_id = s.id and user_id = new.user_id and id is distinct from new.id;
    if used + new.tickets > public.season_tickets_granted(s) then
      raise exception 'Không đủ vé: đã dùng %, được phát % vé tới thời điểm này.', used, public.season_tickets_granted(s);
    end if;
  end if;

  select coalesce(sum(tickets), 0) into gym_used from public.runs where season_id = s.id and id is distinct from new.id;
  if gym_used + new.tickets > s.gym_ticket_cap then
    raise exception 'Cả Gym chỉ được dùng % vé — còn % vé.', s.gym_ticket_cap, s.gym_ticket_cap - gym_used;
  end if;

  select coalesce(sum(score), 0) into have from public.runs
    where season_id = s.id and round = new.round and leader = new.leader and id is distinct from new.id;
  if have + new.score > (c ->> 'pts')::int then
    raise exception 'Vượt trần: % ở % chỉ còn thiếu % điểm.', new.leader, label, (c ->> 'pts')::int - have;
  end if;

  if tg_op = 'INSERT' and not public.is_staff() then
    active := public.season_active_round(s.id);
    if active is distinct from new.round then
      raise exception 'Chỉ ghi được cho round đang mở (round %).', coalesce(active::text, '—');
    end if;
  end if;

  if tg_op = 'INSERT' then new.created_by := coalesce(new.created_by, auth.uid()); end if;
  new.updated_at := now();
  return new;
end $$;

create trigger runs_check before insert or update on public.runs
  for each row execute function public.check_run();

-- ─── Activity log (who did what) — staff can read it ───
create table public.activity (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  actor      uuid references public.profiles (id) on delete set null,
  actor_name text not null default '',
  action     text not null,                       -- e.g. "run.insert", "account.delete"
  detail     jsonb not null default '{}'
);

create function public.log_activity() returns trigger
  language plpgsql security definer set search_path = public
as $$
declare who text;
begin
  select coalesce(nullif(display_name, ''), username) into who from public.profiles where id = auth.uid();
  insert into public.activity (actor, actor_name, action, detail)
  values (auth.uid(), coalesce(who, 'system'), tg_table_name || '.' || lower(tg_op),
          case tg_op when 'DELETE' then to_jsonb(old) else to_jsonb(new) end);
  return coalesce(new, old);
end $$;

create trigger runs_activity after insert or update or delete on public.runs
  for each row execute function public.log_activity();
create trigger seasons_activity after insert or update or delete on public.seasons
  for each row execute function public.log_activity();
create trigger profiles_activity after update or delete on public.profiles
  for each row execute function public.log_activity();

-- ═══════════════════════════════════════════════════════════════
--  Row-level security: everyone signed in can read the gym's data;
--  members write their own rows; staff (admin + mod) write anyone's.
-- ═══════════════════════════════════════════════════════════════
alter table public.profiles       enable row level security;
alter table public.pair_catalog   enable row level security;
alter table public.member_pairs   enable row level security;
alter table public.tower_progress enable row level security;
alter table public.seasons        enable row level security;
alter table public.season_members enable row level security;
alter table public.assignments    enable row level security;
alter table public.leader_notes   enable row level security;
alter table public.runs           enable row level security;
alter table public.activity       enable row level security;

create policy "read: signed in" on public.profiles       for select to authenticated using (true);
create policy "read: signed in" on public.pair_catalog   for select to authenticated using (true);
create policy "read: signed in" on public.member_pairs   for select to authenticated using (true);
create policy "read: signed in" on public.tower_progress for select to authenticated using (true);
create policy "read: signed in" on public.seasons        for select to authenticated using (true);
create policy "read: signed in" on public.season_members for select to authenticated using (true);
create policy "read: signed in" on public.assignments    for select to authenticated using (true);
create policy "read: signed in" on public.leader_notes   for select to authenticated using (true);
create policy "read: signed in" on public.runs           for select to authenticated using (true);
create policy "read: staff"     on public.activity       for select to authenticated using (public.is_staff());

-- Profiles: accounts are created/deleted by the Edge Function (service role) only
create policy "update: self or staff" on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_staff()) with check (id = auth.uid() or public.is_staff());

create policy "write: staff" on public.pair_catalog for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

create policy "write: self or staff" on public.member_pairs for all to authenticated
  using (user_id = auth.uid() or public.is_staff()) with check (user_id = auth.uid() or public.is_staff());
create policy "write: self or staff" on public.tower_progress for all to authenticated
  using (user_id = auth.uid() or public.is_staff()) with check (user_id = auth.uid() or public.is_staff());

create policy "write: staff" on public.seasons        for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "write: staff" on public.season_members for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "write: staff" on public.assignments    for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "write: staff" on public.leader_notes   for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- Runs: members log and fix their own battles; staff can log for anyone
create policy "insert: self or staff" on public.runs for insert to authenticated
  with check (user_id = auth.uid() or public.is_staff());
create policy "update: self or staff" on public.runs for update to authenticated
  using (user_id = auth.uid() or public.is_staff()) with check (user_id = auth.uid() or public.is_staff());
create policy "delete: self or staff" on public.runs for delete to authenticated
  using (user_id = auth.uid() or public.is_staff());

-- Signed-in users reach the tables only through the policies above; the anonymous key sees nothing
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
revoke all on all tables in schema public from anon;
