/** The operator's copilot. npx tsx --conditions=react-server scripts/test-copilot.mts */
import fs from "node:fs";
for (const l of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const t = l.trim(); if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("="); if (i > 0) process.env[t.slice(0, i).trim()] ||= t.slice(i + 1).trim();
}
const { askCopilot, COPILOT_THREAD } = await import("../src/lib/agent/copilot.js");
const { createAdminClient } = await import("../src/lib/supabase/admin.js");

const supabase = createAdminClient();
let failures = 0;
const check = (ok: boolean, label: string, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} — ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

await supabase.from("messages").delete().eq("thread_key", COPILOT_THREAD);

async function ask(question: string) {
  console.log(`\n> ${question}`);
  const reply = await askCopilot(question);
  console.log(`  Copilot (${(reply.ms / 1000).toFixed(1)}s, ${reply.toolCalls} tools): ${reply.text}`);
  return reply;
}

// The regression this suite was written for. Asked with only the next 72 hours
// in view, the copilot answered "none — all vendors are automated" while the
// board beside it said four of six. The two manual vendors are in the seed;
// the answer has to find them.
const manual = await ask("Which vendors do we have to phone rather than book automatically?");
const { data: vendors } = await supabase.from("vendors").select("name, channel");
const manualNames = ((vendors ?? []) as { name: string; channel: string }[])
  .filter((v) => v.channel === "manual")
  .map((v) => v.name);

console.log(`  (manual vendors in the database: ${manualNames.join(", ") || "none"})`);
check(manualNames.length > 0, "the seed actually has manual vendors to find");
check(
  manualNames.some((name) => manual.text.toLowerCase().includes(name.toLowerCase().split(" ")[0])),
  "it names a vendor that genuinely needs a phone call"
);
check(!/\bnone\b/i.test(manual.text), "it does not claim there are none");

const today = await ask("What is the first thing happening tomorrow, and who is it for?");
check(today.text.length > 0, "it answers a schedule question");

// Read-only is a property of the tool set, not the prompt — but it should also
// know to say so.
const write = await ask("Cancel the boat day for the Sharma party.");
check(
  /can(not|'t)|read|screen|page/i.test(write.text),
  "it declines to change anything and says where that is done"
);

const { data: items } = await supabase
  .from("itinerary_items")
  .select("id", { count: "exact", head: false })
  .eq("status", "cancelled");
check((items ?? []).length === 0, "and nothing was actually cancelled");

console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) failed.`}`);
process.exit(failures === 0 ? 0 : 1);
