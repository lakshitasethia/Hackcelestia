/**
 * The lifecycle the brief prints, end to end.
 *
 * npm run test:lifecycle
 *
 * PS-7 draws the journey as
 *
 *   Discover -> Personalize -> Plan -> Price -> Book -> Prepare
 *            -> Operate -> Assist -> Adapt -> Complete -> Review
 *
 * Everything from Discover to Adapt already had a suite. The last two did not
 * exist at all: `trips.status` carried a 'completed' value nothing ever set,
 * and no table recorded a rating or a rupee.
 *
 * Three things are checked here.
 *
 *   1. `tripStage` — the pure function that decides where a trip is and what
 *      to do next. Every surface renders its answer, so a wrong answer here is
 *      a wrong next-step button on three screens at once.
 *   2. Payments — that the ledger arithmetic is right, including the sign,
 *      which is the thing a refund gets wrong.
 *   3. Complete and Review — including the two refusals that make them
 *      meaningful: a trip that is still running cannot be closed, and a second
 *      rating from the same person replaces the first rather than stacking.
 *
 * No model calls. Runs against the live database on a throwaway trip.
 */
import fs from "node:fs";
for (const l of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const t = l.trim(); if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("="); if (i > 0) process.env[t.slice(0, i).trim()] ||= t.slice(i + 1).trim();
}

const { createAdminClient } = await import("../src/lib/supabase/admin.js");
const { createTrip, addItem, confirmTrip, recordPayment, completeTrip, saveReview } =
  await import("../src/lib/db/mutations.js");
const { getItems, getBookings, getPayments, getReviews, getTrip, summarizePayments } =
  await import("../src/lib/db/queries.js");
const { tripStage } = await import("../src/lib/trip/stage.js");

import type { Booking, ItineraryItem, Review, Trip } from "../src/lib/db/types.js";

let failures = 0;
const check = (ok: boolean, label: string, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} — ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const supabase = createAdminClient();
const day = (n: number) =>
  new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

/* ------------------------------------------------------------- the stage -- */

console.log("--- where is this trip, and what do I press ---");

const blank = {
  items: [] as ItineraryItem[],
  bookings: [] as Booking[],
  reviews: [] as Review[],
  openDisruptions: 0,
  today: day(0),
};
const fakeTrip = (over: Partial<Trip>): Trip =>
  ({
    id: "t",
    status: "draft",
    starts_on: day(10),
    ends_on: day(14),
    time_zone: "Asia/Kolkata",
    currency: "INR",
    prefs: {},
    ...over,
  }) as Trip;

const someItem = { id: "i1", status: "planned", cost: 100 } as ItineraryItem;

const empty = tripStage({ ...blank, trip: fakeTrip({}) });
check(empty.current === "plan", "an empty draft is at Plan", empty.current);
check(
  empty.next?.href.endsWith("/build") === true,
  "and points at the builder",
  empty.next?.label
);

const priced = tripStage({ ...blank, trip: fakeTrip({}), items: [someItem] });
check(priced.current === "book", "a draft with stops is at Book", priced.current);
check(
  priced.next?.primary === true && /confirm/i.test(priced.next.label),
  "and the primary action is confirming",
  priced.next?.label
);

const upcoming = tripStage({
  ...blank,
  trip: fakeTrip({ status: "confirmed" }),
  items: [someItem],
});
check(upcoming.current === "prepare", "booked and not yet started is Prepare", upcoming.current);

const running = tripStage({
  ...blank,
  trip: fakeTrip({ status: "confirmed", starts_on: day(-1), ends_on: day(2) }),
  items: [someItem],
});
check(running.current === "operate", "a trip under way is at Operate", running.current);

const broken = tripStage({
  ...blank,
  trip: fakeTrip({ status: "confirmed", starts_on: day(-1), ends_on: day(2) }),
  items: [someItem],
  openDisruptions: 1,
});
check(
  broken.current === "adapt",
  "an open disruption outranks everything else",
  broken.current
);

const over = tripStage({
  ...blank,
  trip: fakeTrip({ status: "confirmed", starts_on: day(-5), ends_on: day(-1) }),
  items: [someItem],
});
check(over.current === "complete", "a finished trip is at Complete", over.current);

const closed = tripStage({
  ...blank,
  trip: fakeTrip({ status: "completed", starts_on: day(-5), ends_on: day(-1) }),
  items: [someItem],
});
check(closed.current === "review", "a closed trip asks for a review", closed.current);
check(closed.next?.primary === true, "and that is the primary action");

const reviewed = tripStage({
  ...blank,
  trip: fakeTrip({ status: "completed", starts_on: day(-5), ends_on: day(-1) }),
  items: [someItem],
  reviews: [{ id: "r", rating: 5 } as Review],
});
check(
  reviewed.done.length === 11,
  "a reviewed trip has every stage behind it",
  String(reviewed.done.length)
);

const killed = tripStage({ ...blank, trip: fakeTrip({ status: "cancelled" }) });
check(
  killed.current === "complete" && killed.next === null,
  "a cancelled trip is an ending, not a Discover",
  killed.current
);

/* ---------------------------------------------------------- the ledger --- */

console.log("\n--- money ---");

const tripId = await createTrip({
  title: "Lifecycle test",
  contactName: "Test",
  partySize: 2,
  budget: null,
  startsOn: day(-3),
  endsOn: day(-1),
  prefs: {},
  operatorId: null,
  travelerId: null,
});

await addItem({
  tripId,
  day: 1,
  inventoryId: "19000000-0000-4000-a000-000000000013", // Villa Rosa, 165
  localTime: "15:00",
  timeZone: "Europe/Rome",
});
await confirmTrip(tripId);

const money0 = summarizePayments(
  await getItems(tripId),
  await getBookings(tripId),
  await getPayments(tripId)
);
check(money0.due === 165, "the amount due is the live itinerary", String(money0.due));
check(money0.paid === 0, "nothing paid yet", String(money0.paid));
check(money0.outstanding === 165, "so it is all outstanding", String(money0.outstanding));

await recordPayment({ tripId, kind: "deposit", amount: 100, method: "upi" });

const money1 = summarizePayments(
  await getItems(tripId),
  await getBookings(tripId),
  await getPayments(tripId)
);
check(money1.paid === 100, "a deposit counts towards paid", String(money1.paid));
check(money1.outstanding === 65, "and comes off the balance", String(money1.outstanding));

// The sign. A refund is a positive amount with kind 'refund', so that a stray
// minus in a form cannot turn a payment into its opposite.
await recordPayment({ tripId, kind: "refund", amount: 40 });

const money2 = summarizePayments(
  await getItems(tripId),
  await getBookings(tripId),
  await getPayments(tripId)
);
check(money2.refunded === 40, "a refund is recorded as a refund", String(money2.refunded));
check(
  money2.paid === 60,
  "and comes back off what was paid, without a negative amount",
  String(money2.paid)
);
check(money2.outstanding === 105, "the balance goes back up", String(money2.outstanding));

let rejected = false;
try {
  await recordPayment({ tripId, kind: "deposit", amount: 0 });
} catch {
  rejected = true;
}
check(rejected, "a zero payment is refused");

/* --------------------------------------------------- complete & review --- */

console.log("\n--- closing out ---");

// A trip still running cannot be closed: reviewing is what completion opens,
// and a group cannot rate a dinner they have not eaten yet.
const futureTrip = await createTrip({
  title: "Lifecycle future",
  contactName: "Test",
  partySize: 1,
  budget: null,
  startsOn: day(5),
  endsOn: day(9),
  prefs: {},
  operatorId: null,
  travelerId: null,
});
await addItem({
  tripId: futureTrip,
  day: 1,
  inventoryId: "19000000-0000-4000-a000-000000000013",
  localTime: "15:00",
  timeZone: "Europe/Rome",
});
await confirmTrip(futureTrip);

let refusedFuture = false;
try {
  await completeTrip(futureTrip);
} catch {
  refusedFuture = true;
}
check(refusedFuture, "a trip that has not finished cannot be closed out");

// And a draft that was never booked has nothing to close.
const draftTrip = await createTrip({
  title: "Lifecycle draft",
  contactName: "Test",
  partySize: 1,
  budget: null,
  startsOn: day(-5),
  endsOn: day(-2),
  prefs: {},
  operatorId: null,
  travelerId: null,
});
let refusedDraft = false;
try {
  await completeTrip(draftTrip);
} catch {
  refusedDraft = true;
}
check(refusedDraft, "a trip that was never confirmed cannot be completed");

await completeTrip(tripId);
const closedTrip = await getTrip(tripId);
check(closedTrip?.status === "completed", "a finished trip closes", closedTrip?.status);
check(Boolean(closedTrip?.completed_at), "and records when");

await completeTrip(tripId); // idempotent
check(
  (await getTrip(tripId))?.status === "completed",
  "closing twice is harmless"
);

console.log("\n--- reviews ---");

const items = await getItems(tripId);
await saveReview({ tripId, itemId: null, authorId: null, rating: 5, comment: "Lovely." });
await saveReview({ tripId, itemId: items[0].id, authorId: null, rating: 2, comment: "Damp." });

let reviews = await getReviews(tripId);
check(reviews.length === 2, "a trip review and a stop review are separate rows", String(reviews.length));
check(
  reviews.some((r) => !r.item_id && r.rating === 5),
  "the trip-level review is the one with no item"
);
check(
  reviews.some((r) => r.item_id === items[0].id && r.rating === 2),
  "and the stop review points at its stop"
);

// Changing your mind replaces rather than stacks, or one unhappy traveler
// drags a vendor's average down as many times as they press the button.
await saveReview({ tripId, itemId: items[0].id, authorId: null, rating: 4, comment: "Better than I said." });
reviews = await getReviews(tripId);
check(reviews.length === 2, "re-rating does not add a row", String(reviews.length));
check(
  reviews.find((r) => r.item_id === items[0].id)?.rating === 4,
  "it updates the rating",
  String(reviews.find((r) => r.item_id === items[0].id)?.rating)
);

let badRating = false;
try {
  await saveReview({ tripId, itemId: null, authorId: null, rating: 9 });
} catch {
  badRating = true;
}
check(badRating, "a rating outside 1-5 is refused");

/* ------------------------------------------------------------ cleanup --- */

console.log("\n--- cleaning up ---");
for (const id of [tripId, futureTrip, draftTrip]) {
  for (const item of await getItems(id)) {
    if (item.inventory_id && item.status !== "replaced" && item.status !== "cancelled") {
      await supabase.rpc("adjust_availability", {
        p_inventory_id: item.inventory_id,
        p_starts_at: item.starts_at,
        p_delta: -1,
      });
    }
  }
  await supabase.from("trips").delete().eq("id", id);
}
const { data: leftover } = await supabase
  .from("trips")
  .select("id")
  .in("id", [tripId, futureTrip, draftTrip]);
check(((leftover ?? []) as unknown[]).length === 0, "the test trips are removed");

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
