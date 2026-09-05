-- Do not research the same trip twice.
--
-- A research pass costs about 40,000 Groq tokens: one shape search plus a web
-- search per town. The free tier allows 200,000 a day *per organization* — not
-- per key, so rotating the key changes nothing — which is five runs. Rehearsing
-- a demo, or two people trying the same prompt, exhausts a day in an afternoon.
--
-- It is also just wrong on its own terms. Lucerne's museums do not move between
-- Tuesday and Wednesday, and the second person to ask for Switzerland should
-- not pay to discover the Matterhorn again.
--
-- Two layers cache this, and they fail differently on purpose:
--
--   * This table caches a whole result against the spec that produced it, so an
--     identical prompt costs nothing at all.
--   * `inventory.sourced_at` (already there) lets a *different* prompt for the
--     same town skip that town's web pass and read the rows back. Cheap rather
--     than free, and it is what makes the second Swiss trip fast even when it
--     asks for something else.
create table if not exists research_cache (
  -- sha256 of the parts of a spec that change what gets researched. Not the
  -- prose: two people phrasing the same fortnight differently should share.
  fingerprint text primary key,
  -- Kept for debugging, so a surprising hit can be explained rather than
  -- guessed at.
  destinations text[] not null default '{}',
  day_count    integer,
  result       jsonb not null,
  hits         integer not null default 0,
  created_at   timestamptz not null default now(),
  used_at      timestamptz not null default now()
);

comment on table research_cache is
  'Whole research results, keyed by the spec that produced them. Prices go stale; see the TTL in research.ts.';
comment on column research_cache.fingerprint is
  'sha256 over destinations, trip length, interests, must-dos and currency. Deliberately not the raw description.';

-- Nothing user-facing reads this; the agent reads it with the service role.
-- Denying everyone through RLS is the honest default rather than an oversight.
alter table research_cache enable row level security;
