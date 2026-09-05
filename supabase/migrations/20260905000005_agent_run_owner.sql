-- An agent run belongs to somebody.
--
-- `runs_via_trip` reads, in full:
--
--   using (trip_id is null or exists (select 1 from trips t where t.id = trip_id))
--
-- The second half is careful — it leans on `trips_read` so a run is visible to
-- exactly the people who can see the trip it is about. The first half hands
-- every run with no trip to every signed-in user, and `scripts/test-rls.mts`
-- has been failing on it ("a stranger reads no agent_runs") since before this
-- change.
--
-- It was a small hole while the only trip-less runs were intake extractions.
-- It stops being small with the research agent: a research run records where
-- somebody is going and when they will be away, and its steps hold the whole
-- research brief. That is a stranger reading your travel dates.
--
-- The `or trip_id is null` clause exists because those runs are genuinely
-- created before any trip does — so the fix is not to delete the clause but to
-- give the run an owner of its own, and check that instead.

alter table agent_runs
  add column if not exists traveler_id uuid references profiles on delete set null;

create index if not exists agent_runs_by_traveler
  on agent_runs (traveler_id, started_at desc);

comment on column agent_runs.traveler_id is
  'Who the run was for, when it happened before any trip existed. Null for system runs, which nobody but the service role reads.';

-- A run is visible to whoever can see its trip, or to whoever asked for it.
-- A run with neither is a system run and is readable by nobody through RLS;
-- the service role, which is what every agent writes with, is unaffected.
drop policy if exists runs_via_trip on agent_runs;
create policy runs_via_trip on agent_runs
  for select using (
    (trip_id is not null and exists (select 1 from trips t where t.id = trip_id))
    or (traveler_id is not null and traveler_id = auth.uid())
  );

-- `steps_via_run` already defers to whatever `agent_runs` allows, so it
-- tightens along with the policy above and needs no change of its own. Said
-- out loud because it is the kind of thing that looks like an omission.
