-- Voyage — North India catalogue.
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

-- ------------------------------------ what the demo trip actually needs --
--
-- Four rows the corridor did not have, added when the seeded demo became a
-- north India trip.
--
-- The three Rishikesh activities are not padding. The storm demo turns on the
-- re-planner having something to offer once rafting is ruled out, and every
-- other thing to do in Rishikesh — the rafting itself, the aarti on the ghat —
-- is weather-sensitive too. A cause-aware engine correctly refused to replace
-- a rained-off river trip with another thing the rain had also stopped, and
-- then had nothing left to say. An ashram, a yoga hall and a massage room are
-- indoors, real, and exactly what a Rishikesh operator would actually offer.
--
-- The Delhi coach is the leg the corridor was missing. Delhi to Manali is 548km
-- and 11-15 hours, and the overnight Volvo leaving between 5 and 9pm is how
-- people genuinely do it — the alternative was routing the demo through
-- Amritsar and Chandigarh to use three existing legs for a journey nobody
-- breaks up that way.

insert into inventory
  (id, vendor_id, title, type, description, duration_min, base_cost,
   opens_at, tags, weather_sensitive, city, region, to_city, overnight, country, time_zone)
values
  ('29000000-0000-4000-a000-000000000201', '2e000000-0000-4000-a000-000000000002',
   'Overnight coach: Delhi → Manali', 'transport',
   'AC Volvo sleeper, 548km through the night. Boards near Kashmere Gate, arrives Manali bus stand mid-morning.',
   840, 1800.00, '20:00', '{overnight,scenic}', false,
   'Delhi', 'Delhi NCR', 'Manali', true, 'India', 'Asia/Kolkata'),

  ('29000000-0000-4000-a000-000000000202', '2e000000-0000-4000-a000-000000000004',
   'Transfer — Tapovan to Shivpuri put-in', 'transport',
   'The rafting operator''s shuttle upstream to the put-in point.',
   45, 400.00, '08:00', '{adventure}', false,
   'Rishikesh', 'Garhwal', null, false, 'India', 'Asia/Kolkata'),

  ('29000000-0000-4000-a000-000000000203', '2e000000-0000-4000-a000-000000000008',
   'Yoga & meditation, Parmarth Niketan', 'activity',
   'Morning or evening session in the hall on the ghat. Indoors, runs whatever the weather does.',
   90, 500.00, '07:00', '{wellness,culture,indoor}', false,
   'Rishikesh', 'Garhwal', null, false, 'India', 'Asia/Kolkata'),

  ('29000000-0000-4000-a000-000000000204', '2e000000-0000-4000-a000-000000000008',
   'Beatles Ashram (Chaurasi Kutia)', 'activity',
   'The abandoned Maharishi ashram in Rajaji forest, painted wall to wall. Covered domes throughout.',
   120, 600.00, '09:00', '{culture,history,indoor}', false,
   'Rishikesh', 'Garhwal', null, false, 'India', 'Asia/Kolkata'),

  ('29000000-0000-4000-a000-000000000205', '2e000000-0000-4000-a000-000000000008',
   'Ayurvedic massage, Tapovan', 'activity',
   'An hour of abhyanga at a Tapovan clinic. Entirely indoors.',
   60, 1500.00, '10:00', '{wellness,indoor}', false,
   'Rishikesh', 'Garhwal', null, false, 'India', 'Asia/Kolkata')
on conflict (id) do nothing;

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
-- Dated from demo_base_date() for the same reason the Amalfi seed is: a demo that
-- only works in the month it was written is a demo that fails on stage.
insert into availability (inventory_id, date, starts_at, slots_total, slots_taken, price)
select i.id,
       d::date,
       (d::date + coalesce(i.opens_at, time '09:00')) at time zone 'Asia/Kolkata',
       case when i.type = 'hotel' then 8 else 12 end,
       0,
       i.base_cost
from inventory i
cross join generate_series(demo_base_date() - 1, demo_base_date() + 45, interval '1 day') d
where i.id::text like '29000000%';

-- ------------------------------------------------- legs the composer can use --
--
-- Every one of these rows names its destination in its title and left `to_city`
-- null, which meant `loadLegGraph` — whose whole query is "transport rows with
-- a to_city" — could not see a single one of them. The corridor ordered towns
-- correctly and then had no trains or coaches to put between them, so a
-- composed north India trip arrived without any way of getting from one town to
-- the next. Switzerland worked only because research fills the column in.

update inventory set to_city = 'Amritsar'   where id = '29000000-0000-4000-a000-000000000010';
update inventory set to_city = 'Chandigarh' where id = '29000000-0000-4000-a000-000000000011';
update inventory set to_city = 'Manali'     where id = '29000000-0000-4000-a000-000000000012';
update inventory set to_city = 'Haridwar'   where id = '29000000-0000-4000-a000-000000000013';
update inventory set to_city = 'Rishikesh'  where id = '29000000-0000-4000-a000-000000000014';
update inventory set to_city = 'Chopta'     where id = '29000000-0000-4000-a000-000000000015';
update inventory set to_city = 'Auli'       where id = '29000000-0000-4000-a000-000000000016';
update inventory set to_city = 'Haridwar'   where id = '29000000-0000-4000-a000-000000000017';
update inventory set to_city = 'Delhi'      where id = '29000000-0000-4000-a000-000000000018';

-- The two overnight legs really are overnight, and the day allocator has to
-- know: a coach that leaves Manali at four and arrives at seven the next
-- morning costs a night, not an afternoon.
update inventory set overnight = true
 where id in ('29000000-0000-4000-a000-000000000013',
              '29000000-0000-4000-a000-000000000201');

-- ================================================================ the demo --
--
-- One group, eight days, Delhi to Auli and back down. It lives here rather than
-- in `seed.sql` because it is built from the rows above, and `seed.sql` runs
-- first.
--
-- The route is the one people actually travel, checked against real timings
-- rather than invented: Delhi to Manali is 548km on an overnight Volvo (11-15h,
-- leaving between 5 and 9pm); Manali to Haridwar is 483km and the best part of
-- fifteen hours; Haridwar to Rishikesh is 25km; Rishikesh to Chopta is 169km
-- and 5-7 hours of narrowing mountain road; Chopta to Auli is another 135-148km
-- and 5-6 hours. Nothing here claims a journey that cannot be made.
--
-- Dates run from demo_base_date() - 3 so the trip is genuinely *in progress*: three
-- days behind it, today in Rishikesh, and the demo tomorrow. That also puts
-- real stops inside the guide's 48-hour run sheet without anything being
-- special-cased.

insert into trips
  (id, traveler_id, operator_id, title, contact_name, contact_email, contact_phone,
   coordinator_name, coordinator_phone,
   status, party_size, budget, currency, starts_on, ends_on, prefs)
values
  ('7a000000-0000-4000-a000-000000000001', null, '0d000000-0000-4000-a000-000000000001',
   'North India — Sharma party', 'Ananya Sharma', 'ananya@example.com', '+91 98000 00000',
   -- The guide on the ground. Plain text rather than a join, because profiles
   -- hang off auth.users and the seed runs before anybody has signed in.
   'Marco Ferrara', '+91 98110 00006',
   'in_progress', 2, 35000.00, 'INR', demo_base_date() - 3, demo_base_date() + 4,
   '{"interests":["adventure","scenic","culture"],"pace":"moderate","dietary":["vegetarian"],
     "mobility":"comfortable walking, no technical climbing","style":"midrange"}'::jsonb);

-- --------------------------------------------------- itinerary (the DAG) --
--
-- Day 5 is the demo. The chain is:
--
--   hotel ──> shuttle ──> RAFTING ──> lunch ──> yoga ──> aarti
--         └──> cab to Chopta ──> ...the rest of the trip
--
-- Kill the rafting and three stops go with it, at depths 1, 2 and 3 — while the
-- cab to Chopta and everything after it survive, because they hang off the
-- hotel rather than off the river. That distinction is the entire product: a
-- flat list would have cancelled the back half of a holiday over an afternoon
-- of rain.
--
-- The Rishikesh hotel is locked and prepaid, so the re-planner has to work
-- around it and say why, exactly as the Positano one used to.

insert into itinerary_items
  (id, trip_id, day, seq, inventory_id, vendor_id, title, type, starts_at, ends_at,
   lat, lng, cost, status, depends_on, lock_reason)
values
  -- Day 1 — Delhi, and the night coach north
  ('17000000-0000-4000-a000-000000000001', '7a000000-0000-4000-a000-000000000001', 1, 1,
   '29000000-0000-4000-a000-000000000101', '2e000000-0000-4000-a000-000000000003',
   'Check in — Bloomrooms, New Delhi station', 'hotel',
   (((demo_base_date() - 3) + time '12:00') at time zone 'Asia/Kolkata'), (((demo_base_date() - 3) + time '13:00') at time zone 'Asia/Kolkata'),
   28.6420, 77.2190, 3200.00, 'confirmed', '{}', null),

  ('17000000-0000-4000-a000-000000000002', '7a000000-0000-4000-a000-000000000001', 1, 2,
   '29000000-0000-4000-a000-000000000002', '2e000000-0000-4000-a000-000000000008',
   'Old Delhi food walk, Chandni Chowk', 'activity',
   (((demo_base_date() - 3) + time '15:00') at time zone 'Asia/Kolkata'), (((demo_base_date() - 3) + time '18:00') at time zone 'Asia/Kolkata'),
   28.6560, 77.2300, 900.00, 'confirmed',
   '{17000000-0000-4000-a000-000000000001}', null),

  ('17000000-0000-4000-a000-000000000003', '7a000000-0000-4000-a000-000000000001', 1, 3,
   '29000000-0000-4000-a000-000000000201', '2e000000-0000-4000-a000-000000000002',
   'Overnight coach: Delhi → Manali', 'transport',
   (((demo_base_date() - 3) + time '20:00') at time zone 'Asia/Kolkata'), (((demo_base_date() - 2) + time '10:00') at time zone 'Asia/Kolkata'),
   28.6670, 77.2280, 1800.00, 'confirmed',
   '{17000000-0000-4000-a000-000000000002}', null),

  -- Day 2 — Manali
  ('17000000-0000-4000-a000-000000000010', '7a000000-0000-4000-a000-000000000001', 2, 1,
   '29000000-0000-4000-a000-000000000131', '2e000000-0000-4000-a000-000000000003',
   'Check in — Apple orchard guesthouse, Manali', 'hotel',
   (((demo_base_date() - 2) + time '11:00') at time zone 'Asia/Kolkata'), (((demo_base_date() - 2) + time '12:00') at time zone 'Asia/Kolkata'),
   32.2430, 77.1890, 3400.00, 'confirmed',
   '{17000000-0000-4000-a000-000000000003}', null),

  ('17000000-0000-4000-a000-000000000011', '7a000000-0000-4000-a000-000000000001', 2, 2,
   '29000000-0000-4000-a000-000000000032', '2e000000-0000-4000-a000-000000000008',
   'Hadimba temple & Old Manali walk', 'guide',
   (((demo_base_date() - 2) + time '15:00') at time zone 'Asia/Kolkata'), (((demo_base_date() - 2) + time '17:30') at time zone 'Asia/Kolkata'),
   32.2490, 77.1830, 300.00, 'confirmed',
   '{17000000-0000-4000-a000-000000000010}', null),

  ('17000000-0000-4000-a000-000000000012', '7a000000-0000-4000-a000-000000000001', 2, 3,
   '29000000-0000-4000-a000-000000000033', '2e000000-0000-4000-a000-000000000008',
   'Himachali dham thali', 'restaurant',
   (((demo_base_date() - 2) + time '19:30') at time zone 'Asia/Kolkata'), (((demo_base_date() - 2) + time '21:00') at time zone 'Asia/Kolkata'),
   32.2400, 77.1880, 400.00, 'confirmed',
   '{17000000-0000-4000-a000-000000000011}', null),

  -- Day 3 — Solang, then the long coach down to the plains
  ('17000000-0000-4000-a000-000000000020', '7a000000-0000-4000-a000-000000000001', 3, 1,
   '29000000-0000-4000-a000-000000000031', '2e000000-0000-4000-a000-000000000007',
   'Horse riding, Solang Valley', 'activity',
   (((demo_base_date() - 1) + time '09:00') at time zone 'Asia/Kolkata'), (((demo_base_date() - 1) + time '10:30') at time zone 'Asia/Kolkata'),
   32.3170, 77.1560, 700.00, 'confirmed',
   '{17000000-0000-4000-a000-000000000010}', null),

  ('17000000-0000-4000-a000-000000000021', '7a000000-0000-4000-a000-000000000001', 3, 2,
   '29000000-0000-4000-a000-000000000013', '2e000000-0000-4000-a000-000000000002',
   'Coach: Manali → Haridwar', 'transport',
   (((demo_base_date() - 1) + time '16:00') at time zone 'Asia/Kolkata'), ((demo_base_date() + time '07:00') at time zone 'Asia/Kolkata'),
   32.2400, 77.1880, 1400.00, 'confirmed',
   '{17000000-0000-4000-a000-000000000020}', null),

  -- Day 4 — today. Rishikesh.
  ('17000000-0000-4000-a000-000000000030', '7a000000-0000-4000-a000-000000000001', 4, 1,
   '29000000-0000-4000-a000-000000000014', '2e000000-0000-4000-a000-000000000002',
   'Shared cab: Haridwar → Rishikesh', 'transport',
   ((demo_base_date() + time '08:00') at time zone 'Asia/Kolkata'), ((demo_base_date() + time '08:45') at time zone 'Asia/Kolkata'),
   29.9457, 78.1642, 250.00, 'confirmed',
   '{17000000-0000-4000-a000-000000000021}', null),

  ('17000000-0000-4000-a000-000000000031', '7a000000-0000-4000-a000-000000000001', 4, 2,
   '29000000-0000-4000-a000-000000000141', '2e000000-0000-4000-a000-000000000003',
   'Check in — Ganga Kinare, Rishikesh', 'hotel',
   ((demo_base_date() + time '12:00') at time zone 'Asia/Kolkata'), ((demo_base_date() + time '13:00') at time zone 'Asia/Kolkata'),
   30.1080, 78.2940, 4200.00, 'confirmed',
   '{17000000-0000-4000-a000-000000000030}',
   'Non-refundable rate — 3 nights prepaid'),

  ('17000000-0000-4000-a000-000000000032', '7a000000-0000-4000-a000-000000000001', 4, 3,
   '29000000-0000-4000-a000-000000000043', '2e000000-0000-4000-a000-000000000008',
   'Chotiwala thali & German Bakery', 'restaurant',
   ((demo_base_date() + time '20:00') at time zone 'Asia/Kolkata'), ((demo_base_date() + time '21:30') at time zone 'Asia/Kolkata'),
   30.1230, 78.3200, 350.00, 'confirmed',
   '{17000000-0000-4000-a000-000000000031}', null),

  -- Day 5 — tomorrow. The one the storm hits.
  ('17000000-0000-4000-a000-000000000040', '7a000000-0000-4000-a000-000000000001', 5, 1,
   '29000000-0000-4000-a000-000000000202', '2e000000-0000-4000-a000-000000000004',
   'Transfer — Tapovan to Shivpuri put-in', 'transport',
   (((demo_base_date() + 1) + time '08:30') at time zone 'Asia/Kolkata'), (((demo_base_date() + 1) + time '09:15') at time zone 'Asia/Kolkata'),
   30.1080, 78.2940, 400.00, 'confirmed',
   '{17000000-0000-4000-a000-000000000031}', null),

  ('17000000-0000-4000-a000-000000000041', '7a000000-0000-4000-a000-000000000001', 5, 2,
   '29000000-0000-4000-a000-000000000041', '2e000000-0000-4000-a000-000000000004',
   'White-water rafting, Shivpuri to Rishikesh', 'activity',
   (((demo_base_date() + 1) + time '09:30') at time zone 'Asia/Kolkata'), (((demo_base_date() + 1) + time '13:30') at time zone 'Asia/Kolkata'),
   30.1350, 78.3800, 1200.00, 'confirmed',
   '{17000000-0000-4000-a000-000000000040}', null),

  ('17000000-0000-4000-a000-000000000042', '7a000000-0000-4000-a000-000000000001', 5, 3,
   '29000000-0000-4000-a000-000000000043', '2e000000-0000-4000-a000-000000000008',
   'Riverside lunch — Chotiwala', 'restaurant',
   (((demo_base_date() + 1) + time '14:00') at time zone 'Asia/Kolkata'), (((demo_base_date() + 1) + time '15:00') at time zone 'Asia/Kolkata'),
   30.1230, 78.3200, 350.00, 'confirmed',
   '{17000000-0000-4000-a000-000000000041}', null),

  ('17000000-0000-4000-a000-000000000043', '7a000000-0000-4000-a000-000000000001', 5, 4,
   '29000000-0000-4000-a000-000000000203', '2e000000-0000-4000-a000-000000000008',
   'Yoga & meditation, Parmarth Niketan', 'activity',
   (((demo_base_date() + 1) + time '16:30') at time zone 'Asia/Kolkata'), (((demo_base_date() + 1) + time '18:00') at time zone 'Asia/Kolkata'),
   30.1160, 78.3180, 500.00, 'confirmed',
   '{17000000-0000-4000-a000-000000000042}', null),

  ('17000000-0000-4000-a000-000000000044', '7a000000-0000-4000-a000-000000000001', 5, 5,
   '29000000-0000-4000-a000-000000000042', '2e000000-0000-4000-a000-000000000008',
   'Ganga aarti at Triveni Ghat', 'guide',
   (((demo_base_date() + 1) + time '18:30') at time zone 'Asia/Kolkata'), (((demo_base_date() + 1) + time '20:00') at time zone 'Asia/Kolkata'),
   30.1090, 78.2950, 0.00, 'confirmed',
   '{17000000-0000-4000-a000-000000000043}', null),

  -- Day 6 — up to Chopta. Hangs off the hotel, not the river.
  ('17000000-0000-4000-a000-000000000050', '7a000000-0000-4000-a000-000000000001', 6, 1,
   '29000000-0000-4000-a000-000000000015', '2e000000-0000-4000-a000-000000000005',
   'Shared cab: Rishikesh → Chopta', 'transport',
   (((demo_base_date() + 2) + time '07:00') at time zone 'Asia/Kolkata'), (((demo_base_date() + 2) + time '13:00') at time zone 'Asia/Kolkata'),
   30.1080, 78.2940, 2200.00, 'confirmed',
   '{17000000-0000-4000-a000-000000000031}', null),

  ('17000000-0000-4000-a000-000000000051', '7a000000-0000-4000-a000-000000000001', 6, 2,
   '29000000-0000-4000-a000-000000000052', '2e000000-0000-4000-a000-000000000005',
   'Deopraag maggi & garhwali dinner', 'restaurant',
   (((demo_base_date() + 2) + time '19:30') at time zone 'Asia/Kolkata'), (((demo_base_date() + 2) + time '21:00') at time zone 'Asia/Kolkata'),
   30.4890, 79.2170, 350.00, 'confirmed',
   '{17000000-0000-4000-a000-000000000050}', null),

  -- Day 7 — the summit push
  ('17000000-0000-4000-a000-000000000060', '7a000000-0000-4000-a000-000000000001', 7, 1,
   '29000000-0000-4000-a000-000000000051', '2e000000-0000-4000-a000-000000000006',
   'Chandrashila summit trek via Tungnath', 'guide',
   (((demo_base_date() + 3) + time '05:00') at time zone 'Asia/Kolkata'), (((demo_base_date() + 3) + time '12:00') at time zone 'Asia/Kolkata'),
   30.4890, 79.2170, 1800.00, 'confirmed',
   '{17000000-0000-4000-a000-000000000050}', null),

  -- Day 8 — across to Auli
  ('17000000-0000-4000-a000-000000000070', '7a000000-0000-4000-a000-000000000001', 8, 1,
   '29000000-0000-4000-a000-000000000016', '2e000000-0000-4000-a000-000000000009',
   'Shared cab: Chopta → Auli', 'transport',
   (((demo_base_date() + 4) + time '07:00') at time zone 'Asia/Kolkata'), (((demo_base_date() + 4) + time '12:30') at time zone 'Asia/Kolkata'),
   30.4890, 79.2170, 1900.00, 'confirmed',
   '{17000000-0000-4000-a000-000000000060}', null),

  ('17000000-0000-4000-a000-000000000071', '7a000000-0000-4000-a000-000000000001', 8, 2,
   '29000000-0000-4000-a000-000000000061', '2e000000-0000-4000-a000-000000000009',
   'Auli ropeway & Gorson Bugyal walk', 'activity',
   (((demo_base_date() + 4) + time '14:00') at time zone 'Asia/Kolkata'), (((demo_base_date() + 4) + time '18:00') at time zone 'Asia/Kolkata'),
   30.5280, 79.5660, 1200.00, 'confirmed',
   '{17000000-0000-4000-a000-000000000070}', null);

-- ------------------------------------------------------------ bookings --
-- Penalties are what make the re-planner's cost deltas honest: standing down
-- the rafting this close in forfeits the operator's deposit, and the agent has
-- to say so rather than pretending a cancellation is free.

insert into bookings (trip_id, item_id, vendor_id, state, amount, penalty, external_ref)
values
  ('7a000000-0000-4000-a000-000000000001', '17000000-0000-4000-a000-000000000001', '2e000000-0000-4000-a000-000000000003', 'confirmed', 3200.00, 0.00, 'BR-88120'),
  ('7a000000-0000-4000-a000-000000000001', '17000000-0000-4000-a000-000000000002', '2e000000-0000-4000-a000-000000000008', 'confirmed', 900.00, 0.00, 'FW-2210'),
  ('7a000000-0000-4000-a000-000000000001', '17000000-0000-4000-a000-000000000003', '2e000000-0000-4000-a000-000000000002', 'confirmed', 1800.00, 0.00, 'HR-55010'),
  ('7a000000-0000-4000-a000-000000000001', '17000000-0000-4000-a000-000000000010', '2e000000-0000-4000-a000-000000000003', 'confirmed', 3400.00, 0.00, 'AO-3390'),
  ('7a000000-0000-4000-a000-000000000001', '17000000-0000-4000-a000-000000000011', '2e000000-0000-4000-a000-000000000008', 'confirmed', 300.00, 0.00, 'HM-0071'),
  ('7a000000-0000-4000-a000-000000000001', '17000000-0000-4000-a000-000000000012', '2e000000-0000-4000-a000-000000000008', 'confirmed', 400.00, 0.00, 'DH-0072'),
  ('7a000000-0000-4000-a000-000000000001', '17000000-0000-4000-a000-000000000020', '2e000000-0000-4000-a000-000000000007', 'confirmed', 700.00, 0.00, 'SV-4410'),
  ('7a000000-0000-4000-a000-000000000001', '17000000-0000-4000-a000-000000000021', '2e000000-0000-4000-a000-000000000002', 'confirmed', 1400.00, 0.00, 'HR-55011'),
  ('7a000000-0000-4000-a000-000000000001', '17000000-0000-4000-a000-000000000030', '2e000000-0000-4000-a000-000000000002', 'confirmed', 250.00, 0.00, 'HC-1180'),
  -- Prepaid and non-refundable: the whole amount is at risk, which is what
  -- makes the lock mean something to the re-planner.
  ('7a000000-0000-4000-a000-000000000001', '17000000-0000-4000-a000-000000000031', '2e000000-0000-4000-a000-000000000003', 'confirmed', 4200.00, 4200.00, 'GK-7730'),
  ('7a000000-0000-4000-a000-000000000001', '17000000-0000-4000-a000-000000000032', '2e000000-0000-4000-a000-000000000008', 'confirmed', 350.00, 0.00, 'CW-0081'),
  ('7a000000-0000-4000-a000-000000000001', '17000000-0000-4000-a000-000000000040', '2e000000-0000-4000-a000-000000000004', 'confirmed', 400.00, 0.00, 'RC-9910'),
  ('7a000000-0000-4000-a000-000000000001', '17000000-0000-4000-a000-000000000041', '2e000000-0000-4000-a000-000000000004', 'confirmed', 1200.00, 300.00, 'RC-9911'),
  ('7a000000-0000-4000-a000-000000000001', '17000000-0000-4000-a000-000000000042', '2e000000-0000-4000-a000-000000000008', 'confirmed', 350.00, 0.00, 'CW-0082'),
  ('7a000000-0000-4000-a000-000000000001', '17000000-0000-4000-a000-000000000043', '2e000000-0000-4000-a000-000000000008', 'confirmed', 500.00, 0.00, 'PN-0090'),
  ('7a000000-0000-4000-a000-000000000001', '17000000-0000-4000-a000-000000000044', '2e000000-0000-4000-a000-000000000008', 'confirmed', 0.00, 0.00, 'TG-0091'),
  ('7a000000-0000-4000-a000-000000000001', '17000000-0000-4000-a000-000000000050', '2e000000-0000-4000-a000-000000000005', 'confirmed', 2200.00, 0.00, 'CM-6610'),
  ('7a000000-0000-4000-a000-000000000001', '17000000-0000-4000-a000-000000000051', '2e000000-0000-4000-a000-000000000005', 'confirmed', 350.00, 0.00, 'CM-6611'),
  ('7a000000-0000-4000-a000-000000000001', '17000000-0000-4000-a000-000000000060', '2e000000-0000-4000-a000-000000000006', 'confirmed', 1800.00, 0.00, 'GT-2240'),
  ('7a000000-0000-4000-a000-000000000001', '17000000-0000-4000-a000-000000000070', '2e000000-0000-4000-a000-000000000009', 'confirmed', 1900.00, 0.00, 'AR-3310'),
  ('7a000000-0000-4000-a000-000000000001', '17000000-0000-4000-a000-000000000071', '2e000000-0000-4000-a000-000000000009', 'confirmed', 1200.00, 0.00, 'AR-3311');

-- Backfill the Amalfi rows so nothing in the catalogue has a null city.
update inventory set city = 'Positano', region = 'Amalfi Coast'
 where id::text like '19000000%' and city is null;

commit;
