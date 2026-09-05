-- Transport inventory says where it goes.
--
-- The router walked a hand-written table of legs in `src/lib/agent/corridor.ts`,
-- with the catalogue's UUIDs pasted into it. That made the corridor code, so a
-- new region meant a code change, a deploy, and a second place to forget — and
-- the composer's "which towns do we serve" list had already drifted out of sync
-- with it once.
--
-- A transport row already knows where it starts (`city`). This is the other
-- half. With it the leg graph is a query, the served-city set is a query, and
-- adding a country is an INSERT.
alter table inventory add column if not exists to_city text;

-- Overnight legs eat the night rather than an afternoon, which changes how many
-- calendar days a route costs. Derivable from duration, but not reliably: a
-- twelve-hour day coach and a twelve-hour sleeper are the same number.
alter table inventory add column if not exists overnight boolean not null default false;

create index if not exists inventory_to_city on inventory (to_city);

comment on column inventory.to_city is
  'Destination town for a transport row; null for everything else. With city, this is one edge of the route graph.';
comment on column inventory.overnight is
  'True when the journey consumes the night, so no bed is booked at either end.';

-- Backfill the north-India corridor from the hand-written table this replaces.
--
-- Keyed on the seeded UUIDs rather than parsed out of the titles: a title is a
-- label, and "Shared cab: Chopta → Auli" is one rename away from silently
-- deleting an edge of the route graph.
update inventory set to_city = v.to_city, overnight = v.overnight
  from (values
    ('29000000-0000-4000-a000-000000000010'::uuid, 'Amritsar',   true),
    ('29000000-0000-4000-a000-000000000011'::uuid, 'Chandigarh', false),
    ('29000000-0000-4000-a000-000000000012'::uuid, 'Manali',     true),
    ('29000000-0000-4000-a000-000000000013'::uuid, 'Haridwar',   true),
    ('29000000-0000-4000-a000-000000000014'::uuid, 'Rishikesh',  false),
    ('29000000-0000-4000-a000-000000000015'::uuid, 'Chopta',     false),
    ('29000000-0000-4000-a000-000000000016'::uuid, 'Auli',       false),
    ('29000000-0000-4000-a000-000000000017'::uuid, 'Haridwar',   false),
    ('29000000-0000-4000-a000-000000000018'::uuid, 'Delhi',      false)
  ) as v(id, to_city, overnight)
 where inventory.id = v.id;
