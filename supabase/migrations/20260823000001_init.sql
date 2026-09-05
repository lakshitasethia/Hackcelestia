-- Waypoint — initial schema (Phase 2, Day 1)
--
-- Status/type columns are text + CHECK rather than Postgres enums on purpose:
-- adding a value to an enum mid-build is an ALTER TYPE that cannot always run
-- inside a transaction, and this schema will move during the week. The real
-- safety comes from the TypeScript union types in src/lib/db/types.ts.
--
-- Locations are plain lat/lng doubles rather than PostGIS geography. Transit
-- estimates here are haversine + a road factor, which is accurate enough to
-- decide whether two stops conflict, and it keeps the extension surface at zero.

-- ---------------------------------------------------------------- helpers --

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Great-circle distance in km, scaled by 1.3 to approximate road distance.
create or replace function travel_km(
  lat1 double precision, lng1 double precision,
  lat2 double precision, lng2 double precision
)
returns double precision
language sql
immutable
as $$
  select 1.3 * 6371 * 2 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) *
    power(sin(radians(lng2 - lng1) / 2), 2)
  ));
$$;

-- ------------------------------------------------------------ identities --

create table profiles (
  id          uuid primary key references auth.users on delete cascade,
  role        text not null default 'traveler'
              check (role in ('traveler', 'operator', 'coordinator')),
  full_name   text not null default '',
  email       text,
  phone       text,
  operator_id uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table operators (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  contact    text,
  created_at timestamptz not null default now()
);

alter table profiles
  add constraint profiles_operator_fk
  foreign key (operator_id) references operators on delete set null;

-- --------------------------------------------------------------- supply --

create table vendors (
  id          uuid primary key default gen_random_uuid(),
  operator_id uuid not null references operators on delete cascade,
  name        text not null,
  type        text not null check (type in ('hotel', 'activity', 'transport', 'guide', 'restaurant')),
  contact     text,
  email       text,
  phone       text,
  -- How the comms agent reaches them. 'auto' vendors can be re-booked without
  -- a human in the loop; 'manual' ones always need an operator to confirm.
  channel     text not null default 'manual' check (channel in ('auto', 'manual')),
  reliability numeric(3, 2) not null default 0.90 check (reliability between 0 and 1),
  created_at  timestamptz not null default now()
);

create table inventory (
  id           uuid primary key default gen_random_uuid(),
  vendor_id    uuid not null references vendors on delete cascade,
  title        text not null,
  type         text not null check (type in ('hotel', 'activity', 'transport', 'guide', 'restaurant')),
  description  text,
  duration_min integer not null default 60 check (duration_min > 0),
  base_cost    numeric(10, 2) not null default 0 check (base_cost >= 0),
  lat          double precision,
  lng          double precision,
  opens_at     time,
  closes_at    time,
  -- Free-form tags the composer matches against traveler interests.
  tags         text[] not null default '{}',
  -- Activities that cannot run in rain, so weather disruption can find them.
  weather_sensitive boolean not null default false,
  created_at   timestamptz not null default now()
);

create table availability (
  id           uuid primary key default gen_random_uuid(),
  inventory_id uuid not null references inventory on delete cascade,
  date         date not null,
  starts_at    timestamptz not null,
  slots_total  integer not null default 1 check (slots_total >= 0),
  slots_taken  integer not null default 0 check (slots_taken >= 0),
  price        numeric(10, 2),
  unique (inventory_id, starts_at)
);

create index availability_lookup on availability (inventory_id, date);

-- ---------------------------------------------------------------- trips --

create table trips (
  id          uuid primary key default gen_random_uuid(),
  traveler_id uuid references profiles on delete set null,
  operator_id uuid references operators on delete set null,
  title       text not null default 'Untitled trip',
  -- The operator needs a name and a way to reach the party even for trips that
  -- were never linked to a signed-in traveler account (walk-ins, phone bookings,
  -- and the seeded demo group).
  contact_name  text,
  contact_email text,
  contact_phone text,
  status      text not null default 'draft'
              check (status in ('draft', 'quoted', 'confirmed', 'in_progress', 'completed', 'cancelled')),
  party_size  integer not null default 1 check (party_size > 0),
  budget      numeric(10, 2),
  currency    text not null default 'EUR',
  starts_on   date,
  ends_on     date,
  -- Structured output of the intake agent: interests, pace, dietary, mobility.
  prefs       jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- The DAG. `depends_on` is what makes "identify impact" a graph walk instead of
-- a pile of special cases: an item breaks, and everything reachable from it is
-- the blast radius.
create table itinerary_items (
  id           uuid primary key default gen_random_uuid(),
  trip_id      uuid not null references trips on delete cascade,
  day          integer not null check (day >= 1),
  seq          integer not null default 0,
  inventory_id uuid references inventory on delete set null,
  vendor_id    uuid references vendors on delete set null,
  title        text not null,
  type         text not null check (type in ('hotel', 'activity', 'transport', 'guide', 'restaurant', 'flight')),
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  lat          double precision,
  lng          double precision,
  cost         numeric(10, 2) not null default 0,
  status       text not null default 'planned'
               check (status in ('planned', 'confirmed', 'at_risk', 'cancelled', 'replaced')),
  depends_on   uuid[] not null default '{}',
  -- Non-null means the re-planner may not move this item; the text says why,
  -- and the agent quotes it back in its rationale.
  lock_reason  text,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (ends_at > starts_at)
);

create index itinerary_items_trip on itinerary_items (trip_id, day, seq);
create index itinerary_items_depends on itinerary_items using gin (depends_on);

create table bookings (
  id           uuid primary key default gen_random_uuid(),
  trip_id      uuid not null references trips on delete cascade,
  item_id      uuid references itinerary_items on delete set null,
  vendor_id    uuid references vendors on delete set null,
  state        text not null default 'held'
               check (state in ('held', 'confirmed', 'cancelled', 'refunded', 'failed')),
  amount       numeric(10, 2) not null default 0,
  -- Cost of cancelling right now; the re-planner prices this into every option.
  penalty      numeric(10, 2) not null default 0,
  external_ref text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- --------------------------------------------------------- disruptions --

create table disruptions (
  id           uuid primary key default gen_random_uuid(),
  trip_id      uuid not null references trips on delete cascade,
  source       text not null check (source in ('weather', 'transport', 'vendor', 'manual')),
  severity     text not null default 'medium' check (severity in ('low', 'medium', 'high')),
  headline     text not null,
  root_item_id uuid references itinerary_items on delete set null,
  payload      jsonb not null default '{}'::jsonb,
  state        text not null default 'open' check (state in ('open', 'resolved', 'dismissed')),
  detected_at  timestamptz not null default now(),
  resolved_at  timestamptz
);

create table replan_proposals (
  id            uuid primary key default gen_random_uuid(),
  disruption_id uuid not null references disruptions on delete cascade,
  run_id        uuid,
  -- Ordered list of operations: move / replace / drop / add, each naming an item.
  plan          jsonb not null default '[]'::jsonb,
  cost_delta    numeric(10, 2) not null default 0,
  rationale     text,
  state         text not null default 'draft'
                check (state in ('draft', 'sent', 'accepted', 'rejected', 'superseded')),
  created_at    timestamptz not null default now(),
  decided_at    timestamptz,
  decided_by    uuid references profiles on delete set null
);

create table messages (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid references trips on delete cascade,
  vendor_id   uuid references vendors on delete set null,
  thread_key  text not null,
  direction   text not null check (direction in ('outbound', 'inbound')),
  from_role   text not null check (from_role in ('agent', 'operator', 'vendor', 'coordinator', 'traveler')),
  body        text not null,
  -- Parsed shape of an inbound reply (can_accommodate, alternative_time, ...).
  structured  jsonb,
  sent_at     timestamptz not null default now()
);

create index messages_thread on messages (thread_key, sent_at);

-- ------------------------------------------------------ agent telemetry --

-- Not bookkeeping. The step trace is rendered in the UI so the agent's work is
-- watchable rather than asserted.
create table agent_runs (
  id         uuid primary key default gen_random_uuid(),
  trip_id    uuid references trips on delete cascade,
  kind       text not null check (kind in ('intake', 'compose', 'replan', 'comms', 'copilot')),
  status     text not null default 'running' check (status in ('running', 'succeeded', 'failed')),
  input      jsonb not null default '{}'::jsonb,
  output     jsonb,
  error      text,
  input_tokens  integer,
  output_tokens integer,
  started_at timestamptz not null default now(),
  ended_at   timestamptz
);

create table agent_steps (
  id          uuid primary key default gen_random_uuid(),
  run_id      uuid not null references agent_runs on delete cascade,
  seq         integer not null,
  tool_name   text not null,
  tool_input  jsonb,
  tool_output jsonb,
  ms          integer,
  created_at  timestamptz not null default now(),
  unique (run_id, seq)
);

create index agent_steps_run on agent_steps (run_id, seq);

-- --------------------------------------------------------- blast radius --

-- Everything downstream of a broken item, with hop distance. This is the
-- primitive the disruption engine and the re-planner agent both call.
create or replace function blast_radius(root uuid)
returns table (item_id uuid, depth integer)
language sql
stable
as $$
  with recursive affected as (
    select i.id, 0 as depth
      from itinerary_items i
     where i.id = root
    union
    select i.id, a.depth + 1
      from itinerary_items i
      join affected a on a.id = any (i.depends_on)
     where a.depth < 20            -- cycle guard; real itineraries are shallow
  )
  select id, min(depth)::integer from affected group by id;
$$;

-- ------------------------------------------------------------- triggers --

create trigger profiles_touch before update on profiles
  for each row execute function set_updated_at();
create trigger trips_touch before update on trips
  for each row execute function set_updated_at();
create trigger itinerary_items_touch before update on itinerary_items
  for each row execute function set_updated_at();
create trigger bookings_touch before update on bookings
  for each row execute function set_updated_at();

-- ------------------------------------------------------------------ RLS --

-- Enabled from the start; retrofitting it later means auditing every query.
-- The service_role key bypasses all of this, which is how seeding and the
-- server-side agent routes work.

alter table profiles         enable row level security;
alter table operators        enable row level security;
alter table vendors          enable row level security;
alter table inventory        enable row level security;
alter table availability     enable row level security;
alter table trips            enable row level security;
alter table itinerary_items  enable row level security;
alter table bookings         enable row level security;
alter table disruptions      enable row level security;
alter table replan_proposals enable row level security;
alter table messages         enable row level security;
alter table agent_runs       enable row level security;
alter table agent_steps      enable row level security;

-- Avoids recursive RLS: reading profiles inside a profiles policy would loop.
create or replace function current_role_is(want text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles p where p.id = auth.uid() and p.role = want
  );
$$;

create or replace function current_operator_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.operator_id from profiles p where p.id = auth.uid();
$$;

create policy profiles_self on profiles
  for select using (id = auth.uid() or current_role_is('operator'));
create policy profiles_update_self on profiles
  for update using (id = auth.uid());

-- Catalog data is readable by any signed-in user; only the service role writes it.
create policy operators_read on operators for select using (auth.role() = 'authenticated');
create policy vendors_read on vendors for select using (auth.role() = 'authenticated');
create policy inventory_read on inventory for select using (auth.role() = 'authenticated');
create policy availability_read on availability for select using (auth.role() = 'authenticated');

-- A trip is visible to its traveler, to its operator's staff, and to
-- coordinators (scoped to assigned groups once assignments exist).
create policy trips_read on trips
  for select using (
    traveler_id = auth.uid()
    or operator_id = current_operator_id()
    or current_role_is('coordinator')
  );
create policy trips_write on trips
  for all using (traveler_id = auth.uid() or operator_id = current_operator_id())
  with check (traveler_id = auth.uid() or operator_id = current_operator_id());

-- Everything hanging off a trip inherits that trip's visibility.
create policy items_via_trip on itinerary_items
  for all using (exists (select 1 from trips t where t.id = trip_id))
  with check (exists (select 1 from trips t where t.id = trip_id));
create policy bookings_via_trip on bookings
  for all using (exists (select 1 from trips t where t.id = trip_id))
  with check (exists (select 1 from trips t where t.id = trip_id));
create policy disruptions_via_trip on disruptions
  for all using (exists (select 1 from trips t where t.id = trip_id))
  with check (exists (select 1 from trips t where t.id = trip_id));
create policy messages_via_trip on messages
  for select using (trip_id is null or exists (select 1 from trips t where t.id = trip_id));
create policy runs_via_trip on agent_runs
  for select using (trip_id is null or exists (select 1 from trips t where t.id = trip_id));
create policy steps_via_run on agent_steps
  for select using (exists (select 1 from agent_runs r where r.id = run_id));
create policy proposals_via_disruption on replan_proposals
  for all using (exists (select 1 from disruptions d where d.id = disruption_id))
  with check (exists (select 1 from disruptions d where d.id = disruption_id));

-- New signups get a profile row automatically.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''), new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
