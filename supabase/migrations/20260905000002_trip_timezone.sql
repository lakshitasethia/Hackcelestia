-- A trip carries its own timezone.
--
-- `TRIP_TZ` was a module constant set to Europe/Rome, which was true of every
-- trip in the database and stopped being true the moment the catalogue crossed
-- a border. Item times are stored as timestamptz so the instants were always
-- right; what was wrong was the rendering — a 04:00 departure for the
-- Chandrashila summit displayed as 00:30 the night before, which is not a
-- typo a traveler can be expected to see past.
alter table trips add column if not exists time_zone text not null default 'Europe/Rome';

comment on column trips.time_zone is
  'IANA zone the itinerary is read in. Item times are absolute; this is display.';
