-- A traveler can add a place the catalogue has never heard of.
--
-- Until now every stop on every itinerary had to point at an existing
-- `inventory` row: `addItem` takes an `inventoryId`, and the concierge's
-- `validateOps` rejects an id it cannot find. That rule is load-bearing — it is
-- the single thing stopping a model inventing a "Schweizer Schokolade Factory
-- Tour" in Bern and putting it on somebody's holiday — and it is not being
-- relaxed here.
--
-- What it also did, though, was stop a *person* adding a real place they knew
-- about and the catalogue did not. Those are different problems wearing the
-- same error message. The model inventing a place is a hallucination; a
-- traveler naming the reindeer farm they read about is research. The fix is not
-- to loosen the validator, it is to let a human mint a row and then use the
-- ordinary machinery on it.
--
-- Idempotent throughout: a migration that only runs on a virgin database is a
-- migration that fails on demo morning.

alter table inventory
  -- Null means the row belongs to the shared catalogue, which is every row that
  -- existed before this migration. Non-null means a traveler added it while
  -- planning that specific trip, and it must never be *recommended* on another
  -- one: the composer, the re-planner's substitutes, the compare screen and the
  -- concierge all filter on this. One person's guess should not quietly become
  -- the option another person is offered.
  --
  -- It is deliberately not a visibility rule. The row stays readable like the
  -- rest of the catalogue, because the itinerary that uses it has to join to it
  -- and the operator running the trip has to see what they are being asked to
  -- arrange. The guarantee is "never offered elsewhere", not "invisible".
  add column if not exists added_for_trip uuid references trips (id) on delete cascade;

-- Every filtered read is `added_for_trip is null or added_for_trip = $1`, so the
-- index earns its keep on the common path as well as the private one.
create index if not exists inventory_added_for_trip on inventory (added_for_trip);

comment on column inventory.added_for_trip is
  'Non-null: a traveler added this row for that trip. Never recommend it on any other.';
