-- A proposal can now come from what a supplier wrote back.
--
-- `source` already distinguishes "the agent re-planned a storm" from "the
-- traveler asked for a change", and the reason given at the time was that the
-- operator's board has to tell them apart without inferring it from a null.
-- The same argument applies here and more strongly: a proposal that exists
-- because the boat operator said "not at 9, but we could do 2" is not the
-- agent's idea, and crediting the agent for it would make the trace lie about
-- where a decision came from.
--
-- Idempotent: drops the constraint by name before re-adding it, so re-running
-- this on a database that already has the wider check is a no-op rather than a
-- duplicate-object error.

alter table replan_proposals drop constraint if exists replan_proposals_source_check;
alter table replan_proposals
  add constraint replan_proposals_source_check
  check (source in ('replan', 'concierge', 'traveler', 'vendor'));
