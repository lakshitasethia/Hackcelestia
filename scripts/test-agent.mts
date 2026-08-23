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
  if (message.includes("credit balance")) {
    console.error("BLOCKED — the Anthropic account has no credits.\n");
    console.error("  The key is valid: the request reached Anthropic and came back");
    console.error("  with a workspace id, so this is billing, not authentication.\n");
    console.error("  Fix: console.anthropic.com -> Plans & Billing -> add credits.");
    console.error("  Check you are topping up the workspace the key belongs to.\n");
  } else if (message.includes("authentication") || message.includes("401")) {
    console.error("BLOCKED — ANTHROPIC_API_KEY is not valid.\n");
    console.error("  Check the value in .env.local against console.anthropic.com.\n");
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

// The invariant that matters most: proposing must never mutate the live plan.
const { data: items } = await supabase
  .from("itinerary_items").select("status").eq("trip_id", DEMO_TRIP_ID);
const statuses = new Set((items ?? []).map((i: { status: string }) => i.status));
console.log("\nitem statuses after run:", [...statuses].join(", "));
console.log(statuses.has("cancelled") || statuses.has("replaced")
  ? "FAIL — the agent mutated the live itinerary"
  : "PASS — live itinerary untouched, proposals are drafts");
