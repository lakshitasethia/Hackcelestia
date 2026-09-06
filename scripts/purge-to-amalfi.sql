-- Reduce the database to the Amalfi demo and nothing else.
--
-- Run with:  node scripts/sql.mjs scripts/purge-to-amalfi.sql
--
-- Keeps Ananya Sharma's trip (7a000000-…-0001), the Costiera DMC operator, its
-- vendors and the Positano catalogue. Removes every other trip, the whole north
-- India catalogue (Delhi, Manali, Auli, Chopta, Rishikesh, Amritsar, Haridwar,
-- Chandigarh) and the researched Switzerland itinerary.
--
-- Everything here is restorable: the India rows are `supabase/seed-india.sql`,
-- which is still in the repo but no longer part of `npm run db:seed`. Re-add it
-- to that script to bring the catalogue back.

begin;

-- ------------------------------------------------------------- the trips --

-- Every trip that is not Ananya's, and everything hanging off it. Deleted
-- child-first rather than trusting cascades, so a missing `on delete cascade`
-- shows up as a foreign key error here instead of as orphaned rows later.
create temp table doomed as
  select id from trips where id <> '7a000000-0000-4000-a000-000000000001';

delete from agent_steps
  where run_id in (select id from agent_runs where trip_id in (select id from doomed));
delete from agent_runs       where trip_id in (select id from doomed);
delete from replan_proposals where trip_id in (select id from doomed);
delete from disruptions      where trip_id in (select id from doomed);
delete from reviews          where trip_id in (select id from doomed);
delete from payments         where trip_id in (select id from doomed);
delete from messages         where trip_id in (select id from doomed);
delete from bookings         where trip_id in (select id from doomed);
delete from itinerary_items  where trip_id in (select id from doomed);
delete from trip_proposals   where trip_id in (select id from doomed);
delete from trips            where id      in (select id from doomed);

-- --------------------------------------------------------- the catalogue --

-- North India is prefixed throughout: inventory 29000000…, vendors 2e000000…,
-- operator 2a000000…. Positano's rows use 19000000… and are untouched.
delete from availability where inventory_id in
  (select id from inventory where id::text like '29000000%');
delete from inventory where id::text like '29000000%';
delete from vendors   where id::text like '2e000000%';
delete from operators where id = '2a000000-0000-4000-a000-000000000001';

-- The cached Switzerland research. Rebuilt on demand by `research:warm`.
delete from research_cache;

-- Anything the research path stocked, whatever destination it was for.
--
-- `ingestResearch` mints these with random UUIDs under an operator it creates
-- called "Voyage Research", so no id prefix finds them and the first version of
-- this script missed them entirely — Switzerland was still in the catalogue
-- after a purge that reported success. They also come back every time
-- `npm run test:cache` or `npm run test:abroad` runs, which is correct
-- behaviour for those suites and means this script is worth re-running before
-- a demo rather than once.
delete from availability where inventory_id in (
  select i.id from inventory i
  join vendors v on v.id = i.vendor_id
  join operators o on o.id = v.operator_id
  where o.name = 'Voyage Research');
delete from inventory where vendor_id in (
  select v.id from vendors v
  join operators o on o.id = v.operator_id
  where o.name = 'Voyage Research');
delete from vendors where operator_id in
  (select id from operators where name = 'Voyage Research');
delete from operators where name = 'Voyage Research';

commit;
