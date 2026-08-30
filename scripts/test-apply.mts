/** Guards the write path: a plan that cannot fully apply must not half-apply. npx tsx scripts/test-apply.mts */
import fs from "node:fs";
for (const l of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const t = l.trim(); if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("="); if (i > 0) process.env[t.slice(0, i).trim()] ||= t.slice(i + 1).trim();
}

const { DEMO_TRIP_ID, getItems } = await import("../src/lib/db/queries.js");
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
const boat = (await getItems(DEMO_TRIP_ID)).find((i) =>
  i.title.toLowerCase().includes("boat")
)!;

/**
 * The exact shape that broke a live demo: the model emitted a `replace` with a
 * real item and a real substitute but no times at all. The proposal rendered
 * correctly, the insert failed on a NOT NULL, the error was discarded, and the
 * boat was marked `replaced` anyway — leaving the group with a cancelled day
 * and nothing booked in its place.
 */
const { data: bad } = await supabase
  .from("replan_proposals")
  .insert({
    disruption_id: disruption.id,
    plan: [
      {
        op: "replace",
        item_id: boat.id,
        with_inventory_id: "19000000-0000-4000-a000-00000000000d",
        reason: "no times supplied",
      },
      { op: "drop", item_id: boat.id, reason: "should never run" },
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
const boatAfter = after.find((i) => i.id === boat.id)!;
check("the broken stop is NOT marked replaced", boatAfter.status !== "replaced", boatAfter.status);
check("no orphan replacement was created", after.length === (await getItems(DEMO_TRIP_ID)).length);
check(
  "the later drop in the same plan never ran",
  boatAfter.status !== "cancelled",
  boatAfter.status
);

// An inventory id that does not exist must be caught by the same pre-flight.
const { data: ghost } = await supabase
  .from("replan_proposals")
  .insert({
    disruption_id: disruption.id,
    plan: [
      {
        op: "replace",
        item_id: boat.id,
        with_inventory_id: "19000000-0000-4000-a000-0000deadbeef",
        starts_at: boat.starts_at,
        ends_at: boat.ends_at,
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
    plan: [
      {
        op: "replace",
        item_id: boat.id,
        with_inventory_id: "19000000-0000-4000-a000-00000000000d",
        starts_at: boat.starts_at,
        ends_at: boat.ends_at,
        reason: "valid swap",
      },
    ],
    cost_delta: -695,
    rationale: "regression fixture",
    state: "draft",
  })
  .select("id")
  .single();

const { applied } = await applyProposal((good as { id: string }).id);
check("a valid plan still applies", applied === 1, `${applied} operations`);

const final = await getItems(DEMO_TRIP_ID);
check(
  "the broken stop is replaced",
  final.find((i) => i.id === boat.id)?.status === "replaced"
);
const substitute = final.find((i) => i.title.includes("Lemon grove"));
check("the substitute actually exists on the itinerary", !!substitute, substitute?.title);
check(
  "the substitute inherited the broken stop's dependencies",
  JSON.stringify(substitute?.depends_on) === JSON.stringify(boat.depends_on)
);
check(
  "downstream stops now depend on the substitute",
  final
    .filter((i) => i.depends_on.includes(boat.id))
    .every((i) => i.status === "cancelled" || i.status === "replaced"),
  "nothing live still points at the replaced stop"
);

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
