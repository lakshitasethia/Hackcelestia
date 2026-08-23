-- Voyage — seed data (Phase 2, Day 1)
--
-- One operator, one Amalfi Coast group of two, five days. Dates are computed
-- from current_date so the trip is always "starting today" whenever this runs —
-- a demo that only works on the day it was seeded is a demo that fails on stage.
--
-- Fixed UUIDs throughout so the demo is reproducible and the disruption
-- injector can target a known item. Idempotent: safe to re-run.

begin;

-- Wipe in FK order so re-seeding is clean.
delete from agent_steps;
delete from agent_runs;
delete from replan_proposals;
delete from disruptions;
delete from messages;
delete from bookings;
delete from itinerary_items;
delete from trips;
delete from availability;
delete from inventory;
delete from vendors;
delete from operators;

-- ------------------------------------------------------------- operator --

insert into operators (id, name, contact) values
  ('0d000000-0000-4000-a000-000000000001', 'Costiera DMC', 'ops@costiera-dmc.example');

-- -------------------------------------------------------------- vendors --

insert into vendors (id, operator_id, name, type, email, phone, channel, reliability) values
  ('0e000000-0000-4000-a000-000000000001', '0d000000-0000-4000-a000-000000000001',
   'Hotel Le Sirene, Positano', 'hotel', 'front@lesirene.example', '+39 089 000 001', 'manual', 0.97),
  ('0e000000-0000-4000-a000-000000000002', '0d000000-0000-4000-a000-000000000001',
   'Amalfi Blue Charters', 'activity', 'bookings@amalfiblue.example', '+39 089 000 002', 'auto', 0.88),
  ('0e000000-0000-4000-a000-000000000003', '0d000000-0000-4000-a000-000000000001',
   'Costiera Transfers', 'transport', 'dispatch@costiera-tx.example', '+39 089 000 003', 'auto', 0.94),
  ('0e000000-0000-4000-a000-000000000004', '0d000000-0000-4000-a000-000000000001',
   'Trattoria da Enzo', 'restaurant', 'enzo@daenzo.example', '+39 089 000 004', 'manual', 0.92),
  ('0e000000-0000-4000-a000-000000000005', '0d000000-0000-4000-a000-000000000001',
   'Cucina Amalfitana (cooking school)', 'activity', 'ciao@cucina-am.example', '+39 089 000 005', 'auto', 0.96),
  ('0e000000-0000-4000-a000-000000000006', '0d000000-0000-4000-a000-000000000001',
   'Marco Ferrara — licensed guide', 'guide', 'marco@guides.example', '+39 089 000 006', 'auto', 0.99);

-- ------------------------------------------------------------ inventory --
-- weather_sensitive is what lets a storm find the right items to threaten.

insert into inventory
  (id, vendor_id, title, type, description, duration_min, base_cost, lat, lng, opens_at, closes_at, tags, weather_sensitive)
values
  ('19000000-0000-4000-a000-000000000001', '0e000000-0000-4000-a000-000000000001',
   'Sea-view double, Hotel Le Sirene', 'hotel',
   'Cliffside room above Spiaggia Grande.', 1440, 320.00, 40.6281, 14.4850, null, null,
   '{coastal,boutique}', false),

  ('19000000-0000-4000-a000-000000000002', '0e000000-0000-4000-a000-000000000002',
   'Private boat day to Capri', 'activity',
   'Skippered gozzo, Positano to Capri and the Faraglioni.', 420, 780.00, 40.6270, 14.4840,
   '08:00', '18:00', '{water,scenic,signature}', true),

  ('19000000-0000-4000-a000-000000000003', '0e000000-0000-4000-a000-000000000003',
   'Private transfer, hotel to marina', 'transport',
   'Driver meets at hotel steps.', 25, 45.00, 40.6281, 14.4850, '06:00', '23:00',
   '{transfer}', false),

  ('19000000-0000-4000-a000-000000000004', '0e000000-0000-4000-a000-000000000004',
   'Lunch at Trattoria da Enzo', 'restaurant',
   'Terrace table, two courses.', 90, 110.00, 40.5510, 14.2430, '12:00', '15:30',
   '{food}', false),

  ('19000000-0000-4000-a000-000000000005', '0e000000-0000-4000-a000-000000000004',
   'Dinner at Trattoria da Enzo', 'restaurant',
   'Terrace table, tasting menu.', 120, 180.00, 40.6285, 14.4855, '19:00', '23:00',
   '{food}', false),

  -- The substitutes. Indoor and weather-proof, so the re-planner has somewhere
  -- to go when the boat day dies.
  ('19000000-0000-4000-a000-000000000006', '0e000000-0000-4000-a000-000000000005',
   'Amalfitana cooking class', 'activity',
   'Covered courtyard kitchen; runs in any weather.', 240, 290.00, 40.6290, 14.4860,
   '09:00', '17:00', '{food,indoor,hands-on}', false),

  ('19000000-0000-4000-a000-000000000007', '0e000000-0000-4000-a000-000000000006',
   'Guided walk: Path of the Gods', 'guide',
   'Ridge trail, Bomerano to Nocelle.', 300, 210.00, 40.6350, 14.5100,
   '07:00', '16:00', '{hiking,scenic}', true),

  ('19000000-0000-4000-a000-000000000008', '0e000000-0000-4000-a000-000000000006',
   'Villa Rufolo & Ravello cloisters tour', 'guide',
   'Mostly indoor; gardens optional.', 180, 150.00, 40.6490, 14.6110,
   '09:00', '18:00', '{culture,indoor}', false);

-- --------------------------------------------------------- availability --
-- Five days of slots for every substitute, so search_availability has real
-- rows to return rather than an empty set that makes the agent look broken.

insert into availability (inventory_id, date, starts_at, slots_total, slots_taken, price)
select
  inv.id,
  (current_date + d)::date,
  (current_date + d) + inv.default_start,
  inv.slots,
  0,
  inv.price
from (
  values
    ('19000000-0000-4000-a000-000000000002'::uuid, time '09:00', 3, 780.00),
    ('19000000-0000-4000-a000-000000000006'::uuid, time '10:00', 8, 290.00),
    ('19000000-0000-4000-a000-000000000007'::uuid, time '08:00', 6, 210.00),
    ('19000000-0000-4000-a000-000000000008'::uuid, time '10:00', 10, 150.00),
    ('19000000-0000-4000-a000-000000000004'::uuid, time '12:30', 12, 110.00),
    ('19000000-0000-4000-a000-000000000005'::uuid, time '20:00', 12, 180.00)
) as inv(id, default_start, slots, price)
cross join generate_series(0, 4) as d;

-- ------------------------------------------------------------ the trip --

insert into trips
  (id, traveler_id, operator_id, title, contact_name, contact_email, contact_phone,
   status, party_size, budget, currency, starts_on, ends_on, prefs)
values
  ('7a000000-0000-4000-a000-000000000001', null, '0d000000-0000-4000-a000-000000000001',
   'Amalfi Coast — Sharma party', 'Ananya Sharma', 'ananya@example.com', '+91 98000 00000',
   'in_progress', 2, 4500.00, 'EUR', current_date, current_date + 4,
   '{"interests":["food","scenic","water"],"pace":"relaxed","dietary":["vegetarian"],
     "mobility":"no steep climbs","style":"boutique"}'::jsonb);

-- --------------------------------------------------- itinerary (the DAG) --
--
-- Day 2 is the demo. The chain is:
--
--   hotel ──> transfer ──> boat ──┬──> lunch
--                                 └──> return transfer ──> dinner
--
-- Kill the boat and four items downstream go with it. The hotel is locked
-- (non-refundable), which the re-planner has to respect and explain.

insert into itinerary_items
  (id, trip_id, day, seq, inventory_id, vendor_id, title, type, starts_at, ends_at,
   lat, lng, cost, status, depends_on, lock_reason)
values
  -- Day 1
  ('17000000-0000-4000-a000-000000000001', '7a000000-0000-4000-a000-000000000001', 1, 1,
   '19000000-0000-4000-a000-000000000001', '0e000000-0000-4000-a000-000000000001',
   'Check in — Hotel Le Sirene', 'hotel',
   current_date + time '15:00', current_date + time '16:00',
   40.6281, 14.4850, 1280.00, 'confirmed', '{}',
   'Non-refundable rate — 4 nights prepaid'),

  ('17000000-0000-4000-a000-000000000002', '7a000000-0000-4000-a000-000000000001', 1, 2,
   '19000000-0000-4000-a000-000000000005', '0e000000-0000-4000-a000-000000000004',
   'Dinner — Trattoria da Enzo', 'restaurant',
   current_date + time '20:00', current_date + time '22:00',
   40.6285, 14.4855, 180.00, 'confirmed',
   '{17000000-0000-4000-a000-000000000001}', null),

  -- Day 2 — the one the storm hits
  ('17000000-0000-4000-a000-000000000010', '7a000000-0000-4000-a000-000000000001', 2, 1,
   '19000000-0000-4000-a000-000000000003', '0e000000-0000-4000-a000-000000000003',
   'Transfer — hotel to Positano marina', 'transport',
   (current_date + 1) + time '08:20', (current_date + 1) + time '08:45',
   40.6281, 14.4850, 45.00, 'confirmed',
   '{17000000-0000-4000-a000-000000000001}', null),

  ('17000000-0000-4000-a000-000000000011', '7a000000-0000-4000-a000-000000000001', 2, 2,
   '19000000-0000-4000-a000-000000000002', '0e000000-0000-4000-a000-000000000002',
   'Private boat day to Capri', 'activity',
   (current_date + 1) + time '09:00', (current_date + 1) + time '16:00',
   40.6270, 14.4840, 780.00, 'confirmed',
   '{17000000-0000-4000-a000-000000000010}', null),

  ('17000000-0000-4000-a000-000000000012', '7a000000-0000-4000-a000-000000000001', 2, 3,
   '19000000-0000-4000-a000-000000000004', '0e000000-0000-4000-a000-000000000004',
   'Lunch ashore on Capri', 'restaurant',
   (current_date + 1) + time '12:30', (current_date + 1) + time '14:00',
   40.5510, 14.2430, 110.00, 'confirmed',
   '{17000000-0000-4000-a000-000000000011}', null),

  ('17000000-0000-4000-a000-000000000013', '7a000000-0000-4000-a000-000000000001', 2, 4,
   '19000000-0000-4000-a000-000000000003', '0e000000-0000-4000-a000-000000000003',
   'Transfer — marina to hotel', 'transport',
   (current_date + 1) + time '16:15', (current_date + 1) + time '16:40',
   40.6270, 14.4840, 45.00, 'confirmed',
   '{17000000-0000-4000-a000-000000000011}', null),

  ('17000000-0000-4000-a000-000000000014', '7a000000-0000-4000-a000-000000000001', 2, 5,
   '19000000-0000-4000-a000-000000000005', '0e000000-0000-4000-a000-000000000004',
   'Dinner — Trattoria da Enzo', 'restaurant',
   (current_date + 1) + time '20:00', (current_date + 1) + time '22:00',
   40.6285, 14.4855, 180.00, 'confirmed',
   '{17000000-0000-4000-a000-000000000013}', null),

  -- Day 3
  ('17000000-0000-4000-a000-000000000020', '7a000000-0000-4000-a000-000000000001', 3, 1,
   '19000000-0000-4000-a000-000000000008', '0e000000-0000-4000-a000-000000000006',
   'Ravello — Villa Rufolo with Marco', 'guide',
   (current_date + 2) + time '10:00', (current_date + 2) + time '13:00',
   40.6490, 14.6110, 150.00, 'confirmed',
   '{17000000-0000-4000-a000-000000000001}', null);

-- ------------------------------------------------------------ bookings --
-- Penalties are what make the re-planner's cost deltas honest: cancelling the
-- boat this close in costs real money, and the agent has to say so.

insert into bookings (trip_id, item_id, vendor_id, state, amount, penalty, external_ref)
values
  ('7a000000-0000-4000-a000-000000000001', '17000000-0000-4000-a000-000000000001',
   '0e000000-0000-4000-a000-000000000001', 'confirmed', 1280.00, 1280.00, 'LS-4471'),
  ('7a000000-0000-4000-a000-000000000001', '17000000-0000-4000-a000-000000000011',
   '0e000000-0000-4000-a000-000000000002', 'confirmed', 780.00, 195.00, 'ABC-8820'),
  ('7a000000-0000-4000-a000-000000000001', '17000000-0000-4000-a000-000000000010',
   '0e000000-0000-4000-a000-000000000003', 'confirmed', 45.00, 0.00, 'CTX-1190'),
  ('7a000000-0000-4000-a000-000000000001', '17000000-0000-4000-a000-000000000013',
   '0e000000-0000-4000-a000-000000000003', 'confirmed', 45.00, 0.00, 'CTX-1191'),
  ('7a000000-0000-4000-a000-000000000001', '17000000-0000-4000-a000-000000000012',
   '0e000000-0000-4000-a000-000000000004', 'confirmed', 110.00, 0.00, 'DE-3301'),
  ('7a000000-0000-4000-a000-000000000001', '17000000-0000-4000-a000-000000000014',
   '0e000000-0000-4000-a000-000000000004', 'confirmed', 180.00, 0.00, 'DE-3302'),
  ('7a000000-0000-4000-a000-000000000001', '17000000-0000-4000-a000-000000000020',
   '0e000000-0000-4000-a000-000000000006', 'confirmed', 150.00, 0.00, 'MF-0075');

commit;
