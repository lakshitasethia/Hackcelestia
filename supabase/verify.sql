-- Voyage — schema and seed verification.
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
  select 'seeded trip is live today',
         (select starts_on <= current_date and ends_on >= current_date
            from trips where id = '7a000000-0000-4000-a000-000000000001')
)
select case when ok then 'PASS' else 'FAIL' end as result, label
from checks
order by ok, label;
