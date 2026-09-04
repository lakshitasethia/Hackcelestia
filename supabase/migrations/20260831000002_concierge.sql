-- Voyage — the concierge (Phase 2, Day 7)
--
-- A traveler asking "add a wine tasting on day three" wants the same thing an
-- operator wants after a storm: a plan they can look at before it is real. The
-- machinery for that already exists — `replan_proposals` holds a draft, and
-- `applyProposal` is the only code that turns one into bookings — but it was
-- reachable only through a disruption.
--
-- So this widens who can own a proposal rather than building a second,
-- parallel approval path. One draft table, one apply path, one place where a
-- human says yes.
--
-- Idempotent throughout: a migration that only runs on a virgin database is a
-- migration that fails on demo morning.

-- ------------------------------------------------ proposals without a break --

alter table replan_proposals
  alter column disruption_id drop not null;

alter table replan_proposals
  add column if not exists trip_id uuid references trips on delete cascade,
  -- Derivable from `disruption_id is null`, but named explicitly because the
  -- operator's board has to tell "the agent re-planned a storm" from "the
  -- traveler asked for a change" without inferring it from a null.
  add column if not exists source text not null default 'replan';

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'replan_proposals_source_check') then
    alter table replan_proposals
      add constraint replan_proposals_source_check
      check (source in ('replan', 'concierge'));
  end if;
end $$;

-- Backfill before the constraint, or every existing row fails it.
update replan_proposals p
   set trip_id = d.trip_id
  from disruptions d
 where d.id = p.disruption_id
   and p.trip_id is null;

-- Every proposal belongs to something. A row owned by neither is unreachable
-- from every surface and impossible to apply, which is worse than a rejected
-- insert.
do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'proposals_have_an_owner') then
    alter table replan_proposals
      add constraint proposals_have_an_owner
      check (disruption_id is not null or trip_id is not null);
  end if;
end $$;

create index if not exists proposals_by_trip
  on replan_proposals (trip_id, created_at desc);

-- ----------------------------------------------------------------- policy --

-- The Day 1 policy reached a proposal only through its disruption, so a
-- concierge draft — which has none — was invisible to every reader.
drop policy if exists proposals_via_disruption on replan_proposals;
drop policy if exists proposals_via_owner on replan_proposals;
create policy proposals_via_owner on replan_proposals
  for all using (
    exists (select 1 from disruptions d where d.id = disruption_id)
    or exists (select 1 from trips t where t.id = trip_id)
  )
  with check (
    exists (select 1 from disruptions d where d.id = disruption_id)
    or exists (select 1 from trips t where t.id = trip_id)
  );

-- ------------------------------------------------------- agent run kinds --

-- 'concierge' is the traveler's chat; 'copilot' already existed for the
-- operator's. Both write the same step trace as the re-planner, so a
-- conversation is auditable in exactly the way a re-plan is.
alter table agent_runs drop constraint if exists agent_runs_kind_check;
alter table agent_runs
  add constraint agent_runs_kind_check
  check (kind in ('intake', 'compose', 'replan', 'comms', 'copilot', 'concierge'));

-- Chat itself lives in `messages`, keyed `concierge:<trip>`. No new table: a
-- thread between a traveler and an agent is the same object as a thread
-- between an operator and a vendor, and the existing (thread_key, sent_at)
-- index already orders it.
