-- Waypoint — schema and seed verification.
--
--   node scripts/sql.mjs supabase/verify.sql
--
-- Run this after any migration or re-seed. The plan calls for the blast radius
-- to be provably correct *before* an agent is allowed to reason over it —
-- otherwise a wrong re-plan could mean a bad graph or a bad model, and you end
-- up debugging both at once. Every row below should read PASS.

with checks as (
  -- The demo case: killing the day-2 boat should take exactly four items --
  -- itself, the two that depend on it directly, and dinner one hop further.
  select 'blast radius from boat = 4 items' as label,
         (select count(*) from blast_radius('17000000-0000-4000-a000-000000000011')) = 4 as ok

  union all
  select 'boat blast radius excludes the hotel (upstream)',
         not exists (
           select 1 from blast_radius('17000000-0000-4000-a000-000000000011')
           where item_id = '17000000-0000-4000-a000-000000000001'
         )

  union all
  select 'dinner sits 2 hops from the boat',
         (select depth from blast_radius('17000000-0000-4000-a000-000000000011')
           where item_id = '17000000-0000-4000-a000-000000000014') = 2

  union all
  select 'trip root reaches every item',
         (select count(*) from blast_radius('17000000-0000-4000-a000-000000000001'))
           = (select count(*) from itinerary_items)

  union all
  select 'a leaf reaches only itself',
         (select count(*) from blast_radius('17000000-0000-4000-a000-000000000014')) = 1

  union all
  select 'unknown id returns empty, not an error',
         (select count(*) from blast_radius('00000000-0000-4000-a000-000000000000')) = 0

  union all
  select 'hotel is locked so the re-planner must work around it',
         (select lock_reason from itinerary_items
           where id = '17000000-0000-4000-a000-000000000001') is not null

  union all
  -- If this fails the agent finds nothing, proposes nothing, and looks broken.
  select 'weather-proof substitutes exist for the boat day',
         (select count(*) from availability a
            join inventory i on i.id = a.inventory_id
           where a.date = current_date + 1
             and a.slots_total > a.slots_taken
             and not i.weather_sensitive
             and i.type in ('activity', 'guide')) >= 2

  union all
  select 'every booking carries a cancellation penalty figure',
         not exists (select 1 from bookings where penalty is null)

  union all
  select 'RLS is enabled on every public table',
         not exists (select 1 from pg_tables
                      where schemaname = 'public' and not rowsecurity)

  union all
  select 'no itinerary item depends on a row that does not exist',
         not exists (
           select 1 from itinerary_items i, unnest(i.depends_on) dep
           where not exists (select 1 from itinerary_items x where x.id = dep)
         )

  union all
  -- Guards the naive-timestamp trap: a bare `current_date + time` is cast using
  -- the server's zone (UTC), which silently moved the 09:00 departure to 11:00.
  select 'boat departs 09:00 Positano local, not UTC',
         (select to_char(starts_at at time zone 'Europe/Rome', 'HH24:MI')
            from itinerary_items
           where id = '17000000-0000-4000-a000-000000000011') = '09:00'

  union all
  select 'seeded trip is live today',
         (select starts_on <= current_date and ends_on >= current_date
            from trips where id = '7a000000-0000-4000-a000-000000000001')

  union all
  -- A confirmed stop with nothing reserved behind it understates the operator's
  -- booked value and the traveler's exposure, and neither screen says so.
  select 'every confirmed stop has a booking behind it',
         not exists (
           select 1 from itinerary_items i
            where i.status = 'confirmed'
              and i.inventory_id is not null
              and not exists (
                select 1 from bookings b
                 where b.item_id = i.id and b.state in ('held', 'confirmed')
              )
         )

  union all
  select 'no booking is left pointing at a stop that no longer exists',
         not exists (select 1 from bookings where item_id is null)

  union all
  select 'the catalogue starts with every seat free',
         not exists (select 1 from availability where slots_taken <> 0)

  union all
  select 'the group has a coordinator, so /field has something to show',
         (select coordinator_name from trips
           where id = '7a000000-0000-4000-a000-000000000001') is not null

  union all
  select 'nothing is reported from the field on a fresh seed',
         not exists (select 1 from itinerary_items where field_state <> 'pending')

  union all
  -- The run sheet spans today and tomorrow. If the boat day fell outside it the
  -- coordinator would never see the stop the whole demo is about.
  select 'the boat day falls inside the two-day run sheet',
         (select count(*) from itinerary_items
           where id = '17000000-0000-4000-a000-000000000011'
             and starts_at >= (current_date at time zone 'Europe/Rome')
             and starts_at <  ((current_date + 2) at time zone 'Europe/Rome')) = 1

  union all
  -- A proposal with neither owner is unreachable from every surface and
  -- impossible to apply, so the constraint that forbids it has to be present.
  select 'every proposal belongs to a disruption or a trip',
         (select count(*) from pg_constraint
           where conname = 'proposals_have_an_owner') = 1

  union all
  select 'a concierge proposal is scoped to its trip',
         not exists (select 1 from replan_proposals
                      where source = 'concierge' and trip_id is null)

  union all
  -- Both chat agents write their step trace like the re-planner does, which
  -- only works if the kinds are allowed by the check constraint.
  select 'the agent kinds include the chat agents',
         (select pg_get_constraintdef(oid) from pg_constraint
           where conname = 'agent_runs_kind_check') like '%concierge%'

  union all
  -- The bug this catches: an added stop with no prerequisites is an orphan the
  -- blast radius can never reach, so every later impact assessment silently
  -- gets smaller. One root per trip is correct; two is a severed graph.
  select 'no itinerary has more than one root',
         not exists (
           select 1 from itinerary_items
            where cardinality(depends_on) = 0
              and status not in ('cancelled', 'replaced')
            group by trip_id
           having count(*) > 1
         )

  union all
  select 'a coordinator can only be pointed at a real profile',
         (select count(*) from information_schema.table_constraints tc
            join information_schema.key_column_usage k
              on k.constraint_name = tc.constraint_name
           where tc.table_name = 'trips' and tc.constraint_type = 'FOREIGN KEY'
             and k.column_name = 'coordinator_id') = 1
)
select case when ok then 'PASS' else 'FAIL' end as result, label
from checks
order by ok, label;
