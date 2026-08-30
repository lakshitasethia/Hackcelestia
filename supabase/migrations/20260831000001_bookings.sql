-- Voyage — make bookings and availability follow the itinerary (Phase 2, Day 7)
--
-- Accepting a re-plan used to change `itinerary_items` and nothing else. The
-- boat was marked `replaced`, but its booking stayed `confirmed` and its slot
-- stayed consumed, so the traveler's summary went on counting a €195 penalty
-- for a stop that no longer existed. The itinerary was right and everything
-- hanging off it was wrong.
--
-- Idempotent, like every migration here.

-- Move one availability row's consumed count, atomically.
--
-- This has to be a function: PostgREST can express `slots_taken = 3` but not
-- `slots_taken = slots_taken + 1`, and a read-then-write from the application
-- races two operators booking the last seat. Clamped at both ends so it can
-- never violate the CHECK constraints, whatever the caller asks for.
create or replace function adjust_availability(
  p_inventory_id uuid,
  p_starts_at    timestamptz,
  p_delta        integer
)
returns integer
language plpgsql
as $$
declare
  new_taken integer;
begin
  update availability a
     set slots_taken = greatest(0, least(a.slots_total, a.slots_taken + p_delta))
   where a.inventory_id = p_inventory_id
     -- Matched on the local calendar day rather than the exact instant: a
     -- re-plan may place a stop at a different time from the catalogue slot,
     -- and it is still the same day's capacity being consumed.
     and a.date = (p_starts_at at time zone 'Europe/Rome')::date
  returning a.slots_taken into new_taken;

  -- No row is not an error. Seeded stops and anything outside the published
  -- window have no availability to move, and a booking must not fail because
  -- the catalogue does not track that day.
  return coalesce(new_taken, -1);
end;
$$;
