-- The catalogue stops being a fixture.
--
-- Everything up to here could only plan a trip that was already in the
-- database. `composeItinerary` filtered inventory by a hard-coded list of
-- eight north-Indian towns, so "India to Switzerland for 13 days" did not
-- produce a bad plan — it produced the sentence "None of those places are in
-- the catalogue yet", which is the honest answer to a question the system was
-- never able to ask.
--
-- The fix is not a bigger seed file. It is a research agent that goes and
-- finds the places, and a catalogue that can hold what it finds. That means
-- three things Postgres has to know about a row it did not ship with:
-- where the claim came from, when it was made, and that nobody has checked it.
--
-- Idempotent throughout: a migration that only runs on a virgin database is a
-- migration that fails on demo morning.

-- ------------------------------------------------------- sourced inventory --

alter table inventory
  -- The page a price or an opening time was read off. Non-null is what makes a
  -- researched row auditable rather than a hallucination with a UUID: the
  -- itinerary cites it, and a traveler can click it before paying for it.
  add column if not exists source_url text,
  add column if not exists sourced_at timestamptz,
  -- True while no human has verified the row. Provisional rows are plannable
  -- and quotable but never silently bookable — `vendors.channel = 'manual'`
  -- carries that through to `confirmTrip`, which holds them for an operator
  -- instead of decrementing an availability count that was never real.
  add column if not exists provisional boolean not null default false,
  -- `city` and `region` existed; a country did not, and two towns called
  -- Springfield are not a hypothetical once the catalogue is worldwide.
  add column if not exists country text,
  -- The zone this row's opening hours and departure times are written in.
  -- Read off the item rather than the trip, because a trip that starts in
  -- Delhi and spends nine days in the Alps has two of them, and 09:00 at the
  -- chocolate factory is 09:00 in Zurich whatever the traveler's phone says.
  add column if not exists time_zone text;

create index if not exists inventory_country on inventory (country);
-- The composer's per-city catalogue read. Without it, every planning run is a
-- sequential scan over a table that now grows with every trip planned.
create index if not exists inventory_city_type on inventory (city, type);

comment on column inventory.source_url is
  'Page a researched row was read off. Null for seeded rows, which are their own source.';
comment on column inventory.sourced_at is
  'When the research agent read it. Prices go stale; this is how we know how stale.';
comment on column inventory.provisional is
  'True until a human verifies it. Provisional rows plan and quote, but only ever book through an operator.';
comment on column inventory.country is
  'Country the item is in. With city, this is what makes the catalogue unambiguous once it crosses a border.';
comment on column inventory.time_zone is
  'IANA zone for this row own clock times (opens_at, a departure). Falls back to the trip zone when null.';

-- Researched rows have no availability grid, so a trip must not fail to price
-- itself for want of one. Nothing enforced that before because every row was
-- seeded with a grid; say it out loud now.
comment on table availability is
  'Real bookable slots. Absent for provisional inventory, which is held by an operator rather than reserved.';

-- Everything seeded predates the country column and is India. Backfilled here
-- rather than in the migration that added the legs, because that one runs
-- first and these columns do not exist yet when it does.
update inventory set country = 'India'
 where country is null and city in
   ('Delhi','Amritsar','Chandigarh','Manali','Haridwar','Rishikesh','Chopta','Auli');
update inventory set time_zone = 'Asia/Kolkata'
 where time_zone is null and country = 'India';

-- ------------------------------------------------------------- the proposal --

-- A plan the traveler has not said yes to yet.
--
-- The old flow composed straight into `itinerary_items` and then redirected
-- the traveler to look at what had already been written. That inverted the
-- rule the rest of this project keeps — the agent proposes, a person accepts —
-- because by the time anyone saw the itinerary it was the itinerary.
--
-- This is deliberately NOT `replan_proposals`. That table holds operations
-- against an existing trip (drop, move, replace) and every one of its columns
-- assumes a `trip_id` that already has items. A proposal here is the thing
-- that decides whether a trip should exist at all, so it precedes one.
create table if not exists trip_proposals (
  id           uuid primary key default gen_random_uuid(),
  traveler_id  uuid references profiles on delete cascade,
  -- What they actually typed. Kept verbatim so a rejected plan can be re-run
  -- against a changed catalogue without making them write it again.
  description  text not null,
  -- Intake's structured reading of the description.
  spec         jsonb not null default '{}'::jsonb,
  -- What the research agent found, with its citations. Shown alongside the
  -- plan so "why this hotel" has an answer that is not "the model said so".
  research     jsonb not null default '{}'::jsonb,
  -- The composed ComposeResult: stops, costs, day count, warnings. This is a
  -- plan, not a booking, and holds no `itinerary_items` ids because none exist.
  plan         jsonb not null default '{}'::jsonb,
  state        text not null default 'proposed'
               check (state in ('proposed', 'accepted', 'discarded')),
  -- Set when accepted. The link from "I said yes" to what that produced.
  trip_id      uuid references trips on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists trip_proposals_by_traveler
  on trip_proposals (traveler_id, created_at desc);

drop trigger if exists trip_proposals_updated_at on trip_proposals;
create trigger trip_proposals_updated_at
  before update on trip_proposals
  for each row execute function set_updated_at();

comment on table trip_proposals is
  'An itinerary the agent has drafted and nobody has accepted. Accepting it is what creates the trip.';

-- A proposal is private to the person who asked for it, on exactly the same
-- terms as their trips: `traveler_id = auth.uid()`, and no operator visibility,
-- because until it is accepted there is no engagement for an operator to see.
alter table trip_proposals enable row level security;

drop policy if exists proposals_own on trip_proposals;
create policy proposals_own on trip_proposals
  for all
  using (traveler_id = auth.uid())
  with check (traveler_id = auth.uid());

-- ------------------------------------------------------------ agent kinds --

-- 'research' is the web pass that fills the catalogue; 'propose' is the
-- composed draft that comes out of it. Both write the same run/step trace as
-- every other agent here, so a plan is auditable the way a re-plan is: which
-- searches ran, what came back, what it cost in tokens.
alter table agent_runs drop constraint if exists agent_runs_kind_check;
alter table agent_runs
  add constraint agent_runs_kind_check
  check (kind in ('intake', 'compose', 'replan', 'comms', 'copilot',
                  'concierge', 'research', 'propose'));
