-- Voyage — the coordinator surface (Phase 2, Day 6)
--
-- Two additions, both driven by the same gap: the plan gives the guide on the
-- ground a lens on the trip, and nothing in the Day 1 schema said which guide,
-- or let them report back.
--
-- Idempotent throughout, because the fastest way to lose a demo is a migration
-- that only runs on a virgin database.

-- ------------------------------------------------------- the assignment --

-- `coordinator_id` is the real edge and what RLS keys off once sign-in lands.
-- `coordinator_name` exists because there is no auth yet: a seeded profile row
-- needs an auth.users row behind it, so the demo names its guide in plain text
-- and the FK stays null until there is an account to point at.
alter table trips
  add column if not exists coordinator_id    uuid references profiles on delete set null,
  add column if not exists coordinator_name  text,
  add column if not exists coordinator_phone text;

create index if not exists trips_coordinator on trips (coordinator_id);

-- -------------------------------------------------- reporting from field --

-- Deliberately a separate axis from `status`. `status` is what the *booking*
-- is doing — planned, confirmed, at risk. `field_state` is what actually
-- happened on the ground, which is the coordinator's to say and nobody else's.
-- Collapsing the two would mean a guide marking a stop finished could not be
-- told apart from an operator confirming a reservation.
alter table itinerary_items
  add column if not exists field_state text not null default 'pending'
    check (field_state in ('pending', 'on_track', 'done', 'issue')),
  add column if not exists field_note text,
  add column if not exists field_updated_at timestamptz;

-- --------------------------------------------------------------- policy --

-- Day 1 left coordinators able to read every trip, with a comment promising to
-- scope it "once assignments exist". They exist now.
drop policy if exists trips_read on trips;
create policy trips_read on trips
  for select using (
    traveler_id = auth.uid()
    or operator_id = current_operator_id()
    or coordinator_id = auth.uid()
  );

-- A coordinator reports on the trip they are running: they may write, but only
-- to the field columns, and only on their own group. Postgres has no
-- column-level RLS, so the column restriction is enforced by a trigger.
drop policy if exists items_field_update on itinerary_items;
create policy items_field_update on itinerary_items
  for update using (
    exists (select 1 from trips t
             where t.id = trip_id and t.coordinator_id = auth.uid())
  );

create or replace function guard_field_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Only applies to a signed-in coordinator; the operator paths and the
  -- service-role writes that drive the agent are untouched.
  if not exists (select 1 from profiles p
                  where p.id = auth.uid() and p.role = 'coordinator') then
    return new;
  end if;

  if (to_jsonb(new) - 'field_state' - 'field_note' - 'field_updated_at' - 'updated_at')
     is distinct from
     (to_jsonb(old) - 'field_state' - 'field_note' - 'field_updated_at' - 'updated_at')
  then
    raise exception 'A coordinator may only update the field columns.';
  end if;

  return new;
end;
$$;

drop trigger if exists items_field_guard on itinerary_items;
create trigger items_field_guard before update on itinerary_items
  for each row execute function guard_field_update();

-- Stamp the reporting time in the database rather than trusting a caller's
-- clock — a phone on the trail is exactly the device whose clock is wrong.
create or replace function touch_field_state()
returns trigger
language plpgsql
as $$
begin
  if new.field_state is distinct from old.field_state
     or new.field_note is distinct from old.field_note then
    new.field_updated_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists items_field_touch on itinerary_items;
create trigger items_field_touch before update on itinerary_items
  for each row execute function touch_field_state();
