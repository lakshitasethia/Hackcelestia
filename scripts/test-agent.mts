/** Runs the re-planner against a freshly injected storm. npx tsx --conditions=react-server scripts/test-agent.mts */
import fs from "node:fs";
for (const l of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const t = l.trim(); if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("="); if (i > 0) process.env[t.slice(0, i).trim()] ||= t.slice(i + 1).trim();
}
const { DEMO_TRIP_ID } = await import("../src/lib/db/queries.js");
const { runScenario } = await import("../src/lib/disruption/scenarios.js");
const { clearDisruptions } = await import("../src/lib/disruption/engine.js");
const { runReplanAgent } = await import("../src/lib/agent/replan.js");
const { createAdminClient } = await import("../src/lib/supabase/admin.js");

await clearDisruptions(DEMO_TRIP_ID);
const d = await runScenario(DEMO_TRIP_ID, "storm");
console.log("disruption:", d!.headline, "\n");

console.log("running agent…\n");

let result;
try {
  result = await runReplanAgent(d!.id);
} catch (error) {
  // A stack trace is the wrong output for a billing problem — say what is
  // actually wrong and where to fix it.
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("GROQ_API_KEY is not set")) {
    console.error("BLOCKED — no Groq key.\n");
    console.error("  Get one free at console.groq.com -> API Keys (no card needed),");
    console.error("  then add GROQ_API_KEY=... to .env.local.\n");
  } else if (message.includes("401") || message.toLowerCase().includes("invalid api key")) {
    console.error("BLOCKED — GROQ_API_KEY is not valid.\n");
    console.error("  Check the value in .env.local against console.groq.com.\n");
  } else if (message.toLowerCase().includes("daily token budget")) {
    // Distinguished from the minute window on purpose: the advice for one is
    // "wait" and for the other is "stop running this today".
    console.error(`BLOCKED — ${message}\n`);
    console.error("  The free tier allows 200,000 tokens a day on the re-planner's");
    console.error("  model, and a single run costs a meaningful slice of that. If you");
    console.error("  need to rehearse repeatedly, raise the cap before demo day\n");
  } else if (message.includes("429") || message.toLowerCase().includes("rate limit")) {
    console.error("Rate limited by Groq's per-minute window. Unlike a billing error");
    console.error("this DOES reset — wait a minute and run it again.\n");
  } else {
    console.error(`Agent run failed: ${message}\n`);
  }
  process.exit(1);
}

const supabase = createAdminClient();
const { data: steps } = await supabase
  .from("agent_steps").select("seq, tool_name, ms").eq("run_id", result.runId).order("seq");
console.log("TRACE:");
for (const s of (steps ?? []) as { seq: number; tool_name: string; ms: number }[]) {
  console.log(`  ${String(s.seq).padStart(2)}  ${s.tool_name.padEnd(22)} ${s.ms}ms`);
}

const { data: proposals } = await supabase
  .from("replan_proposals").select("cost_delta, rationale, plan").eq("disruption_id", d!.id);
console.log(`\nPROPOSALS (${(proposals ?? []).length}):`);
for (const p of (proposals ?? []) as { cost_delta: number; rationale: string; plan: unknown[] }[]) {
  console.log(`\n  delta EUR ${p.cost_delta} · ${p.plan.length} operations`);
  console.log(`  ${p.rationale.split("\n")[0]}`);
}
console.log(`\nSUMMARY:\n${result.summary}`);
console.log(`\n${result.steps} tool calls, ${result.proposals} proposals, ${(result.ms / 1000).toFixed(1)}s`);

// Money must be computed, never taken from the model. It reported +280 on a
// plan that actually came to -390 during development; this recomputes every
// stored delta from its own operations and fails if any drifts.
const { data: props } = await supabase
  .from("replan_proposals").select("id, cost_delta, plan").eq("disruption_id", d!.id);
const { data: allItems } = await supabase
  .from("itinerary_items").select("id, cost").eq("trip_id", DEMO_TRIP_ID);
const { data: allInv } = await supabase.from("inventory").select("id, base_cost");
const { data: allBook } = await supabase
  .from("bookings").select("item_id, penalty").eq("trip_id", DEMO_TRIP_ID);

const cost = new Map((allItems ?? []).map((i: any) => [i.id, Number(i.cost)]));
const price = new Map((allInv ?? []).map((i: any) => [i.id, Number(i.base_cost)]));
const pen = new Map((allBook ?? []).filter((b: any) => b.item_id).map((b: any) => [b.item_id, Number(b.penalty)]));

for (const p of (props ?? []) as any[]) {
  const actual = (p.plan as any[]).reduce((sum, op) => {
    const c = cost.get(op.item_id) ?? 0;
    const q = pen.get(op.item_id) ?? 0;
    const n = price.get(op.with_inventory_id ?? op.inventory_id) ?? 0;
    if (op.op === "drop") return sum + q - c;
    if (op.op === "replace") return sum + n - c + q;
    if (op.op === "add") return sum + n;
    return sum;
  }, 0);
  const stored = Number(p.cost_delta);
  const ok = Math.abs(actual - stored) < 0.01;
  console.log(`${ok ? "PASS" : "FAIL"} — cost_delta ${stored} vs recomputed ${Math.round(actual * 100) / 100}`);
  if (!ok) process.exitCode = 1;
}

// The invariant that matters most: proposing must never mutate the live plan.
const { data: items } = await supabase
  .from("itinerary_items").select("status").eq("trip_id", DEMO_TRIP_ID);
const statuses = new Set((items ?? []).map((i: { status: string }) => i.status));
console.log("\nitem statuses after run:", [...statuses].join(", "));
const mutated = statuses.has("cancelled") || statuses.has("replaced");
console.log(mutated
  ? "FAIL — the agent mutated the live itinerary"
  : "PASS — live itinerary untouched, proposals are drafts");
if (mutated) process.exitCode = 1;

/**
 * The other half of the boundary.
 *
 * Everything above proves the agent proposes without touching anything. This
 * proves a human accepting one of *its* plans — not a fixture written by the
 * test — carries the bookings and the seats with it. test:apply covers the same
 * write path with hand-built plans; only this reaches it through a real
 * generation, which is where the shapes are unpredictable.
 */
console.log("\n--- accepting an agent-authored plan ---");

const { applyProposal } = await import("../src/lib/db/mutations.js");
const { getItems, getBookings, summarize } = await import("../src/lib/db/queries.js");

const { data: drafts } = await supabase
  .from("replan_proposals")
  .select("id, cost_delta, plan, rationale")
  .eq("state", "draft")
  .order("cost_delta")
  .limit(1);

const chosen = (drafts ?? [])[0] as
  | { id: string; cost_delta: number; plan: unknown[]; rationale: string }
  | undefined;

if (!chosen) {
  console.log("SKIP — the agent recorded no draft to accept");
} else {
  console.log(`plan: ${chosen.rationale.split("\n")[0]} (EUR ${chosen.cost_delta}, ${chosen.plan.length} ops)`);
  const { applied } = await applyProposal(chosen.id);

  const after = await getItems(DEMO_TRIP_ID);
  const bookings = await getBookings(DEMO_TRIP_ID);
  const check = (label: string, ok: boolean, detail = "") => {
    console.log(`${ok ? "PASS" : "FAIL"} — ${label}${detail ? `  (${detail})` : ""}`);
    if (!ok) process.exitCode = 1;
  };

  check("every operation applied", applied === chosen.plan.length,
    `${applied}/${chosen.plan.length}`);

  const stoodDown = after.filter((i) => i.status === "cancelled" || i.status === "replaced");
  check("stops that were dropped or replaced had their bookings cancelled",
    stoodDown.every((i) => {
      const b = bookings.find((x) => x.item_id === i.id);
      return !b || b.state === "cancelled";
    }),
    `${stoodDown.length} stood down`);

  const unbooked = after.filter(
    (i) =>
      i.status === "confirmed" &&
      i.inventory_id &&
      !bookings.some((b) => b.item_id === i.id && (b.state === "confirmed" || b.state === "held"))
  );
  check("every stop still on the trip has a live booking", unbooked.length === 0,
    unbooked.map((i) => i.title).join(", ") || "none missing");

  check("nothing is left flagged at risk", !after.some((i) => i.status === "at_risk"));

  const { penaltyIfCancelled } = summarize(after, bookings);
  check("pending penalties exclude what was already cancelled",
    penaltyIfCancelled === 1280, `EUR ${penaltyIfCancelled}`);

  console.log("\nThis suite leaves the trip re-planned. Run `npm run db:seed` to reset.");
}
