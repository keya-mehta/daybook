-- Daybook: family planner schema
-- All times are stored as timestamptz (UTC); each household has an IANA time zone
-- used for display, recurrence expansion and "today".

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Households and membership
-- ---------------------------------------------------------------------------
create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Our family',
  timezone text not null default 'Asia/Kolkata',
  home_label text not null default 'Home',
  home_address text,
  traffic_buffer_min int not null default 15 check (traffic_buffer_min between 0 and 120),
  -- used only when Google Maps can't be reached; always shown as a rough estimate
  fallback_travel_min int check (fallback_travel_min between 1 and 300),
  default_reminders int[] not null default '{1440,60}',   -- minutes before start
  leave_reminder_min int not null default 15 check (leave_reminder_min between 0 and 180),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- owner/editor: full access. limited: sees only plans for their linked person or driver.
create table public.household_members (
  household_id uuid not null references public.households on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  role text not null check (role in ('owner','editor','limited')),
  email text,
  display_name text,
  person_id uuid,
  driver_id uuid,
  email_summary boolean not null default false,
  summary_hour int not null default 7 check (summary_hour between 0 and 23),
  created_at timestamptz not null default now(),
  primary key (household_id, user_id)
);
create index on public.household_members (user_id);

create table public.invites (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  email text not null,
  role text not null check (role in ('editor','limited')),
  person_id uuid,
  driver_id uuid,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  unique (household_id, email)
);

-- ---------------------------------------------------------------------------
-- Role helpers (security definer so RLS policies can call them without recursion)
-- ---------------------------------------------------------------------------
create or replace function public.hh_role(h uuid) returns text
language sql stable security definer set search_path = public as $$
  select role from household_members where household_id = h and user_id = auth.uid()
$$;

create or replace function public.is_member(h uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from household_members where household_id = h and user_id = auth.uid())
$$;

create or replace function public.can_edit(h uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from household_members
                where household_id = h and user_id = auth.uid() and role in ('owner','editor'))
$$;

create or replace function public.my_person(h uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select person_id from household_members where household_id = h and user_id = auth.uid()
$$;

create or replace function public.my_driver(h uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select driver_id from household_members where household_id = h and user_id = auth.uid()
$$;

-- ---------------------------------------------------------------------------
-- People, places, vehicles, drivers
-- ---------------------------------------------------------------------------
create table public.people (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  name text not null check (length(trim(name)) > 0),
  relation text,                -- "Dad", "Ananya's tutor" … helps the sentence reader
  initials text,
  color text not null default '#7d8f7a',
  photo_url text,
  phone text,
  email text,
  notes text,
  usual_pickup text,            -- default pickup address if not home
  sort int not null default 0,
  archived boolean not null default false,
  is_sample boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.people (household_id);

create table public.places (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  name text not null,
  address text not null,
  phone text,
  notes text,
  is_sample boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.places (household_id);

create table public.drivers (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  name text not null,
  phone text,
  notes text,
  -- availability: null days = not entered yet (planner will flag, never assume)
  available_days int[] check (available_days <@ '{0,1,2,3,4,5,6}'),
  available_from time,
  available_to time,
  is_sample boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  name text not null,
  seats int check (seats between 1 and 20),
  default_driver_id uuid references public.drivers on delete set null,
  notes text,
  available_days int[] check (available_days <@ '{0,1,2,3,4,5,6}'),
  available_from time,
  available_to time,
  is_sample boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- one-off unavailability (servicing, driver on leave)
create table public.resource_blocks (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  vehicle_id uuid references public.vehicles on delete cascade,
  driver_id uuid references public.drivers on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text,
  check (ends_at > starts_at),
  check ((vehicle_id is null) <> (driver_id is null))
);

alter table public.household_members
  add foreign key (person_id) references public.people on delete set null,
  add foreign key (driver_id) references public.drivers on delete set null;

-- ---------------------------------------------------------------------------
-- Events (appointments, classes, recurring commitments)
-- ---------------------------------------------------------------------------
create table public.events (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  title text not null check (length(trim(title)) > 0),
  category text not null default 'appointment'
    check (category in ('appointment','medical','school','class','work','social','travel','household','other')),
  person_ids uuid[] not null default '{}',
  start_at timestamptz not null,
  end_at timestamptz not null,
  all_day boolean not null default false,
  location text,                 -- free text or address
  place_id uuid references public.places on delete set null,
  status text not null default 'planned' check (status in ('planned','tentative','cancelled')),
  needs_confirmation boolean not null default false,
  -- transport
  transport_mode text not null default 'none'
    check (transport_mode in ('none','drop','drop_pickup','wait','self')),
  pickup_from text,              -- null = home
  return_to text,                -- null = home
  vehicle_id uuid references public.vehicles on delete set null,
  driver_id uuid references public.drivers on delete set null,
  self_drive boolean not null default false,   -- driven by a household member, no driver needed
  leave_lead_min int check (leave_lead_min between 0 and 600),     -- user fixed "leave by"
  travel_min_override int check (travel_min_override between 0 and 600),
  prep_min int not null default 0 check (prep_min between 0 and 240),
  -- reminders
  reminder_offsets int[],        -- null = household default
  remind_leave boolean not null default true,
  -- recurrence: subset of RFC 5545 RRULE, expanded in household time zone
  rrule text,
  exdates date[] not null default '{}',
  series_id uuid references public.events on delete set null,  -- detached occurrence of a series
  checklist jsonb not null default '[]',   -- [{id,text,done}]
  notes text,
  gcal_event_id text,
  is_sample boolean not null default false,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_at >= start_at)
);
create index on public.events (household_id, start_at);
create index on public.events using gin (person_ids);

-- ---------------------------------------------------------------------------
-- Tasks
-- ---------------------------------------------------------------------------
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  title text not null check (length(trim(title)) > 0),
  description text,
  due_date date,
  due_time time,
  priority int not null default 2 check (priority between 1 and 3),  -- 1 high, 2 normal, 3 low
  person_id uuid references public.people on delete set null,
  event_id uuid references public.events on delete cascade,
  occurrence_date date,          -- which occurrence of a recurring event
  estimate_min int check (estimate_min between 1 and 1440),
  rrule text,
  checklist jsonb not null default '[]',
  status text not null default 'open' check (status in ('open','waiting','done')),
  waiting_on text,
  source text not null default 'user' check (source in ('user','suggested','sentence')),
  kind text not null default 'todo'
    check (kind in ('todo','call','carry','buy','pay','confirm','transport','prepare')),
  completed_at timestamptz,
  is_sample boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.tasks (household_id, status, due_date);
create index on public.tasks (event_id);

-- ---------------------------------------------------------------------------
-- Reminders (generated by the planner, or added by hand)
-- ---------------------------------------------------------------------------
create table public.reminders (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  target_user_id uuid references auth.users on delete cascade,   -- null = all owners/editors
  ref_type text not null check (ref_type in ('event','task','custom')),
  ref_id uuid,
  occurrence_date date,
  kind text not null check (kind in ('before','leave','task_due','arrange','confirm','custom')),
  fire_at timestamptz not null,
  title text not null,
  body text,
  status text not null default 'pending' check (status in ('pending','sent','done','dismissed')),
  origin text not null default 'auto' check (origin in ('auto','manual')),
  user_modified boolean not null default false,   -- snoozed/rescheduled: planner keeps the user's time
  dedupe_key text not null,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (household_id, dedupe_key)
);
create index on public.reminders (status, fire_at);

-- ---------------------------------------------------------------------------
-- Notes, lists, contacts, important dates, reusable checklists
-- ---------------------------------------------------------------------------
create table public.notes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  kind text not null check (kind in ('note','shopping','checklist','contact','date')),
  title text not null,
  body text,
  items jsonb not null default '[]',
  phone text,
  the_date date,
  repeats_yearly boolean not null default false,
  person_id uuid references public.people on delete cascade,
  event_id uuid references public.events on delete cascade,
  task_id uuid references public.tasks on delete cascade,
  pinned boolean not null default false,
  is_sample boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.notes (household_id, kind);

-- ---------------------------------------------------------------------------
-- Server-only tables (no client access)
-- ---------------------------------------------------------------------------
create table public.travel_cache (
  key text primary key,
  origin text not null,
  destination text not null,
  duration_min int not null,
  distance_km numeric,
  traffic_aware boolean not null,
  fetched_at timestamptz not null default now()
);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade default auth.uid(),
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_ok_at timestamptz
);

create table public.gcal_accounts (
  household_id uuid primary key references public.households on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  google_email text,
  refresh_token text not null,
  calendar_id text,
  connected_at timestamptz not null default now(),
  last_sync_at timestamptz,
  last_error text
);

create table public.oauth_states (
  state text primary key,
  household_id uuid not null references public.households on delete cascade,
  user_id uuid not null,
  return_to text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

do $$ declare t text; begin
  foreach t in array array['households','people','places','drivers','vehicles','events','tasks','notes'] loop
    execute format('create trigger touch before update on public.%I for each row execute function public.touch_updated_at()', t);
  end loop;
end $$;

-- completed_at bookkeeping
create or replace function public.task_completed() returns trigger language plpgsql as $$
begin
  if new.status = 'done' and (old is null or old.status <> 'done') then new.completed_at = now(); end if;
  if new.status <> 'done' then new.completed_at = null; end if;
  return new;
end $$;
create trigger task_completed before insert or update of status on public.tasks
  for each row execute function public.task_completed();

-- when a task is done, its pending reminders are done too
create or replace function public.task_done_reminders() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'done' and old.status <> 'done' then
    update reminders set status = 'done' where ref_type = 'task' and ref_id = new.id and status = 'pending';
  end if;
  return new;
end $$;
create trigger task_done_reminders after update of status on public.tasks
  for each row execute function public.task_done_reminders();

-- cancelling or deleting an event clears its pending reminders
create or replace function public.event_cancel_reminders() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    delete from reminders where ref_type = 'event' and ref_id = old.id and status = 'pending';
    return old;
  end if;
  if new.status = 'cancelled' then
    update reminders set status = 'dismissed' where ref_type = 'event' and ref_id = new.id and status = 'pending';
  end if;
  return new;
end $$;
create trigger event_cancel_reminders after update of status or delete on public.events
  for each row execute function public.event_cancel_reminders();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.invites enable row level security;
alter table public.people enable row level security;
alter table public.places enable row level security;
alter table public.drivers enable row level security;
alter table public.vehicles enable row level security;
alter table public.resource_blocks enable row level security;
alter table public.events enable row level security;
alter table public.tasks enable row level security;
alter table public.reminders enable row level security;
alter table public.notes enable row level security;
alter table public.travel_cache enable row level security;      -- no policies: server only
alter table public.push_subscriptions enable row level security;
alter table public.gcal_accounts enable row level security;     -- no policies: server only
alter table public.oauth_states enable row level security;      -- no policies: server only

create policy hh_read on public.households for select using (is_member(id));
create policy hh_update on public.households for update using (can_edit(id)) with check (can_edit(id));

create policy mem_read on public.household_members for select using (is_member(household_id));
create policy mem_self_update on public.household_members for update
  using (user_id = auth.uid() or hh_role(household_id) = 'owner')
  with check (user_id = auth.uid() or hh_role(household_id) = 'owner');
create policy mem_owner_delete on public.household_members for delete
  using (hh_role(household_id) = 'owner' and user_id <> auth.uid());

create policy inv_read on public.invites for select using (can_edit(household_id));
create policy inv_write on public.invites for all using (hh_role(household_id) = 'owner')
  with check (hh_role(household_id) = 'owner');

-- reference data: every member reads, editors write
do $$ declare t text; begin
  foreach t in array array['people','places','drivers','vehicles','resource_blocks'] loop
    execute format('create policy r on public.%I for select using (is_member(household_id))', t);
    execute format('create policy w on public.%I for insert with check (can_edit(household_id))', t);
    execute format('create policy u on public.%I for update using (can_edit(household_id)) with check (can_edit(household_id))', t);
    execute format('create policy d on public.%I for delete using (can_edit(household_id))', t);
  end loop;
end $$;

-- events: limited members see only their own person's or driver's plans
create policy r on public.events for select using (
  can_edit(household_id)
  or (is_member(household_id) and (my_person(household_id) = any(person_ids) or driver_id = my_driver(household_id)))
);
create policy w on public.events for insert with check (can_edit(household_id));
create policy u on public.events for update using (can_edit(household_id)) with check (can_edit(household_id));
create policy d on public.events for delete using (can_edit(household_id));

create policy r on public.tasks for select using (
  can_edit(household_id) or (is_member(household_id) and person_id = my_person(household_id))
);
create policy w on public.tasks for insert with check (can_edit(household_id));
create policy u on public.tasks for update using (
  can_edit(household_id) or (is_member(household_id) and person_id = my_person(household_id))
) with check (is_member(household_id));
create policy d on public.tasks for delete using (can_edit(household_id));

create policy r on public.reminders for select using (
  (target_user_id is null and can_edit(household_id)) or target_user_id = auth.uid()
);
create policy w on public.reminders for insert with check (can_edit(household_id) and origin = 'manual');
create policy u on public.reminders for update using (
  (target_user_id is null and can_edit(household_id)) or target_user_id = auth.uid()
) with check (is_member(household_id));
create policy d on public.reminders for delete using (can_edit(household_id) and origin = 'manual');

create policy r on public.notes for select using (can_edit(household_id));
create policy w on public.notes for all using (can_edit(household_id)) with check (can_edit(household_id));

create policy own on public.push_subscriptions for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------
create or replace function public.create_household(p_name text, p_timezone text, p_display_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare h uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if not exists (select 1 from pg_timezone_names where name = p_timezone) then
    raise exception 'unknown time zone %', p_timezone;
  end if;
  insert into households (name, timezone, created_by) values (coalesce(nullif(trim(p_name),''),'Our family'), p_timezone, auth.uid())
    returning id into h;
  insert into household_members (household_id, user_id, role, email, display_name)
    values (h, auth.uid(), 'owner', auth.jwt() ->> 'email', p_display_name);
  return h;
end $$;

-- join any household that invited this email
create or replace function public.accept_invites() returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; r record; em text := lower(auth.jwt() ->> 'email');
begin
  if auth.uid() is null or em is null then return 0; end if;
  for r in select * from invites where lower(email) = em and accepted_at is null loop
    insert into household_members (household_id, user_id, role, email, person_id, driver_id)
      values (r.household_id, auth.uid(), r.role, em, r.person_id, r.driver_id)
      on conflict (household_id, user_id) do nothing;
    update invites set accepted_at = now() where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.gcal_status(h uuid) returns json
language sql stable security definer set search_path = public as $$
  select case when is_member(h) then
    (select json_build_object('connected', true, 'google_email', google_email,
            'last_sync_at', last_sync_at, 'last_error', last_error)
       from gcal_accounts where household_id = h)
  end
$$;

create or replace function public.search_all(h uuid, q text)
returns table(kind text, id uuid, title text, subtitle text, at timestamptz)
language sql stable security invoker set search_path = public as $$
  with p as (select '%' || replace(replace(trim(q), '%', ''), '_', '') || '%' as pat)
  select 'person', id, name, relation, null::timestamptz from people, p
    where household_id = h and (name ilike pat or relation ilike pat or notes ilike pat)
  union all
  select 'event', id, title, coalesce(location,''), start_at from events, p
    where household_id = h and (title ilike pat or location ilike pat or notes ilike pat)
  union all
  select 'task', id, title, coalesce(description,''), due_date::timestamptz from tasks, p
    where household_id = h and (title ilike pat or description ilike pat)
  union all
  select 'place', id, name, address, null from places, p
    where household_id = h and (name ilike pat or address ilike pat)
  union all
  select 'note', id, title, kind, null from notes, p
    where household_id = h and (title ilike pat or body ilike pat or items::text ilike pat)
  limit 60
$$;

-- ---------------------------------------------------------------------------
-- Sample data: everything is flagged is_sample so it can be removed in one tap
-- ---------------------------------------------------------------------------
create or replace function public.seed_sample(h uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  tz text; d0 date; dad uuid; ana uuid; dadi uuid; car uuid; car2 uuid; ram uuid; ev uuid;
  function_ts timestamptz;
begin
  if not can_edit(h) then raise exception 'not allowed'; end if;
  select timezone into tz from households where id = h;
  d0 := (now() at time zone tz)::date;

  insert into people (household_id, name, relation, initials, color, is_sample, sort)
    values (h, 'Rajiv', 'Dad', 'R', '#7d8f7a', true, 1) returning id into dad;
  insert into people (household_id, name, relation, initials, color, is_sample, sort)
    values (h, 'Ananya', 'Granddaughter', 'A', '#b08d6e', true, 2) returning id into ana;
  insert into people (household_id, name, relation, initials, color, is_sample, sort)
    values (h, 'Kamla', 'Dadi', 'K', '#8a7f9c', true, 3) returning id into dadi;

  insert into drivers (household_id, name, available_days, available_from, available_to, is_sample)
    values (h, 'Ramesh', '{1,2,3,4,5,6}', '07:00', '20:00', true) returning id into ram;
  insert into vehicles (household_id, name, seats, default_driver_id, available_days, available_from, available_to, is_sample)
    values (h, 'Honda City', 4, ram, '{0,1,2,3,4,5,6}', '07:00', '22:00', true) returning id into car;
  insert into vehicles (household_id, name, seats, is_sample)
    values (h, 'Innova', 7, true) returning id into car2;   -- availability deliberately not set

  insert into places (household_id, name, address, is_sample) values
    (h, 'Dr. Shah Dental', 'Hill Road, Bandra West, Mumbai', true),
    (h, 'Ananya''s school', 'Peddar Road, Mumbai', true);

  insert into events (household_id, title, category, person_ids, start_at, end_at, location,
      transport_mode, vehicle_id, driver_id, needs_confirmation, checklist, is_sample)
    values (h, 'Dentist', 'medical', array[dad],
      (d0 + 1 + time '11:00') at time zone tz, (d0 + 1 + time '11:45') at time zone tz,
      'Hill Road, Bandra West, Mumbai', 'wait', car, ram, true,
      '[{"id":"c1","text":"Previous X-rays","done":false},{"id":"c2","text":"Insurance card","done":false}]', true)
    returning id into ev;
  insert into tasks (household_id, title, kind, event_id, person_id, due_date, source, is_sample) values
    (h, 'Call clinic to confirm', 'call', ev, dad, d0 + 1, 'suggested', true),
    (h, 'Collect Dad''s reports', 'carry', ev, dad, d0, 'user', true);

  insert into events (household_id, title, category, person_ids, start_at, end_at, location,
      transport_mode, vehicle_id, driver_id, rrule, is_sample)
    values (h, 'School', 'school', array[ana],
      (d0 + time '08:00') at time zone tz, (d0 + time '13:30') at time zone tz,
      'Peddar Road, Mumbai', 'drop_pickup', car, ram, 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', true);

  insert into events (household_id, title, category, person_ids, start_at, end_at, location,
      transport_mode, is_sample)
    values (h, 'Bharatanatyam class', 'class', array[ana],
      (d0 + 1 + time '12:30') at time zone tz, (d0 + 1 + time '13:30') at time zone tz,
      'Khar West, Mumbai', 'drop', true);   -- no car assigned → planner flags it

  insert into events (household_id, title, category, person_ids, start_at, end_at, location, transport_mode, is_sample)
    values (h, 'Satsang', 'social', array[dadi],
      (d0 + time '17:00') at time zone tz, (d0 + time '18:30') at time zone tz, 'Juhu, Mumbai', 'self', true);

  insert into tasks (household_id, title, kind, due_date, priority, is_sample) values
    (h, 'Pay electricity bill', 'pay', d0 - 1, 1, true),
    (h, 'Order Dadi''s medicines', 'buy', d0, 2, true),
    (h, 'Book cab for airport on Saturday', 'transport', d0 + 3, 2, true);
  insert into tasks (household_id, title, status, waiting_on, is_sample) values
    (h, 'Plumber to confirm visit', 'waiting', 'Plumber', true);

  insert into notes (household_id, kind, title, items, is_sample) values
    (h, 'shopping', 'Groceries', '[{"id":"s1","text":"Milk","done":false},{"id":"s2","text":"Atta","done":false}]', true),
    (h, 'checklist', 'Doctor visit', '[{"id":"k1","text":"Reports","done":false},{"id":"k2","text":"Prescription","done":false},{"id":"k3","text":"Insurance card","done":false}]', true),
    (h, 'contact', 'Dr. Shah clinic', '[]', true);
end $$;

create or replace function public.remove_sample(h uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not can_edit(h) then raise exception 'not allowed'; end if;
  delete from reminders where household_id = h and ref_type = 'event'
    and ref_id in (select id from events where household_id = h and is_sample);
  delete from reminders where household_id = h and ref_type = 'task'
    and ref_id in (select id from tasks where household_id = h and is_sample);
  delete from notes where household_id = h and is_sample;
  delete from tasks where household_id = h and is_sample;
  delete from events where household_id = h and is_sample;
  update household_members set person_id = null where household_id = h and person_id in (select id from people where household_id = h and is_sample);
  delete from people where household_id = h and is_sample;
  delete from places where household_id = h and is_sample;
  delete from vehicles where household_id = h and is_sample;
  delete from drivers where household_id = h and is_sample;
end $$;

grant execute on function public.create_household, public.accept_invites, public.gcal_status,
  public.search_all, public.seed_sample, public.remove_sample to authenticated;

-- live updates for the dashboard
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.events, public.tasks, public.reminders,
      public.people, public.vehicles, public.drivers, public.notes;
  end if;
end $$;

-- daily email bookkeeping (one summary per person per day)
alter table public.household_members add column last_summary_on date;
