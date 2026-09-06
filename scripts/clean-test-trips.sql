-- Remove trips left behind by a test run that crashed part way through.
--
-- Run with:  node scripts/sql.mjs scripts/clean-test-trips.sql
--
-- Scoped to titles the suites use for their throwaway trips, so a real trip
-- cannot be caught by it. Deliberately does NOT touch anything else: the demo
-- trip and any trip a person actually planned stay exactly where they are.
--
-- Inventory a traveler added is removed by the `added_for_trip` cascade when
-- its trip goes, so there is nothing to delete by hand here.

begin;

create temp table doomed as
  select id from trips
  where title in (
    'Custom stop test — mine',
    'Custom stop test — somebody else''s',
    'Compare test'
  );

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

commit;
