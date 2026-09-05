/**
 * Compare alternatives, and switch to one.
 *
 * npm run test:compare
 *
 * PS-7 asks that a traveler can "compare alternatives" and "modify different
 * components of their trip". This proves both halves against the live
 * database: that the comparison offers the right things, and that acting on it
 * leaves the itinerary, the bookings and the seat counts all agreeing.
 *
 * The last part is the one worth having. A swap implemented as an update to
 * `itinerary_items` would pass a naive test — the stop's title changes — while
 * leaving the old vendor booked, the new one unbooked and a seat held by
 * nobody. So this checks the ledger, not the label.
 *
 * Runs on a throwaway trip built from the Amalfi catalogue and deletes it
 * afterwards, giving back every seat it took.
 */
import fs from "node:fs";
for (const l of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const t = l.trim(); if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("="); if (i > 0) process.env[t.slice(0, i).trim()] ||= t.slice(i + 1).trim();
}

const { createAdminClient } = await import("../src/lib/supabase/admin.js");
const { createTrip, addItem, confirmTrip, switchStop } = await import(
  "../src/lib/db/mutations.js"
);
const { getAlternatives, getItems, getTrip } = await import(
  "../src/lib/db/queries.js"
);

let failures = 0;
const check = (ok: boolean, label: string, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} — ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const supabase = createAdminClient();
const plus = (n: number) =>
  new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

// The three Positano beds: midrange 165, boutique 320, luxury 940.
const LE_SIRENE = "19000000-0000-4000-a000-000000000001";
const VILLA_ROSA = "19000000-0000-4000-a000-000000000013";
const SAN_PIETRO = "19000000-0000-4000-a000-000000000014";

console.log("--- a trip to compare things on ---");

const tripId = await createTrip({
  title: "Compare test",
  contactName: "Test",
  partySize: 2,
  budget: null,
  startsOn: plus(1),
  endsOn: plus(3),
  prefs: {},
  operatorId: null,
  travelerId: null,
});
console.log(`trip ${tripId}`);

const hotelRow = await addItem({
  tripId,
  day: 1,
  inventoryId: LE_SIRENE,
  localTime: "15:00",
  timeZone: "Europe/Rome",
});
// A second stop that depends on the first, so the rewiring has something to
// prove. Without a downstream item, "the edges survive" is vacuously true.
const dinnerRow = await addItem({
  tripId,
  day: 1,
  inventoryId: "19000000-0000-4000-a000-000000000005",
  localTime: "20:00",
  timeZone: "Europe/Rome",
});

const hotel = hotelRow.id;
const dinner = dinnerRow.id;

await confirmTrip(tripId);

const before = await getItems(tripId);
const hotelItem = before.find((i) => i.id === hotel)!;
const dinnerItem = before.find((i) => i.id === dinner)!;

check(
  dinnerItem.depends_on.includes(hotel),
  "the dinner hangs off the hotel, so there is an edge to rewire",
  dinnerItem.depends_on.join(", ")
);

console.log("\n--- what else could this be? ---");

const options = await getAlternatives(hotelItem);
for (const o of options) {
  console.log(
    `  ${o.inventory.title.padEnd(28)} ${String(o.price).padStart(6)}  ` +
      `${o.delta > 0 ? "+" : ""}${o.delta}  ${o.blocked ?? "switchable"}`
  );
}

check(options.length > 0, "the comparison is not empty", `${options.length} options`);
check(
  options.every((o) => o.inventory.type === hotelItem.type),
  "every alternative is the same kind of thing",
  [...new Set(options.map((o) => o.inventory.type))].join(", ")
);
check(
  !options.some((o) => o.inventory.id === hotelItem.inventory_id),
  "the stop you already have is not offered as an alternative to itself"
);
check(
  options.some((o) => o.inventory.id === VILLA_ROSA) &&
    options.some((o) => o.inventory.id === SAN_PIETRO),
  "both other Positano beds are offered"
);

// The delta is the number a traveler makes the decision on, so it has to be
// the real arithmetic against what is booked, not against a list price.
const villa = options.find((o) => o.inventory.id === VILLA_ROSA)!;
check(
  villa.delta === Math.round((villa.price - Number(hotelItem.cost)) * 100) / 100,
  "the price difference is computed against what is actually booked",
  `${villa.price} - ${hotelItem.cost} = ${villa.delta}`
);
check(
  options[0].price <= options[options.length - 1].price,
  "cheapest first"
);

console.log("\n--- switching ---");

const seatsBefore = await seats(SAN_PIETRO);
const result = await switchStop({
  tripId,
  itemId: hotel,
  inventoryId: SAN_PIETRO,
  startsAt: villaSlot(options, SAN_PIETRO),
});
console.log(`applied ${result.applied} op(s), delta ${result.costDelta}`);

const after = await getItems(tripId);
const replaced = after.find((i) => i.id === hotel)!;
const fresh = after.find(
  (i) => i.inventory_id === SAN_PIETRO && i.status !== "replaced"
);

check(replaced.status === "replaced", "the old stop is marked replaced, not deleted", replaced.status);
check(Boolean(fresh), "the new stop is on the itinerary");

if (fresh) {
  check(
    Number(fresh.cost) === 940,
    "it is priced at the option that was chosen",
    String(fresh.cost)
  );

  // The edge. This is the check that would fail on a shortcut implementation.
  const dinnerAfter = after.find((i) => i.id === dinner)!;
  check(
    dinnerAfter.depends_on.includes(fresh.id),
    "the dinner now depends on the new hotel",
    dinnerAfter.depends_on.join(", ")
  );
  check(
    !dinnerAfter.depends_on.includes(hotel),
    "and no longer on the one that was swapped out"
  );
}

console.log("\n--- the ledger agrees ---");

const { data: bookingRows } = await supabase
  .from("bookings")
  .select("item_id, state, amount")
  .eq("trip_id", tripId);
const bookings = (bookingRows ?? []) as {
  item_id: string | null;
  state: string;
  amount: number;
}[];

const oldBooking = bookings.find((b) => b.item_id === hotel);
const newBooking = fresh ? bookings.find((b) => b.item_id === fresh.id) : undefined;

check(
  oldBooking?.state === "cancelled",
  "the booking behind the old stop is cancelled",
  oldBooking?.state ?? "no booking found"
);
check(
  newBooking?.state === "confirmed" || newBooking?.state === "held",
  "and the new one is booked",
  newBooking?.state ?? "no booking found"
);

const seatsAfter = await seats(SAN_PIETRO);
check(
  seatsAfter === seatsBefore - 1,
  "a seat was taken from the option switched to",
  `${seatsBefore} -> ${seatsAfter}`
);

console.log("\n--- a locked stop refuses ---");

// Le Sirene on the seeded demo trip is locked, non-refundable and prepaid.
// The comparison may still be *read* — that is how a traveler learns why they
// cannot move — but switching has to be refused rather than quietly applied.
const demo = await getTrip("7a000000-0000-4000-a000-000000000001");
if (demo) {
  const demoItems = await getItems(demo.id);
  const locked = demoItems.find((i) => i.lock_reason);
  if (locked) {
    const lockedOptions = await getAlternatives(locked);
    check(
      lockedOptions.length > 0,
      "a locked stop can still be compared",
      `${lockedOptions.length} options`
    );

    let refused = false;
    try {
      await switchStop({
        tripId: demo.id,
        itemId: locked.id,
        inventoryId: lockedOptions[0].inventory.id,
        startsAt: lockedOptions[0].startsAt,
      });
    } catch {
      refused = true;
    }
    check(refused, "but switching away from it is refused", locked.lock_reason ?? "");

    const stillThere = (await getItems(demo.id)).find((i) => i.id === locked.id);
    check(
      stillThere?.status === locked.status,
      "and the refused attempt changed nothing",
      `${locked.status} -> ${stillThere?.status}`
    );
  } else {
    check(false, "the demo trip has a locked stop to test against");
  }
}

console.log("\n--- cleaning up ---");

/**
 * Give the seats back, then delete.
 *
 * Deleting a trip cascades to its items and bookings but does *not* decrement
 * `availability.slots_taken` — there is no trigger, by design, because
 * `adjust_availability` is the one place seat movement happens and a cascade
 * cannot call it with the right sign. So releasing is the caller's job, which
 * is exactly what `test:flow` does. Getting this wrong leaks a seat per run
 * and the catalogue quietly sells out over a week of testing.
 */
for (const item of await getItems(tripId)) {
  if (item.inventory_id && item.status !== "replaced" && item.status !== "cancelled") {
    await supabase.rpc("adjust_availability", {
      p_inventory_id: item.inventory_id,
      p_starts_at: item.starts_at,
      p_delta: -1,
    });
  }
}
await supabase.from("trips").delete().eq("id", tripId);

const seatsFinal = await seats(SAN_PIETRO);
check(
  seatsFinal === seatsBefore,
  "the suite's seat is back where it started",
  `${seatsFinal} of ${seatsBefore}`
);

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);

/** Free seats for an inventory row on the first day of the test trip. */
async function seats(inventoryId: string): Promise<number> {
  const { data } = await supabase
    .from("availability")
    .select("slots_total, slots_taken")
    .eq("inventory_id", inventoryId)
    .eq("date", plus(1))
    .maybeSingle();
  const row = data as { slots_total: number; slots_taken: number } | null;
  return row ? row.slots_total - row.slots_taken : 0;
}

function villaSlot(
  options: Awaited<ReturnType<typeof getAlternatives>>,
  inventoryId: string
): string {
  const found = options.find((o) => o.inventory.id === inventoryId);
  if (!found) throw new Error("that option was not offered");
  return found.startsAt;
}
