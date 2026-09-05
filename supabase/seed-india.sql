-- Waypoint — North India catalogue.
--
-- Seeded ALONGSIDE the Amalfi rows, not instead of them. The disruption demo
-- targets fixed Amalfi UUIDs (19000000-…) and every re-planner test asserts
-- against them, so replacing that catalogue would have traded one working
-- surface for another. India uses the 29000000-… prefix throughout.
--
-- Prices are INR and deliberately budget-tier: sleeper/3A rail, hostels and
-- shared cabs, because the scenario this was built for is ~₹32,000 for one
-- person over nine days. A catalogue priced for comfort travel would make the
-- composer's budget arithmetic honest and its answer useless.

begin;

delete from availability where inventory_id in
  (select id from inventory where id::text like '29000000%');
delete from inventory where id::text like '29000000%';
delete from vendors   where id::text like '2e000000%';
delete from operators where id = '2a000000-0000-4000-a000-000000000001';

insert into operators (id, name, contact) values
  ('2a000000-0000-4000-a000-000000000001', 'Himalaya Rail & Trail',
   'desk@himalayarail.example')
on conflict (id) do nothing;

insert into vendors (id, operator_id, name, type, email, phone, channel, reliability) values
  ('2e000000-0000-4000-a000-000000000001', '2a000000-0000-4000-a000-000000000001',
   'IRCTC rail booking', 'transport', 'rail@himalayarail.example', '+91-11-0000-0001', 'auto', 0.82),
  ('2e000000-0000-4000-a000-000000000002', '2a000000-0000-4000-a000-000000000001',
   'HRTC / HPTDC coaches', 'transport', 'coach@himalayarail.example', '+91-11-0000-0002', 'auto', 0.75),
  ('2e000000-0000-4000-a000-000000000003', '2a000000-0000-4000-a000-000000000001',
   'Zostel & partner hostels', 'hotel', 'stay@himalayarail.example', '+91-11-0000-0003', 'auto', 0.90),
  ('2e000000-0000-4000-a000-000000000004', '2a000000-0000-4000-a000-000000000001',
   'Red Chilli Adventure, Rishikesh', 'activity', 'raft@himalayarail.example', '+91-135-000-0004', 'manual', 0.88),
  ('2e000000-0000-4000-a000-000000000005', '2a000000-0000-4000-a000-000000000001',
   'Chopta Meadows Camp', 'hotel', 'camp@himalayarail.example', '+91-137-000-0005', 'manual', 0.70),
  ('2e000000-0000-4000-a000-000000000006', '2a000000-0000-4000-a000-000000000001',
   'Garhwal trek guides collective', 'guide', 'trek@himalayarail.example', '+91-137-000-0006', 'manual', 0.78),
  ('2e000000-0000-4000-a000-000000000007', '2a000000-0000-4000-a000-000000000001',
   'Solang & Gorson stables', 'activity', 'horse@himalayarail.example', '+91-190-000-0007', 'manual', 0.65),
  ('2e000000-0000-4000-a000-000000000008', '2a000000-0000-4000-a000-000000000001',
   'Local kitchens & food walks', 'restaurant', 'food@himalayarail.example', '+91-11-0000-0008', 'auto', 0.92),
  ('2e000000-0000-4000-a000-000000000009', '2a000000-0000-4000-a000-000000000001',
   'Auli ropeway & GMVN', 'activity', 'auli@himalayarail.example', '+91-137-000-0009', 'auto', 0.80)
on conflict (id) do nothing;

-- ------------------------------------------------------------ inventory --
-- weather_sensitive is what lets a disruption find the right things to
-- threaten. In Garhwal that is most of the value of the trip: the ropeway, the
-- summit push and every mountain road leg stop in weather that leaves the
-- Golden Temple and a Delhi food walk completely untouched.

insert into inventory
  (id, vendor_id, title, type, description, duration_min, base_cost,
   lat, lng, opens_at, closes_at, tags, weather_sensitive, city, region)
values
  -- ---------------------------------------------------------- DELHI --
  ('29000000-0000-4000-a000-000000000001', '2e000000-0000-4000-a000-000000000003',
   'Hostel bunk, Paharganj', 'hotel',
   'Walk-up dorm ten minutes from New Delhi station.', 600, 700.00,
   28.6450, 77.2150, null, null, '{budget,city}', false, 'Delhi', 'Delhi'),

  ('29000000-0000-4000-a000-000000000002', '2e000000-0000-4000-a000-000000000008',
   'Old Delhi food walk, Chandni Chowk', 'activity',
   'Paranthe Wali Gali, Karim''s, jalebi at Dariba. Eaten standing up.', 180, 900.00,
   28.6560, 77.2300, '10:00', '21:00', '{food,culture,signature}', false, 'Delhi', 'Delhi'),

  ('29000000-0000-4000-a000-000000000003', '2e000000-0000-4000-a000-000000000008',
   'Humayun''s Tomb & Nizamuddin', 'guide',
   'Mughal garden tomb, then qawwali at the dargah after dusk.', 210, 600.00,
   28.5933, 77.2507, '06:00', '18:00', '{history,culture}', false, 'Delhi', 'Delhi'),

  -- --------------------------------------------------------- RAIL --
  ('29000000-0000-4000-a000-000000000010', '2e000000-0000-4000-a000-000000000001',
   'Train: Delhi → Amritsar (3A)', 'transport',
   'Swarna Shatabdi / overnight mail. Six to seven hours.', 400, 950.00,
   28.6420, 77.2190, '05:00', '23:30', '{transfer,rail}', false, 'Delhi', 'Delhi'),

  ('29000000-0000-4000-a000-000000000011', '2e000000-0000-4000-a000-000000000001',
   'Train: Amritsar → Chandigarh', 'transport',
   'Morning departure; the rail head for Himachal.', 270, 420.00,
   31.6330, 74.8720, '05:00', '22:00', '{transfer,rail}', false, 'Amritsar', 'Punjab'),

  ('29000000-0000-4000-a000-000000000012', '2e000000-0000-4000-a000-000000000002',
   'Coach: Chandigarh → Manali', 'transport',
   'Overnight HRTC Volvo up the Beas valley. Eight to nine hours.', 540, 1100.00,
   30.7330, 76.7794, '18:00', '23:00', '{transfer,road}', true, 'Chandigarh', 'Himachal'),

  ('29000000-0000-4000-a000-000000000013', '2e000000-0000-4000-a000-000000000002',
   'Coach: Manali → Haridwar', 'transport',
   'The long one — overnight, twelve hours, and the price of wanting both ranges.', 720, 1400.00,
   32.2432, 77.1892, '15:00', '20:00', '{transfer,road}', true, 'Manali', 'Himachal'),

  ('29000000-0000-4000-a000-000000000014', '2e000000-0000-4000-a000-000000000002',
   'Shared cab: Haridwar → Rishikesh', 'transport',
   'Forty minutes up the Ganga.', 45, 250.00,
   29.9457, 78.1642, '05:00', '22:00', '{transfer,road}', false, 'Haridwar', 'Uttarakhand'),

  ('29000000-0000-4000-a000-000000000015', '2e000000-0000-4000-a000-000000000002',
   'Shared cab: Rishikesh → Chopta', 'transport',
   'Seven hours through Devprayag and Ukhimath. Landslide-prone in rain.', 420, 2200.00,
   30.0869, 78.2676, '05:00', '14:00', '{transfer,road,scenic}', true, 'Rishikesh', 'Uttarakhand'),

  ('29000000-0000-4000-a000-000000000016', '2e000000-0000-4000-a000-000000000002',
   'Shared cab: Chopta → Auli', 'transport',
   'Five hours via Chamoli and Joshimath.', 300, 1900.00,
   30.4900, 79.2200, '06:00', '15:00', '{transfer,road,scenic}', true, 'Chopta', 'Uttarakhand'),

  ('29000000-0000-4000-a000-000000000017', '2e000000-0000-4000-a000-000000000002',
   'Shared cab: Auli → Haridwar', 'transport',
   'Ten hours down the Alaknanda for the night train.', 600, 2400.00,
   30.5280, 79.5660, '04:00', '12:00', '{transfer,road}', true, 'Auli', 'Uttarakhand'),

  ('29000000-0000-4000-a000-000000000018', '2e000000-0000-4000-a000-000000000001',
   'Train: Haridwar → Delhi', 'transport',
   'Evening Shatabdi into New Delhi.', 270, 650.00,
   29.9457, 78.1642, '05:00', '23:00', '{transfer,rail}', false, 'Haridwar', 'Uttarakhand'),

  -- ------------------------------------------------------- AMRITSAR --
  ('29000000-0000-4000-a000-000000000020', '2e000000-0000-4000-a000-000000000003',
   'Hostel bunk, Amritsar old city', 'hotel',
   'Ten minutes'' walk from the Golden Temple.', 600, 650.00,
   31.6200, 74.8765, null, null, '{budget,city}', false, 'Amritsar', 'Punjab'),

  ('29000000-0000-4000-a000-000000000021', '2e000000-0000-4000-a000-000000000008',
   'Golden Temple at first light', 'guide',
   'Harmandir Sahib before the crowds, then langar in the world''s largest kitchen.', 180, 0.00,
   31.6200, 74.8765, '03:00', '22:00', '{spiritual,culture,signature,food}', false, 'Amritsar', 'Punjab'),

  ('29000000-0000-4000-a000-000000000022', '2e000000-0000-4000-a000-000000000008',
   'Jallianwala Bagh & Partition Museum', 'guide',
   'Ten minutes from the temple; the harder half of the same afternoon.', 150, 250.00,
   31.6205, 74.8800, '10:00', '18:00', '{history,culture,indoor}', false, 'Amritsar', 'Punjab'),

  ('29000000-0000-4000-a000-000000000023', '2e000000-0000-4000-a000-000000000008',
   'Wagah border retreat ceremony', 'activity',
   'The flag-lowering drill at the Pakistan border. Go early for a seat.', 240, 500.00,
   31.6047, 74.5730, '15:00', '19:00', '{culture,signature}', true, 'Amritsar', 'Punjab'),

  ('29000000-0000-4000-a000-000000000024', '2e000000-0000-4000-a000-000000000008',
   'Amritsari kulcha & lassi crawl', 'restaurant',
   'Kesar da Dhaba, then Ahuja''s. Local cuisine, non-negotiable.', 120, 450.00,
   31.6250, 74.8720, '08:00', '23:00', '{food,signature}', false, 'Amritsar', 'Punjab'),

  -- --------------------------------------------------------- MANALI --
  ('29000000-0000-4000-a000-000000000030', '2e000000-0000-4000-a000-000000000003',
   'Hostel, Old Manali', 'hotel',
   'Above the Manalsu bridge, wood-framed and cheap.', 600, 800.00,
   32.2540, 77.1750, null, null, '{budget,scenic}', false, 'Manali', 'Himachal'),

  ('29000000-0000-4000-a000-000000000031', '2e000000-0000-4000-a000-000000000007',
   'Horse riding, Solang Valley', 'activity',
   'An hour in the saddle up the meadow below the Rohtang road.', 90, 700.00,
   32.3170, 77.1560, '08:00', '17:00', '{active,scenic,signature}', true, 'Manali', 'Himachal'),

  ('29000000-0000-4000-a000-000000000032', '2e000000-0000-4000-a000-000000000008',
   'Hadimba temple & Old Manali walk', 'guide',
   'Cedar forest shrine, then the Vashisht hot springs.', 150, 300.00,
   32.2490, 77.1830, '07:00', '18:00', '{culture,scenic,relaxed}', false, 'Manali', 'Himachal'),

  ('29000000-0000-4000-a000-000000000033', '2e000000-0000-4000-a000-000000000008',
   'Himachali dham thali', 'restaurant',
   'Siddu, madra and rajma-chawal on a leaf plate.', 90, 400.00,
   32.2400, 77.1880, '12:00', '22:00', '{food,signature}', false, 'Manali', 'Himachal'),

  -- ------------------------------------------------------ RISHIKESH --
  ('29000000-0000-4000-a000-000000000040', '2e000000-0000-4000-a000-000000000003',
   'Riverside hostel, Tapovan', 'hotel',
   'Terrace over the Ganga at Laxman Jhula.', 600, 750.00,
   30.1300, 78.3200, null, null, '{budget,scenic}', false, 'Rishikesh', 'Uttarakhand'),

  ('29000000-0000-4000-a000-000000000041', '2e000000-0000-4000-a000-000000000004',
   'White-water rafting, Shivpuri to Rishikesh', 'activity',
   'Sixteen kilometres, Grade III — Roller Coaster, Golf Course, Return to Sender.', 240, 1200.00,
   30.1180, 78.3800, '08:00', '16:00', '{water,active,adventure,signature}', true, 'Rishikesh', 'Uttarakhand'),

  ('29000000-0000-4000-a000-000000000042', '2e000000-0000-4000-a000-000000000008',
   'Ganga aarti at Triveni Ghat', 'guide',
   'Lamps on the water at dusk; sit on the steps.', 90, 0.00,
   30.1080, 78.2950, '17:00', '20:00', '{spiritual,culture,relaxed}', true, 'Rishikesh', 'Uttarakhand'),

  ('29000000-0000-4000-a000-000000000043', '2e000000-0000-4000-a000-000000000008',
   'Chotiwala thali & German Bakery', 'restaurant',
   'The old pilgrim thali, then coffee above the bridge.', 90, 350.00,
   30.1290, 78.3190, '08:00', '22:00', '{food,relaxed}', false, 'Rishikesh', 'Uttarakhand'),

  -- --------------------------------------------------------- CHOPTA --
  ('29000000-0000-4000-a000-000000000050', '2e000000-0000-4000-a000-000000000005',
   'Alpine tent, Chopta meadow', 'hotel',
   'Twin dome tent in the bugyal, sleeping bag and a bucket of hot water.', 600, 1300.00,
   30.4900, 79.2200, null, null, '{budget,scenic,signature,nature}', true, 'Chopta', 'Uttarakhand'),

  ('29000000-0000-4000-a000-000000000051', '2e000000-0000-4000-a000-000000000006',
   'Chandrashila summit trek via Tungnath', 'guide',
   'Pre-dawn start, 4,000m at the top, Nanda Devi and Trishul on the skyline.', 420, 1800.00,
   30.4890, 79.2170, '04:00', '14:00', '{trek,active,adventure,scenic,signature}', true, 'Chopta', 'Uttarakhand'),

  ('29000000-0000-4000-a000-000000000052', '2e000000-0000-4000-a000-000000000005',
   'Deopraag maggi & garhwali dinner', 'restaurant',
   'Camp kitchen — jhangora, phaanu and endless chai.', 90, 350.00,
   30.4900, 79.2200, '07:00', '22:00', '{food,relaxed}', false, 'Chopta', 'Uttarakhand'),

  -- ----------------------------------------------------------- AULI --
  ('29000000-0000-4000-a000-000000000060', '2e000000-0000-4000-a000-000000000003',
   'GMVN hut, Auli', 'hotel',
   'Government hut on the slope above Joshimath.', 600, 1500.00,
   30.5280, 79.5660, null, null, '{budget,scenic}', false, 'Auli', 'Uttarakhand'),

  ('29000000-0000-4000-a000-000000000061', '2e000000-0000-4000-a000-000000000009',
   'Auli ropeway & Gorson Bugyal walk', 'activity',
   'Asia''s longest cable car, then the meadow walk to the treeline.', 240, 1200.00,
   30.5280, 79.5660, '09:00', '17:00', '{scenic,active,signature}', true, 'Auli', 'Uttarakhand'),

  ('29000000-0000-4000-a000-000000000062', '2e000000-0000-4000-a000-000000000007',
   'Horse riding, Gorson meadow', 'activity',
   'Ponies up the bugyal — the fallback when Solang is closed.', 90, 600.00,
   30.5300, 79.5700, '08:00', '16:00', '{active,scenic}', true, 'Auli', 'Uttarakhand'),

  ('29000000-0000-4000-a000-000000000063', '2e000000-0000-4000-a000-000000000008',
   'Joshimath bazaar dinner', 'restaurant',
   'Aloo ke gutke and bhang ki chutney in the bazaar below the slope.', 90, 350.00,
   30.5550, 79.5640, '11:00', '22:00', '{food,relaxed}', false, 'Auli', 'Uttarakhand');

-- ------------------------------------------------------- where you sleep --
--
-- Every hotel above is a hostel bunk or a government hut, because the corridor
-- was written for one kind of traveler. That made "accommodation preferences"
-- — which PS-7 names twice — a field with nothing behind it: the composer took
-- the first hotel in the city, and there was only ever one.
--
-- So each town gets a middle and a top option. Prices are the real spread for
-- these places, which matters more than it sounds: a preference that does not
-- move the total is a preference nobody can see the effect of. Delhi budget to
-- Delhi luxury is 700 to 9,500 a night, and a fortnight of that is the
-- difference between two entirely different trips.
--
-- The `tier` column is what the composer matches on; the tag is what a person
-- reads on the card.

insert into inventory
  (id, vendor_id, title, type, description, duration_min, base_cost,
   lat, lng, opens_at, closes_at, tags, weather_sensitive, city, region, tier)
values
  -- ---------------------------------------------------------- DELHI --
  ('29000000-0000-4000-a000-000000000101', '2e000000-0000-4000-a000-000000000003',
   'Bloomrooms, New Delhi station', 'hotel',
   'Small business hotel, air-conditioned, five minutes from the platform.',
   600, 3200.00, 28.6420, 77.2200, null, null,
   '{midrange,city}', false, 'Delhi', 'Delhi', 'midrange'),

  ('29000000-0000-4000-a000-000000000102', '2e000000-0000-4000-a000-000000000003',
   'The Imperial, Janpath', 'hotel',
   'Colonial-era rooms off Connaught Place, lawns and a long verandah.',
   600, 9500.00, 28.6250, 77.2190, null, null,
   '{luxury,city,signature}', false, 'Delhi', 'Delhi', 'luxury'),

  -- ------------------------------------------------------- AMRITSAR --
  ('29000000-0000-4000-a000-000000000121', '2e000000-0000-4000-a000-000000000003',
   'Hotel Hong Kong Inn, Amritsar', 'hotel',
   'Clean mid-range rooms a rickshaw ride from the temple.',
   600, 2800.00, 31.6300, 74.8700, null, null,
   '{midrange,city}', false, 'Amritsar', 'Punjab', 'midrange'),

  ('29000000-0000-4000-a000-000000000122', '2e000000-0000-4000-a000-000000000003',
   'Taj Swarna, Amritsar', 'hotel',
   'Marble and quiet, ten minutes from the Golden Temple by car.',
   600, 8200.00, 31.6340, 74.8580, null, null,
   '{luxury,city}', false, 'Amritsar', 'Punjab', 'luxury'),

  -- --------------------------------------------------------- MANALI --
  ('29000000-0000-4000-a000-000000000131', '2e000000-0000-4000-a000-000000000003',
   'Apple orchard guesthouse, Manali', 'hotel',
   'Family-run rooms in the orchards above Old Manali, wood fire in the hall.',
   600, 3400.00, 32.2600, 77.1800, null, null,
   '{midrange,scenic,nature}', false, 'Manali', 'Himachal', 'midrange'),

  ('29000000-0000-4000-a000-000000000132', '2e000000-0000-4000-a000-000000000003',
   'Span Resort, Manali', 'hotel',
   'Riverside cottages on the Kullu road, heated in winter.',
   600, 8800.00, 32.2100, 77.1850, null, null,
   '{boutique,scenic,nature}', false, 'Manali', 'Himachal', 'boutique'),

  -- ------------------------------------------------------ RISHIKESH --
  ('29000000-0000-4000-a000-000000000141', '2e000000-0000-4000-a000-000000000003',
   'Ganga Kinare, Rishikesh', 'hotel',
   'River-facing rooms with a private ghat, upstream of the bridges.',
   600, 4200.00, 30.1150, 78.3000, null, null,
   '{midrange,scenic,wellness}', false, 'Rishikesh', 'Uttarakhand', 'midrange'),

  ('29000000-0000-4000-a000-000000000142', '2e000000-0000-4000-a000-000000000003',
   'Aloha on the Ganges, Tapovan', 'hotel',
   'Terraced garden resort above the river, pool and a yoga shala.',
   600, 9200.00, 30.1230, 78.3170, null, null,
   '{luxury,scenic,wellness}', false, 'Rishikesh', 'Uttarakhand', 'luxury'),

  -- --------------------------------------------------------- CHOPTA --
  -- No luxury tier here, and that is the honest answer rather than an
  -- omission: Chopta is a meadow at 2,700m with tents and two forest huts.
  -- The composer falls back to the nearest tier it can actually book, and the
  -- traveler is told which stop could not be matched.
  ('29000000-0000-4000-a000-000000000151', '2e000000-0000-4000-a000-000000000005',
   'Forest rest house, Baniya Kund', 'hotel',
   'Two rooms and a caretaker, twin beds, hot water in a bucket by request.',
   600, 3600.00, 30.4820, 79.2100, null, null,
   '{midrange,nature,scenic}', false, 'Chopta', 'Uttarakhand', 'midrange'),

  -- ----------------------------------------------------------- AULI --
  ('29000000-0000-4000-a000-000000000161', '2e000000-0000-4000-a000-000000000003',
   'Cliff Top Club, Auli', 'hotel',
   'Ski-in chalet rooms at the top of the ropeway, Nanda Devi from the window.',
   600, 6800.00, 30.5300, 79.5700, null, null,
   '{midrange,scenic,signature}', false, 'Auli', 'Uttarakhand', 'midrange'),

  ('29000000-0000-4000-a000-000000000162', '2e000000-0000-4000-a000-000000000003',
   'The Tattva, Joshimath', 'hotel',
   'Glass-fronted suites below the slope, heated through the winter.',
   600, 11000.00, 30.5560, 79.5620, null, null,
   '{luxury,scenic}', false, 'Auli', 'Uttarakhand', 'luxury');

-- Everything seeded before this block is the cheap option, so say so once
-- rather than editing sixteen rows above and missing one.
update inventory set tier = 'budget'
 where type = 'hotel' and tier is null and id::text like '29000000%';

-- --------------------------------------------------------- availability --
-- Generated here rather than in a separate script, because the inventory
-- delete above cascades to availability: running the seed on its own used to
-- leave a catalogue with no bookable slots at all, and `search_availability`
-- returning an empty set makes the composer and the agent both look broken.
--
-- Dated from current_date for the same reason the Amalfi seed is: a demo that
-- only works in the month it was written is a demo that fails on stage.
insert into availability (inventory_id, date, starts_at, slots_total, slots_taken, price)
select i.id,
       d::date,
       (d::date + coalesce(i.opens_at, time '09:00')) at time zone 'Asia/Kolkata',
       case when i.type = 'hotel' then 8 else 12 end,
       0,
       i.base_cost
from inventory i
cross join generate_series(current_date - 1, current_date + 45, interval '1 day') d
where i.id::text like '29000000%';

-- Backfill the Amalfi rows so nothing in the catalogue has a null city.
update inventory set city = 'Positano', region = 'Amalfi Coast'
 where id::text like '19000000%' and city is null;

commit;
