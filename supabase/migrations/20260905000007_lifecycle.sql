-- Waypoint — the rest of the lifecycle the brief prints.
--
-- PS-7 draws the journey as
--
--   Discover -> Personalize -> Plan -> Price -> Book -> Prepare
--            -> Operate -> Assist -> Adapt -> Complete -> Review
--
-- and lists "payments" among the things an operator must manage centrally.
-- Everything from Discover to Adapt was built. The last two stages were not:
-- `trips.status` has had a 'completed' value since day one that no code path
-- ever set, and nothing anywhere recorded money or a rating.
--
-- Three things here, and they are deliberately small:
--
--   * `payments` — a ledger, not a processor. Rows record what was taken and
--     when. No card is charged; the honest claim is that the operator can see
--     and record what is owed, which is what "manage payments" asks for.
--   * `reviews` — one rating per person per stop, plus a trip-level row where
--     `item_id` is null.
--   * `inventory.tier` — so "accommodation preferences" has something to
--     choose between. The brief names it twice and the catalogue had exactly
--     one hotel per city, which made any preference field theatre.
--
-- Idempotent throughout: a migration that only runs on a virgin database is a
-- migration that fails on demo morning.

-- ------------------------------------------------------- accommodation tier --

-- Coarse on purpose. A traveler says "somewhere simple" or "somewhere nice";
-- they do not say "a 3.5-star property". Four buckets is the resolution the
-- preference is actually expressed at, and the composer ranks within a bucket
-- by the interest matching it already does.
alter table inventory add column if not exists tier text;

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'inventory_tier_check') then
    alter table inventory
      add constraint inventory_tier_check
      check (tier is null or tier in ('budget', 'midrange', 'boutique', 'luxury'));
  end if;
end $$;

comment on column inventory.tier is
  'Lodging bracket for hotels; null for everything else. Matched against trips.prefs.lodging.';

-- Non-hotels can never carry a tier, so a stray value cannot quietly influence
-- the hotel pick.
update inventory set tier = null where type <> 'hotel' and tier is not null;

-- --------------------------------------------------------------- completion --

-- `status = 'completed'` is the flag; this is when it happened. Separate
-- because the operator's board wants to sort by it and a status column cannot
-- be sorted by time.
alter table trips add column if not exists completed_at timestamptz;

comment on column trips.completed_at is
  'When the trip was closed out. Null while it is still running.';

-- ----------------------------------------------------------------- payments --

-- A ledger. Every row is money that moved in the real world and was written
-- down here afterwards; nothing in this codebase talks to a payment processor,
-- and the README says so in as many words.
--
-- `amount` is signed by `kind` rather than by the number: a refund is a
-- positive amount with kind 'refund', so a mis-typed minus sign cannot turn a
-- payment into a refund silently. `paidTotal` in the query layer does the
-- arithmetic.
create table if not exists payments (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references trips on delete cascade,
  -- Optional: a deposit is against the trip, a supplier settlement is against
  -- one booking. Nulling on delete keeps the money visible when a booking is
  -- cancelled, which is exactly when somebody wants to see it.
  booking_id  uuid references bookings on delete set null,
  kind        text not null check (kind in ('deposit', 'balance', 'refund', 'adjustment')),
  amount      numeric(10, 2) not null check (amount >= 0),
  currency    text not null default 'INR',
  method      text not null default 'bank_transfer'
              check (method in ('bank_transfer', 'card', 'cash', 'upi', 'other')),
  reference   text,
  note        text,
  -- Who wrote it down. An operator recording a cash deposit is an audit trail;
  -- null means it came from a script.
  recorded_by uuid references profiles on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists payments_by_trip on payments (trip_id, created_at desc);

-- ------------------------------------------------------------------ reviews --

-- `item_id is null` is the trip-level review — the one the Review stage in the
-- brief is actually about. Per-stop rows are what make it useful to an
-- operator: "the group liked the trip" is a number, "the group rated the
-- Chopta camp 2" is a conversation with a vendor.
create table if not exists reviews (
  id         uuid primary key default gen_random_uuid(),
  trip_id    uuid not null references trips on delete cascade,
  item_id    uuid references itinerary_items on delete cascade,
  author_id  uuid references profiles on delete set null,
  rating     integer not null check (rating between 1 and 5),
  comment    text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One rating per person per stop. Re-rating updates rather than stacking, so a
-- traveler who changes their mind does not double-count against a vendor.
--
-- Both nullable columns are coalesced, and for the same reason: SQL treats two
-- nulls as distinct, so a unique index over a nullable column constrains
-- nothing in exactly the rows you meant it to. `item_id is null` is the
-- trip-level review; `author_id is null` is a row written by a script rather
-- than a person. The second was the one that got through — the index existed,
-- read correctly, and did not apply.
drop index if exists reviews_one_per_author_per_item;
create unique index if not exists reviews_one_per_author_per_item
  on reviews (
    trip_id,
    coalesce(item_id,   '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(author_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

create index if not exists reviews_by_trip on reviews (trip_id, created_at desc);

-- ------------------------------------------------- a traveler's own change --

-- "Compare alternatives" is a stated requirement, and the switch at the end of
-- a comparison is a change to a live itinerary — so it goes through
-- `replan_proposals` and `applyProposal` like every other change, rather than
-- getting a private write path because it happens to be simple.
--
-- It needs its own `source` for one reason: the operator's board has to be able
-- to tell "the agent re-planned a storm" from "the traveler swapped their
-- hotel", and inferring that from a null disruption_id already failed once —
-- which is why 'concierge' exists as a separate value rather than being
-- reconstructed.
alter table replan_proposals drop constraint if exists replan_proposals_source_check;
alter table replan_proposals
  add constraint replan_proposals_source_check
  check (source in ('replan', 'concierge', 'traveler'));

-- ------------------------------------------------------------------- policy --

alter table payments enable row level security;
alter table reviews  enable row level security;

-- Both hang off a trip and inherit its visibility, exactly as
-- `items_via_trip` and `bookings_via_trip` do. The subquery carries no auth
-- check of its own and works only because Postgres applies `trips`' RLS to it
-- — the same assumption `scripts/test-rls.mts` exists to prove, now covering
-- two more tables.
drop policy if exists payments_via_trip on payments;
create policy payments_via_trip on payments
  for all using (exists (select 1 from trips t where t.id = trip_id))
  with check (exists (select 1 from trips t where t.id = trip_id));

drop policy if exists reviews_via_trip on reviews;
create policy reviews_via_trip on reviews
  for all using (exists (select 1 from trips t where t.id = trip_id))
  with check (exists (select 1 from trips t where t.id = trip_id));
