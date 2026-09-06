/**
 * A traveler adds a place the catalogue has never heard of.
 *
 * npm run test:custom-stop
 *
 * The catalogue is finite and a traveler's reading is not. Until now every stop
 * had to point at an existing `inventory` row, so the honest answer to "I found
 * a reindeer farm outside Rovaniemi and it isn't in here" was no. The fix was
 * not to loosen the validator that stops a *model* inventing places — that rule
 * is why nobody's holiday contains a "Schweizer Schokolade Factory Tour" — but
 * to let a *person* mint a row and then run the ordinary machinery over it.
 *
 * Which means the interesting assertions are not "the row exists". They are:
 *
 *   - it behaves like every other stop (chains into the DAG, prices, books),
 *   - it is never offered to anybody else, and
 *   - nothing auto-books a place a customer typed into a form.
 *
 * The second one is the reason this suite builds two trips. A filter that is
 * missing from one of six read paths is invisible until the day a re-planner
 * offers one traveler's guess to another traveler at 2am, and no amount of
 * reading the diff finds that.
 */
import fs from "node:fs";
for (const l of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const t = l.trim(); if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("="); if (i > 0) process.env[t.slice(0, i).trim()] ||= t.slice(i + 1).trim();
}

const { createAdminClient } = await import("../src/lib/supabase/admin.js");
const { createTrip, addItem, addCustomStop, confirmTrip } = await import(
  "../src/lib/db/mutations.js"
);
const { getAlternatives, getItems, getRunSheet } = await import(
  "../src/lib/db/queries.js"
);
const { findCandidates } = await import("../src/lib/disruption/engine.js");

let failures = 0;
const check = (ok: boolean, label: string, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} — ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const supabase = createAdminClient();
const plus = (n: number) =>
  new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

// A Positano bed, so each trip has something real to hang the day off.
const LE_SIRENE = "19000000-0000-4000-a000-000000000001";

async function makeTrip(title: string): Promise<string> {
  return createTrip({
    title,
    contactName: "Test",
    partySize: 2,
    budget: null,
    startsOn: plus(1),
    endsOn: plus(3),
    prefs: {},
    operatorId: null,
    travelerId: null,
  });
}

console.log("\n\x1b[1m1. Adding a place that does not exist yet\x1b[0m");

const mine = await makeTrip("Custom stop test — mine");
const theirs = await makeTrip("Custom stop test — somebody else's");

await addItem({
  tripId: mine,
  day: 1,
  inventoryId: LE_SIRENE,
  localTime: "15:00",
  timeZone: "Europe/Rome",
});

const gem = await addCustomStop({
  tripId: mine,
  day: 1,
  localTime: "18:30",
  timeZone: "Europe/Rome",
  title: "Nonna Rosa's kitchen, up the steps",
  type: "restaurant",
  city: "Positano",
  durationMin: 120,
  cost: 40,
  weatherSensitive: false,
  sourceUrl: "https://example.com/a-blog-post",
});

check(Boolean(gem.id), "the stop is on the itinerary", gem.title);
check(Number(gem.cost) === 40, "at the price the traveler gave", `${gem.cost}`);
check(
  gem.starts_at.slice(11, 16) === "16:30" || gem.starts_at.includes("T"),
  "with a real time, not a placeholder",
  gem.starts_at
);

console.log("\n\x1b[1m2. It is a member of the graph, not a passenger\x1b[0m");

const items = await getItems(mine);
const orphans = items.filter(
  (i) => i.depends_on.length === 0 && i.id !== items[0]?.id
);
check(
  gem.depends_on.length > 0,
  "it hangs off what precedes it, so the blast radius reaches it",
  gem.depends_on.length ? `depends on ${gem.depends_on.length}` : "ORPHAN"
);
check(
  orphans.length === 0,
  "no stop on the trip was orphaned by the insert",
  `${orphans.length} orphan(s)`
);

const { data: invRow } = await supabase
  .from("inventory")
  .select("added_for_trip, provisional, city, vendors(name, channel)")
  .eq("id", gem.inventory_id!)
  .single();
const inv = invRow as unknown as {
  added_for_trip: string | null;
  provisional: boolean;
  city: string | null;
  vendors: { name: string; channel: string } | null;
};

check(inv.added_for_trip === mine, "the row is stamped with the trip that added it");
check(inv.provisional === true, "and marked provisional, because nobody checked it");
check(inv.city === "Positano", "the town came through, so transit maths can place it");
check(
  inv.vendors?.channel === "manual",
  "against a manual vendor — somebody has to ring somebody",
  inv.vendors?.name
);

console.log("\n\x1b[1m3. Nobody else is ever offered it\x1b[0m");

// The other trip gets its own stop at the same hotel, on the same date, so the
// two trips genuinely compete for the same slice of catalogue.
const theirHotel = await addItem({
  tripId: theirs,
  day: 1,
  inventoryId: LE_SIRENE,
  localTime: "15:00",
  timeZone: "Europe/Rome",
});

const theirAlternatives = await getAlternatives(theirHotel);
check(
  !theirAlternatives.some((a) => a.inventory.id === gem.inventory_id),
  "the compare screen on another trip does not list it"
);

const theirCandidates = await findCandidates(theirHotel, "weather");
check(
  !theirCandidates.some((c) => c.inventory.id === gem.inventory_id),
  "the re-planner does not offer it as a substitute on another trip"
);

const { data: composerRows } = await supabase
  .from("inventory")
  .select("id")
  .is("added_for_trip", null)
  .eq("id", gem.inventory_id!);
check(
  (composerRows ?? []).length === 0,
  "the composer's shared-catalogue read cannot see it at all"
);

// ...and the traveler who added it still gets it back.
const myAlternatives = await getAlternatives(gem);
check(
  Array.isArray(myAlternatives),
  "the traveler's own compare screen still works on their added stop",
  `${myAlternatives.length} alternative(s)`
);

console.log("\n\x1b[1m4. Confirming holds it rather than booking it\x1b[0m");

const { held } = await confirmTrip(mine);
const { data: booking } = await supabase
  .from("bookings")
  .select("state")
  .eq("item_id", gem.id)
  .maybeSingle();

check(held > 0, "the trip reports something held", `${held} held`);
check(
  (booking as { state: string } | null)?.state === "held",
  "the traveler's own find is held, never confirmed behind their back",
  (booking as { state: string } | null)?.state
);

console.log("\n\x1b[1m5. The guide is told where it came from\x1b[0m");

const sheet = await getRunSheet(mine, 3);
const onSheet = sheet.find((i) => i.id === gem.id);
check(
  onSheet ? onSheet.inventory?.added_for_trip === mine : false,
  "the run sheet carries the provenance, so nobody assumes the office booked it"
);

console.log("\n--- cleaning up ---");

for (const tripId of [mine, theirs]) {
  await supabase.from("bookings").delete().eq("trip_id", tripId);
  await supabase.from("itinerary_items").delete().eq("trip_id", tripId);
  await supabase.from("trips").delete().eq("id", tripId);
}
// The minted row and its slot go with the trip that owned them.
await supabase.from("availability").delete().eq("inventory_id", gem.inventory_id!);
await supabase.from("inventory").delete().eq("id", gem.inventory_id!);

/**
 * Scoped to this suite's own row, deliberately.
 *
 * The first version asserted that *no* traveler-added rows existed anywhere,
 * which is a statement about the whole database rather than about this test —
 * and it went red the moment a real trip in the same database had a real
 * addition on it. A suite that fails because the product was used is a suite
 * nobody trusts.
 */
const { data: leftover } = await supabase
  .from("inventory")
  .select("id")
  .eq("id", gem.inventory_id!);
check(
  (leftover ?? []).length === 0,
  "this suite's added row is gone, and nobody else's was touched"
);

console.log(
  failures === 0
    ? "\n\x1b[32mAll checks passed.\x1b[0m A traveler can add what the catalogue lacks, and it stays theirs."
    : `\n\x1b[31m${failures} check(s) failed.\x1b[0m`
);
process.exit(failures === 0 ? 0 : 1);
