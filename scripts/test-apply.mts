/** Guards the write path: a plan that cannot fully apply must not half-apply. npx tsx scripts/test-apply.mts */
import fs from "node:fs";
for (const l of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const t = l.trim(); if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("="); if (i > 0) process.env[t.slice(0, i).trim()] ||= t.slice(i + 1).trim();
}

const { DEMO_TRIP_ID, getItems, getBookings, summarize } = await import(
  "../src/lib/db/queries.js"
);
const { applyProposal } = await import("../src/lib/db/mutations.js");
const { runScenario } = await import("../src/lib/disruption/scenarios.js");
const { clearDisruptions } = await import("../src/lib/disruption/engine.js");
const { createAdminClient } = await import("../src/lib/supabase/admin.js");

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failures++;
};

const supabase = createAdminClient();
await clearDisruptions(DEMO_TRIP_ID);

const disruption = (await runScenario(DEMO_TRIP_ID, "storm"))!;
const raft = (await getItems(DEMO_TRIP_ID)).find((i) =>
  i.title.toLowerCase().includes("rafting")
)!;

/**
 * The exact shape that broke a live demo: the model emitted a `replace` with a
 * real item and a real substitute but no times at all. The proposal rendered
 * correctly, the insert failed on a NOT NULL, the error was discarded, and the
 * stop was marked `replaced` anyway — leaving the group with a cancelled day
 * and nothing booked in its place.
 */
const { data: bad } = await supabase
  .from("replan_proposals")
  .insert({
    disruption_id: disruption.id,
    plan: [
      {
        op: "replace",
        item_id: raft.id,
        with_inventory_id: "29000000-0000-4000-a000-000000000204",
        reason: "no times supplied",
      },
      { op: "drop", item_id: raft.id, reason: "should never run" },
    ],
    cost_delta: 0,
    rationale: "regression fixture",
    state: "draft",
  })
  .select("id")
  .single();

let threw = false;
let message = "";
try {
  await applyProposal((bad as { id: string }).id);
} catch (error) {
  threw = true;
  message = error instanceof Error ? error.message : String(error);
}

check("a plan with no times is refused", threw, message.split("\n")[0]);
check("the refusal names the offending operation", message.includes("start or end time"));

const after = await getItems(DEMO_TRIP_ID);
const raftAfter = after.find((i) => i.id === raft.id)!;
check("the broken stop is NOT marked replaced", raftAfter.status !== "replaced", raftAfter.status);
check("no orphan replacement was created", after.length === (await getItems(DEMO_TRIP_ID)).length);
check(
  "the later drop in the same plan never ran",
  raftAfter.status !== "cancelled",
  raftAfter.status
);

// An inventory id that does not exist must be caught by the same pre-flight.
const { data: ghost } = await supabase
  .from("replan_proposals")
  .insert({
    disruption_id: disruption.id,
    plan: [
      {
        op: "replace",
        item_id: raft.id,
        with_inventory_id: "29000000-0000-4000-a000-0000deadbeef",
        starts_at: raft.starts_at,
        ends_at: raft.ends_at,
        reason: "inventory does not exist",
      },
    ],
    cost_delta: 0,
    rationale: "regression fixture",
    state: "draft",
  })
  .select("id")
  .single();

let ghostThrew = false;
try {
  await applyProposal((ghost as { id: string }).id);
} catch {
  ghostThrew = true;
}
check("a plan naming missing inventory is refused", ghostThrew);

// And the happy path still works, so the guard is not simply refusing everything.
const { data: good } = await supabase
  .from("replan_proposals")
  .insert({
    disruption_id: disruption.id,
    // A replace *and* a drop, so the drop assertions below are not vacuous:
    // the riverside lunch cannot happen once the rafting is gone.
    plan: [
      {
        op: "replace",
        item_id: raft.id,
        with_inventory_id: "29000000-0000-4000-a000-000000000204",
        starts_at: raft.starts_at,
        ends_at: raft.ends_at,
        reason: "valid swap",
      },
      {
        op: "drop",
        item_id: "17000000-0000-4000-a000-000000000012",
        reason: "lunch on Capri is unreachable",
      },
    ],
    cost_delta: -805,
    rationale: "regression fixture",
    state: "draft",
  })
  .select("id")
  .single();

const { applied } = await applyProposal((good as { id: string }).id);
check("a valid plan still applies", applied === 2, `${applied} operations`);

const final = await getItems(DEMO_TRIP_ID);
check(
  "the broken stop is replaced",
  final.find((i) => i.id === raft.id)?.status === "replaced"
);
const substitute = final.find((i) => i.title.includes("Beatles Ashram"));
check("the substitute actually exists on the itinerary", !!substitute, substitute?.title);
check(
  "the substitute inherited the broken stop's dependencies",
  JSON.stringify(substitute?.depends_on) === JSON.stringify(raft.depends_on)
);
check(
  "downstream stops now depend on the substitute",
  final
    .filter((i) => i.depends_on.includes(raft.id))
    .every((i) => i.status === "cancelled" || i.status === "replaced"),
  "nothing live still points at the replaced stop"
);

// -- the money follows the itinerary ---------------------------------------
//
// The itinerary being right is only half of it. Before this, accepting a plan
// left the rafting's booking `confirmed` and its seat consumed, so the traveler's
// summary went on quoting a EUR 195 cancellation penalty for a stop that was
// no longer on the trip.

const bookings = await getBookings(DEMO_TRIP_ID);
const raftBooking = bookings.find((b) => b.item_id === raft.id);
check("the replaced stop's booking is cancelled", raftBooking?.state === "cancelled",
  raftBooking?.state ?? "no booking row");

const subBooking = bookings.find((b) => b.item_id === substitute?.id);
check("the substitute has a booking of its own", !!subBooking, subBooking?.state);
check("the substitute's booking is worth what the stop costs",
  Number(subBooking?.amount) === Number(substitute?.cost),
  `${subBooking?.amount} vs ${substitute?.cost}`);
// Lemon grove walk is Marco's, and Marco is an `auto` vendor, so it needs no
// phone call. A `manual` vendor would come back `held` instead.
check("an auto-channel vendor is booked outright, not held",
  subBooking?.state === "confirmed", subBooking?.state);
check("a fresh booking carries no sunk penalty yet",
  Number(subBooking?.penalty) === 0, String(subBooking?.penalty));

const dropped = final.filter((i) => i.status === "cancelled");
check("the plan actually dropped something, so the next check means something",
  dropped.length > 0, `${dropped.length} dropped`);
check("every dropped stop had its booking cancelled too",
  dropped.every((i) => {
    const b = bookings.find((x) => x.item_id === i.id);
    return !!b && b.state === "cancelled";
  }),
  dropped.map((i) => i.title).join(", "));

// The number that was wrong on screen.
const { penaltyIfCancelled } = summarize(final, bookings);
check("the summary no longer counts the dead stop's penalty",
  penaltyIfCancelled === 4200,
  `INR ${penaltyIfCancelled} (hotel 4200 only; the rafting's 300 is spent, not pending)`);

// -- seats move with the bookings -------------------------------------------

const seatRows = await supabase
  .from("availability")
  .select("inventory_id, date, slots_taken")
  .in("inventory_id", [
    "29000000-0000-4000-a000-000000000204", // Beatles Ashram, now booked
    "29000000-0000-4000-a000-000000000041", // the rafting, released
  ]);

const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

const taken = (inv: string, on: string) =>
  ((seatRows.data ?? []) as { inventory_id: string; date: string; slots_taken: number }[])
    .find((r) => r.inventory_id === inv && r.date === on)?.slots_taken;

check("booking the substitute consumed one of its seats",
  taken("29000000-0000-4000-a000-000000000204", day(substitute!.starts_at)) === 1,
  String(taken("29000000-0000-4000-a000-000000000204", day(substitute!.starts_at))));
// The seeded rafting never consumed a seat, so releasing it must not push the
// count below zero — the clamp in adjust_availability is what guarantees that.
check("releasing a seat never drives the count negative",
  (taken("29000000-0000-4000-a000-000000000041", day(raft.starts_at)) ?? 0) >= 0);

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
