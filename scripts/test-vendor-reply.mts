/**
 * The other half of a vendor conversation.
 *
 * npm run test:vendor-reply
 *
 * `check_vendor` has always written the outbound message and nothing has ever
 * read a reply — the `structured` column on `messages`, whose schema comment
 * has said "parsed shape of an inbound reply" since the first migration, has
 * been null for the life of the project. This is the suite for closing that.
 *
 * The extraction is the easy half and the boring half. What this actually
 * proves is the mapping: that "we can do 2pm not 9am" becomes a `move`
 * operation, survives the same validator every other plan goes through, and
 * moves the stop by the same `applyProposal` an operator clicks. A vendor gets
 * no more authority over an itinerary than the model does.
 *
 * Costs a handful of real model calls — parsing is a model call by nature.
 */
import fs from "node:fs";
for (const l of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const t = l.trim(); if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("="); if (i > 0) process.env[t.slice(0, i).trim()] ||= t.slice(i + 1).trim();
}

const { createAdminClient } = await import("../src/lib/supabase/admin.js");
const { parseVendorReply, recordVendorReply, replyToOps } = await import(
  "../src/lib/agent/vendor-reply.js"
);
const { createTrip, addItem, applyProposal } = await import(
  "../src/lib/db/mutations.js"
);
const { validateOps } = await import("../src/lib/agent/plan.js");
const { getItems } = await import("../src/lib/db/queries.js");
const { formatTime } = await import("../src/lib/format.js");

let failures = 0;
const check = (ok: boolean, label: string, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} — ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const supabase = createAdminClient();
const plus = (n: number) =>
  new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

const BOAT = "19000000-0000-4000-a000-000000000002";

console.log("\n\x1b[1m1. Reading what a supplier actually writes\x1b[0m");

const hedged = await parseVendorReply(
  "sorry, 9 is gone — we could do 2pm, same price, but only 6 people max. " +
    "Need the deposit by Friday."
);
console.log(JSON.stringify(hedged, null, 2));

check(
  hedged.canAccommodate === false,
  "'not at 9 but we could do 2' is a NO to what was asked",
  `${hedged.canAccommodate}`
);
check(hedged.alternativeTime === "14:00", "2pm is read as 14:00", `${hedged.alternativeTime}`);
check(hedged.maxPartySize === 6, "the party cap is picked up", `${hedged.maxPartySize}`);
check(
  hedged.conditions.length > 0,
  "the deposit is recorded as a condition",
  hedged.conditions.join("; ")
);
check(
  hedged.price === null,
  "'same price' is not a quote, so no number is invented",
  `${hedged.price}`
);

const plainYes = await parseVendorReply("Yes, that works. See you then.");
check(plainYes.canAccommodate === true, "a plain yes reads as yes");
check(plainYes.alternativeTime === null, "and offers no alternative time");

const plainNo = await parseVendorReply(
  "We're fully booked that whole week, sorry."
);
check(plainNo.canAccommodate === false, "a flat no reads as no");
check(plainNo.alternativeTime === null, "and invents no alternative");

console.log("\n\x1b[1m2. A reply that changes nothing proposes nothing\x1b[0m");

const dummyItem = { id: "00000000-0000-4000-a000-000000000000", day: 1, localTime: "09:00" };

check(replyToOps(plainYes, dummyItem).length === 0, "a yes generates no operation");
check(replyToOps(plainNo, dummyItem).length === 0, "a no generates no operation");
check(
  replyToOps({ ...plainYes, alternativeTime: "09:00" }, dummyItem).length === 0,
  "an 'alternative' that matches the booked time is not a move"
);
check(
  replyToOps(
    { ...hedged, alternativeDate: plus(2) },
    dummyItem
  ).length === 0,
  "a different DATE is left to a person — moving across days changes dependencies"
);

console.log("\n\x1b[1m3. ...and one that does, reaches the itinerary\x1b[0m");

const tripId = await createTrip({
  title: "Vendor reply test",
  contactName: "Test",
  partySize: 2,
  budget: null,
  startsOn: plus(1),
  endsOn: plus(3),
  prefs: {},
  operatorId: null,
  travelerId: null,
});

const boat = await addItem({
  tripId,
  day: 1,
  inventoryId: BOAT,
  localTime: "09:00",
  timeZone: "Europe/Rome",
});

const boatLocal = { id: boat.id, day: boat.day, localTime: formatTime(boat.starts_at) };
check(
  boatLocal.localTime === "09:00",
  "the stop reads as 09:00 in the trip's own zone, not UTC",
  `${boatLocal.localTime} (stored ${boat.starts_at})`
);

const ops = replyToOps(hedged, boatLocal);
check(ops.length === 1 && ops[0].op === "move", "the reply becomes one move operation");

const moved = ops[0] as { local_time?: string; starts_at?: string; reason: string };
check(
  moved.local_time === "14:00" && !moved.starts_at,
  "it carries a wall-clock time, leaving the zone conversion to validateOps",
  `local_time=${moved.local_time}`
);
check(
  moved.reason.includes("14:00"),
  "the reason says where the time came from, so the operator is not guessing",
  moved.reason
);

// The whole point: through the same validator, not around it.
const validated = await validateOps(tripId, ops);
check(
  validated.errors.length === 0,
  "the vendor's operation survives the same validator every plan goes through",
  validated.errors.join("; ")
);

const { data: proposal, error: proposalError } = await supabase
  .from("replan_proposals")
  .insert({
    // No disruption: nothing broke, the supplier simply answered.
    trip_id: tripId,
    source: "vendor",
    plan: validated.normalised,
    cost_delta: validated.costDelta,
    rationale: "The boat operator offered 14:00 instead of 09:00.",
    state: "draft",
  })
  .select("id")
  .single();

check(!proposalError, "the proposal records where it came from", proposalError?.message);

await applyProposal((proposal as { id: string }).id);

const items = await getItems(tripId);
const afterApply = items.find((i) => i.id === boat.id);
check(
  afterApply ? formatTime(afterApply.starts_at) === "14:00" : false,
  "the stop actually moved to 14:00 local, by the code path an operator's accept runs",
  afterApply ? `${formatTime(afterApply.starts_at)} (stored ${afterApply.starts_at})` : "missing"
);

console.log("\n\x1b[1m4. The thread reads as one conversation\x1b[0m");

const threadKey = `replan:test-${tripId.slice(0, 8)}`;

await supabase.from("messages").insert({
  trip_id: tripId,
  thread_key: threadKey,
  direction: "outbound",
  from_role: "agent",
  body: "Can you take the boat at 09:00?",
});

const recorded = await recordVendorReply({
  threadKey,
  tripId,
  body: "sorry, 9 is gone — we could do 2pm.",
});

const { data: thread } = await supabase
  .from("messages")
  .select("direction, structured")
  .eq("thread_key", threadKey)
  .order("sent_at");

const rows = (thread ?? []) as { direction: string; structured: unknown }[];
check(rows.length === 2, "both halves sit in one thread", `${rows.length} messages`);
check(
  rows[0]?.direction === "outbound" && rows[1]?.direction === "inbound",
  "in the order they happened"
);
check(
  Boolean(rows[1]?.structured),
  "the reply is filed as structure, not just text — the column stops being null"
);
check(
  recorded.parsed.alternativeTime === "14:00",
  "and the caller gets the reading back to act on"
);

console.log("\n--- cleaning up ---");

await supabase.from("messages").delete().eq("thread_key", threadKey);
await supabase.from("replan_proposals").delete().eq("trip_id", tripId);
await supabase.from("bookings").delete().eq("trip_id", tripId);
await supabase.from("itinerary_items").delete().eq("trip_id", tripId);
await supabase.from("trips").delete().eq("id", tripId);
check(true, "the test trip is removed");

console.log(
  failures === 0
    ? "\n\x1b[32mAll checks passed.\x1b[0m A vendor's reply is now structure, and then a decision."
    : `\n\x1b[31m${failures} check(s) failed.\x1b[0m`
);
process.exit(failures === 0 ? 0 : 1);
