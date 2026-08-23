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
  } else if (message.includes("429") || message.toLowerCase().includes("rate limit")) {
    console.error("Rate limited by Groq's free tier. Unlike a billing error this");
    console.error("DOES reset — wait a minute and run it again.\n");
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
