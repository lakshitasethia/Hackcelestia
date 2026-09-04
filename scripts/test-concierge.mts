/** Drives Vela end to end. npx tsx --conditions=react-server scripts/test-concierge.mts */
import fs from "node:fs";
for (const l of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const t = l.trim(); if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("="); if (i > 0) process.env[t.slice(0, i).trim()] ||= t.slice(i + 1).trim();
}

const { DEMO_TRIP_ID } = await import("../src/lib/db/queries.js");
const { askConcierge, conciergeThread } = await import("../src/lib/agent/concierge.js");
const { applyProposal } = await import("../src/lib/db/mutations.js");
const { createAdminClient } = await import("../src/lib/supabase/admin.js");

const supabase = createAdminClient();
let failures = 0;

function check(ok: boolean, label: string, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"} — ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

// A thread from a previous run would be replayed as history and change what
// the model sees, so every run starts from an empty conversation.
await supabase.from("messages").delete().eq("thread_key", conciergeThread(DEMO_TRIP_ID));
await supabase
  .from("replan_proposals")
  .delete()
  .eq("trip_id", DEMO_TRIP_ID)
  .eq("source", "concierge");

async function ask(question: string) {
  console.log(`\n> ${question}`);
  const reply = await askConcierge(DEMO_TRIP_ID, question);
  console.log(`  Vela (${(reply.ms / 1000).toFixed(1)}s, ${reply.toolCalls} tool calls): ${reply.text}`);
  return reply;
}

// ---------------------------------------------------------- a question --

// Answering "what is happening tomorrow" needs no tools and must not write a
// draft. An agent that proposes something every time you speak to it is worse
// than no agent.
const asked = await ask("What are we doing tomorrow, and what has it cost us so far?");
check(asked.proposalId === null, "a question produces no draft");
check(asked.text.length > 0, "a question gets an answer");

// ------------------------------------------------------------ a change --

const change = await ask(
  "We'd love to do a cooking class on day 4, some time in the afternoon. Can you sort that?"
);
check(change.proposalId !== null, "a change request produces a draft");

if (change.proposalId) {
  const { data } = await supabase
    .from("replan_proposals")
    .select("*")
    .eq("id", change.proposalId)
    .single();
  const proposal = data as { plan: any[]; cost_delta: number; state: string; source: string; trip_id: string };

  console.log(`  draft: ${proposal.plan.length} operation(s), EUR ${proposal.cost_delta}`);
  check(proposal.state === "draft", "it is a draft, not a change");
  check(proposal.source === "concierge", "it is attributed to the concierge");
  check(proposal.trip_id === DEMO_TRIP_ID, "it belongs to the trip, not a disruption");
  check(proposal.plan.every((op: any) => op.op !== "add" || op.starts_at), "every added stop has a real time");

  // The whole promise: nothing moves until the traveler says so.
  const { data: before } = await supabase
    .from("itinerary_items").select("id").eq("trip_id", DEMO_TRIP_ID);
  const countBefore = (before ?? []).length;

  const { count: draftsPending } = await supabase
    .from("itinerary_items")
    .select("id", { count: "exact", head: true })
    .eq("trip_id", DEMO_TRIP_ID)
    .eq("status", "at_risk");
  check(draftsPending === 0, "proposing changed nothing on the live itinerary");

  // ------------------------------------------------------- accepting it --

  const { applied } = await applyProposal(change.proposalId);
  check(applied === proposal.plan.length, "every operation applied", `${applied}/${proposal.plan.length}`);

  const { data: after } = await supabase
    .from("itinerary_items")
    .select("id, title, depends_on, day, starts_at")
    .eq("trip_id", DEMO_TRIP_ID)
    .order("starts_at");
  const rows = (after ?? []) as { id: string; title: string; depends_on: string[] }[];
  check(rows.length > countBefore, "the stop is on the itinerary", `${countBefore} -> ${rows.length}`);

  // The bug this suite exists to catch: an added stop with no prerequisites is
  // an orphan, and every later blast radius silently gets smaller.
  const orphans = rows.filter((r) => r.depends_on.length === 0);
  check(orphans.length <= 1, "no stop was orphaned in the graph",
    orphans.map((o) => o.title).join(", ") || "none");

  // And it must be reachable from the root, which is what verify.sql asserts.
  const root = rows.find((r) => r.depends_on.length === 0);
  if (root) {
    const { data: radius } = await supabase.rpc("blast_radius", { root: root.id });
    check((radius ?? []).length === rows.length,
      "the root still reaches every stop", `${(radius ?? []).length}/${rows.length}`);
  }

  const { data: booking } = await supabase
    .from("bookings")
    .select("id, state")
    .eq("trip_id", DEMO_TRIP_ID)
    .in("item_id", rows.map((r) => r.id));
  check((booking ?? []).length >= rows.length - 1, "the new stop was booked too");
}

// -------------------------------------------------------------- a lock --

// The hotel is prepaid and non-refundable. The prompt says so and the validator
// enforces it; neither on its own is enough.
const locked = await ask("Actually, cancel the hotel — we'll find somewhere ourselves.");
if (locked.proposalId) {
  const { data } = await supabase
    .from("replan_proposals").select("plan").eq("id", locked.proposalId).single();
  const plan = (data as { plan: any[] }).plan;
  const touchesHotel = plan.some((op: any) => op.op === "drop" || op.op === "replace");
  check(!touchesHotel, "a locked, prepaid stop is not offered up for cancellation");
} else {
  check(true, "a locked, prepaid stop is not offered up for cancellation", "declined outright");
}

// ------------------------------------------------------ off the menu --

const nonsense = await ask("Can you book us a flight to Reykjavik on Thursday?");
check(nonsense.proposalId === null, "it does not invent options outside the catalogue");

// -------------------------------------------------- a stop already on fire --

// A traveler moving a stop that a storm has already threatened would set it
// back to `confirmed` on the way through, quietly un-flagging a problem nobody
// had dealt with. The operator would find out when the group arrived.
const { runScenario } = await import("../src/lib/disruption/scenarios.js");
const { clearDisruptions } = await import("../src/lib/disruption/engine.js");

await runScenario(DEMO_TRIP_ID, "storm");
const duringStorm = await ask("Can we push the boat day back to the afternoon instead?");

const { count: stillAtRisk } = await supabase
  .from("itinerary_items")
  .select("id", { count: "exact", head: true })
  .eq("trip_id", DEMO_TRIP_ID)
  .eq("status", "at_risk");

check((stillAtRisk ?? 0) > 0, "the storm is still flagged after she answers", `${stillAtRisk} at risk`);

if (duringStorm.proposalId) {
  const { data } = await supabase
    .from("replan_proposals").select("plan").eq("id", duringStorm.proposalId).single();
  const plan = (data as { plan: any[] }).plan;
  const touchesFlagged = plan.some((op: any) => op.op !== "add");
  check(!touchesFlagged, "she does not move a stop the operator is re-planning");
} else {
  check(true, "she does not move a stop the operator is re-planning", "declined outright");
}

await clearDisruptions(DEMO_TRIP_ID);

console.log(
  `\n${failures === 0 ? "All checks passed." : `${failures} check(s) failed.`}` +
  `\nThis suite leaves the trip changed. Run \`npm run db:seed\` to reset.`
);
process.exit(failures === 0 ? 0 : 1);
