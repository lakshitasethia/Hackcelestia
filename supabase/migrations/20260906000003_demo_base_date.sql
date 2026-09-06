-- The day the seeded demo is anchored to.
--
-- Every date in the seed is computed from `current_date`, so the trip is always
-- "starting today" whoever runs it and whenever. That is the right default and
-- it stays the default. What it cannot do is give you the *same* trip twice on
-- two different days — and a demo video recorded in two sittings a fortnight
-- apart shows one segment dated the 6th and the next dated the 20th, which is
-- exactly the sort of seam that makes a viewer stop believing what they are
-- watching.
--
-- So the seed anchors to this function instead. Unset, it is `current_date` and
-- nothing changes. Set — via `DEMO_DATE` in .env.local, which `scripts/sql.mjs`
-- turns into the session setting below — every date in the seed is computed
-- from that day instead.
--
-- **It has a partner.** Pinning the seed alone would be worse than useless: the
-- trip would claim to start on a day the application still thinks is in the
-- past, so the guide's run sheet would empty and the lifecycle rail would say
-- the trip had finished. `DEMO_DATE` is read by `src/lib/format.ts` too, and
-- moves the app's notion of "today" with it. Use one and you use both.

create or replace function demo_base_date() returns date
language sql
stable
as $$
  -- `true` on current_setting means "null if unset" rather than an error, which
  -- is what makes the unset case fall through to today.
  select coalesce(
    nullif(current_setting('voyage.base_date', true), '')::date,
    current_date
  )
$$;

comment on function demo_base_date() is
  'The day the seed is anchored to: voyage.base_date if set, else current_date.';
