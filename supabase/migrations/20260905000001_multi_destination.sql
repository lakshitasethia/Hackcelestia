-- Multi-destination + non-EUR currency.
--
-- The catalogue was single-region by construction: nothing on `inventory` said
-- where an item was except lat/lng, and nothing on `trips` said where the
-- traveler wanted to go. That was fine for one Amalfi group and fatal for
-- anything else — a trip spanning six towns had no way to express itself, and
-- the composer had no way to group a day's stops by place.
--
-- `city` is the unit a day is built around (you sleep in one city per night);
-- `region` is the unit an overnight leg crosses, and is what the composer uses
-- to decide a train is needed rather than a taxi.

alter table inventory add column if not exists city   text;
alter table inventory add column if not exists region text;

create index if not exists inventory_city on inventory (city);

-- Where the traveler asked to go, in their own words, in the order the composer
-- settled on. Kept on the trip rather than derived from the items so that a
-- destination the catalogue could not serve is still visible as a gap.
alter table trips add column if not exists destinations text[] not null default '{}';

-- The currency was defaulted to EUR and read as EUR by the intake prompt, so a
-- rupee budget was silently dropped. The column already existed; what was
-- missing was anything that varied it.
alter table trips alter column currency set default 'INR';

comment on column inventory.city  is 'Town the item happens in; a day is built around one city.';
comment on column inventory.region is 'Coarse grouping (state/coast); a change of region implies an overnight leg.';
comment on column trips.destinations is 'Places asked for, in composed order. Empty means the traveler named none.';
