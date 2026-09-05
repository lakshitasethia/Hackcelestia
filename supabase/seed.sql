-- Voyage — seed data (Phase 2, Day 1)
--
-- One operator, one Amalfi Coast group of two, five days. Dates are computed
-- from current_date so the trip is always "starting today" whenever this runs —
-- a demo that only works on the day it was seeded is a demo that fails on stage.
--
-- Fixed UUIDs throughout so the demo is reproducible and the disruption
-- injector can target a known item. Idempotent: safe to re-run.
--
-- Every time is written `... at time zone 'Europe/Rome'`. Without it, a bare
-- `current_date + time '09:00'` is a naive timestamp that Postgres casts using
-- the *server's* zone (UTC on Supabase), so a 09:00 boat departure silently
-- becomes 11:00 in Positano.

begin;

-- Wipe in FK order so re-seeding is clean.
-- Proposals first: a proposal outlives the trip it built (`trip_id` is ON
-- DELETE SET NULL), so leaving them behind means a reset hands you a plan that
-- still offers "Yes, build this trip" — against researched inventory rows this
-- same script is about to delete. Accepting one then fails inside `addItem`
-- with "trip or inventory missing", which is a confusing way to learn that the
-- catalogue was reseeded underneath it.
delete from trip_proposals;
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
   '09:00', '18:00', '{culture,indoor}', false),

  -- Depth matters: a re-planner with two options looks like a lookup table, and
  -- a user who builds their own itinerary can exhaust a thin catalogue and leave
  -- the agent nothing to propose. These widen the search space across price,
  -- type, location and weather exposure.
  ('19000000-0000-4000-a000-000000000009', '0e000000-0000-4000-a000-000000000005',
   'Pasta & pastry morning, Praiano', 'activity',
   'Small-group kitchen, covered terrace.', 180, 165.00, 40.6110, 14.5290,
   '09:00', '13:00', '{food,indoor,hands-on}', false),

  ('19000000-0000-4000-a000-00000000000a', '0e000000-0000-4000-a000-000000000006',
   'Pompeii half-day with archaeologist', 'guide',
   'Mostly open-air but runs in light rain.', 300, 240.00, 40.7500, 14.4850,
   '08:30', '16:00', '{culture,history}', false),

  ('19000000-0000-4000-a000-00000000000b', '0e000000-0000-4000-a000-000000000006',
   'Ceramics studio, Vietri sul Mare', 'activity',
   'Indoor workshop, wheel and glaze.', 150, 120.00, 40.6720, 14.7280,
   '10:00', '17:00', '{craft,indoor,hands-on}', false),

  ('19000000-0000-4000-a000-00000000000c', '0e000000-0000-4000-a000-000000000002',
   'Sunset cruise, Li Galli islands', 'activity',
   'Two hours out and back at golden hour.', 120, 320.00, 40.6265, 14.4835,
   '18:00', '21:00', '{water,scenic,romantic}', true),

  ('19000000-0000-4000-a000-00000000000d', '0e000000-0000-4000-a000-000000000006',
   'Lemon grove walk & tasting, Minori', 'guide',
   'Terraced groves; shelter on site.', 120, 85.00, 40.6490, 14.6280,
   '09:00', '16:00', '{food,scenic,relaxed}', false),

  ('19000000-0000-4000-a000-00000000000e', '0e000000-0000-4000-a000-000000000002',
   'Kayak the Furore fjord', 'activity',
   'Guided paddle along the cliffs.', 180, 145.00, 40.6180, 14.5510,
   '08:00', '15:00', '{water,active}', true),

  ('19000000-0000-4000-a000-00000000000f', '0e000000-0000-4000-a000-000000000006',
   'Amalfi paper museum & cathedral', 'guide',
   'Entirely indoors.', 120, 95.00, 40.6340, 14.6030,
   '09:30', '18:00', '{culture,indoor,history}', false),

  ('19000000-0000-4000-a000-000000000010', '0e000000-0000-4000-a000-000000000004',
   'Chef''s table dinner, Positano', 'restaurant',
   'Six courses, indoor dining room.', 150, 260.00, 40.6288, 14.4842,
   '19:30', '23:00', '{food,fine-dining,indoor}', false),

  ('19000000-0000-4000-a000-000000000011', '0e000000-0000-4000-a000-000000000003',
   'Private driver, full day', 'transport',
   'Car and driver at your disposal.', 480, 380.00, 40.6281, 14.4850,
   '07:00', '22:00', '{transfer,flexible}', false),

  ('19000000-0000-4000-a000-000000000012', '0e000000-0000-4000-a000-000000000005',
   'Wine tasting, Tramonti hills', 'activity',
   'Cellar tasting, indoor.', 180, 130.00, 40.7020, 14.6320,
   '11:00', '18:00', '{food,indoor,relaxed}', false);

-- --------------------------------------------------------- availability --
-- Five days of slots for every substitute, so search_availability has real
-- rows to return rather than an empty set that makes the agent look broken.

insert into availability (inventory_id, date, starts_at, slots_total, slots_taken, price)
select
  inv.id,
  (current_date + d)::date,
  ((current_date + d) + inv.default_start) at time zone 'Europe/Rome',
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
    ('19000000-0000-4000-a000-000000000005'::uuid, time '20:00', 12, 180.00),
    ('19000000-0000-4000-a000-000000000009'::uuid, time '09:30', 10, 165.00),
    ('19000000-0000-4000-a000-00000000000a'::uuid, time '08:30', 15, 240.00),
    ('19000000-0000-4000-a000-00000000000b'::uuid, time '10:30', 8,  120.00),
    ('19000000-0000-4000-a000-00000000000c'::uuid, time '18:30', 6,  320.00),
    ('19000000-0000-4000-a000-00000000000d'::uuid, time '10:00', 12, 85.00),
    ('19000000-0000-4000-a000-00000000000e'::uuid, time '08:00', 8,  145.00),
    ('19000000-0000-4000-a000-00000000000f'::uuid, time '11:00', 20, 95.00),
    ('19000000-0000-4000-a000-000000000010'::uuid, time '19:30', 10, 260.00),
    ('19000000-0000-4000-a000-000000000011'::uuid, time '08:00', 4,  380.00),
    ('19000000-0000-4000-a000-000000000012'::uuid, time '11:00', 10, 130.00)
) as inv(id, default_start, slots, price)
cross join generate_series(0, 4) as d;

-- ------------------------------------------------------------ the trip --

insert into trips
  (id, traveler_id, operator_id, title, contact_name, contact_email, contact_phone,
   coordinator_name, coordinator_phone,
   status, party_size, budget, currency, starts_on, ends_on, prefs)
values
  ('7a000000-0000-4000-a000-000000000001', null, '0d000000-0000-4000-a000-000000000001',
   'Amalfi Coast — Sharma party', 'Ananya Sharma', 'ananya@example.com', '+91 98000 00000',
   -- The guide on the ground. Named in plain text rather than joined to a
   -- profile because profiles hang off auth.users, and there is no sign-in yet.
   'Marco Ferrara', '+39 089 000 006',
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
   ((current_date + time '15:00') at time zone 'Europe/Rome'), ((current_date + time '16:00') at time zone 'Europe/Rome'),
   40.6281, 14.4850, 1280.00, 'confirmed', '{}',
   'Non-refundable rate — 4 nights prepaid'),

  ('17000000-0000-4000-a000-000000000002', '7a000000-0000-4000-a000-000000000001', 1, 2,
   '19000000-0000-4000-a000-000000000005', '0e000000-0000-4000-a000-000000000004',
   'Dinner — Trattoria da Enzo', 'restaurant',
   ((current_date + time '20:00') at time zone 'Europe/Rome'), ((current_date + time '22:00') at time zone 'Europe/Rome'),
   40.6285, 14.4855, 180.00, 'confirmed',
   '{17000000-0000-4000-a000-000000000001}', null),

  -- Day 2 — the one the storm hits
  ('17000000-0000-4000-a000-000000000010', '7a000000-0000-4000-a000-000000000001', 2, 1,
   '19000000-0000-4000-a000-000000000003', '0e000000-0000-4000-a000-000000000003',
   'Transfer — hotel to Positano marina', 'transport',
   (((current_date + 1) + time '08:20') at time zone 'Europe/Rome'), (((current_date + 1) + time '08:45') at time zone 'Europe/Rome'),
   40.6281, 14.4850, 45.00, 'confirmed',
   '{17000000-0000-4000-a000-000000000001}', null),

  ('17000000-0000-4000-a000-000000000011', '7a000000-0000-4000-a000-000000000001', 2, 2,
   '19000000-0000-4000-a000-000000000002', '0e000000-0000-4000-a000-000000000002',
   'Private boat day to Capri', 'activity',
   (((current_date + 1) + time '09:00') at time zone 'Europe/Rome'), (((current_date + 1) + time '16:00') at time zone 'Europe/Rome'),
   40.6270, 14.4840, 780.00, 'confirmed',
   '{17000000-0000-4000-a000-000000000010}', null),

  ('17000000-0000-4000-a000-000000000012', '7a000000-0000-4000-a000-000000000001', 2, 3,
   '19000000-0000-4000-a000-000000000004', '0e000000-0000-4000-a000-000000000004',
   'Lunch ashore on Capri', 'restaurant',
   (((current_date + 1) + time '12:30') at time zone 'Europe/Rome'), (((current_date + 1) + time '14:00') at time zone 'Europe/Rome'),
   40.5510, 14.2430, 110.00, 'confirmed',
   '{17000000-0000-4000-a000-000000000011}', null),

  ('17000000-0000-4000-a000-000000000013', '7a000000-0000-4000-a000-000000000001', 2, 4,
   '19000000-0000-4000-a000-000000000003', '0e000000-0000-4000-a000-000000000003',
   'Transfer — marina to hotel', 'transport',
   (((current_date + 1) + time '16:15') at time zone 'Europe/Rome'), (((current_date + 1) + time '16:40') at time zone 'Europe/Rome'),
   40.6270, 14.4840, 45.00, 'confirmed',
   '{17000000-0000-4000-a000-000000000011}', null),

  ('17000000-0000-4000-a000-000000000014', '7a000000-0000-4000-a000-000000000001', 2, 5,
   '19000000-0000-4000-a000-000000000005', '0e000000-0000-4000-a000-000000000004',
   'Dinner — Trattoria da Enzo', 'restaurant',
   (((current_date + 1) + time '20:00') at time zone 'Europe/Rome'), (((current_date + 1) + time '22:00') at time zone 'Europe/Rome'),
   40.6285, 14.4855, 180.00, 'confirmed',
   '{17000000-0000-4000-a000-000000000013}', null),

  -- Day 3
  ('17000000-0000-4000-a000-000000000020', '7a000000-0000-4000-a000-000000000001', 3, 1,
   '19000000-0000-4000-a000-000000000008', '0e000000-0000-4000-a000-000000000006',
   'Ravello — Villa Rufolo with Marco', 'guide',
   (((current_date + 2) + time '10:00') at time zone 'Europe/Rome'), (((current_date + 2) + time '13:00') at time zone 'Europe/Rome'),
   40.6490, 14.6110, 150.00, 'confirmed',
   '{17000000-0000-4000-a000-000000000001}', null);

-- ------------------------------------------------------------ bookings --
-- Penalties are what make the re-planner's cost deltas honest: cancelling the
-- boat this close in costs real money, and the agent has to say so.

insert into bookings (trip_id, item_id, vendor_id, state, amount, penalty, external_ref)
values
  ('7a000000-0000-4000-a000-000000000001', '17000000-0000-4000-a000-000000000001',
   '0e000000-0000-4000-a000-000000000001', 'confirmed', 1280.00, 1280.00, 'LS-4471'),
  -- Tonight's dinner. Missing until an end-to-end check noticed that one
  -- confirmed stop had nothing reserved behind it, which quietly understated
  -- the operator's booked value. verify.sql now refuses to let that recur.
  ('7a000000-0000-4000-a000-000000000001', '17000000-0000-4000-a000-000000000002',
   '0e000000-0000-4000-a000-000000000004', 'confirmed', 180.00, 0.00, 'DE-3300'),
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
