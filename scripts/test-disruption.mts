/** End-to-end check of the deterministic disruption engine. npx tsx scripts/test-disruption.mts */
import fs from "node:fs";
for (const l of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const t = l.trim();
  if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("=");
  if (i > 0) process.env[t.slice(0, i).trim()] ||= t.slice(i + 1).trim();
}
const { DEMO_TRIP_ID } = await import("../src/lib/db/queries.js");
const { runScenario } = await import("../src/lib/disruption/scenarios.js");
const { assessDisruption, clearDisruptions } = await import("../src/lib/disruption/engine.js");

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failures++;
};

await clearDisruptions(DEMO_TRIP_ID);

const disruption = await runScenario(DEMO_TRIP_ID, "storm");
check("storm scenario finds a weather-sensitive target", !!disruption, disruption?.headline);
if (!disruption) process.exit(1);

const a = (await assessDisruption(disruption.id))!;
check("root is the rafting", !!a.root?.title.toLowerCase().includes("rafting"), a.root?.title);
check("blast radius is 4 items", a.affected.length === 4, `got ${a.affected.length}`);
// Lunch, then yoga, then the aarti — a three-deep chain off one activity.
check("max depth is 3", Math.max(...a.affected.map((i) => i.depth)) === 3);
check("exposure sums the affected items", a.exposure === 2050, `₹${a.exposure}`);
check("non-refundable is the rafting deposit only", a.sunk === 300, `₹${a.sunk}`);
check("candidates found", a.candidates.length > 0, `${a.candidates.length}`);
check(
  "no weather-sensitive candidate offered",
  a.candidates.every((c) => !c.inventory.weather_sensitive),
  a.candidates.map((c) => c.inventory.title).join(", ")
);
check(
  "the cancelled rafting is not offered as its own replacement",
  a.candidates.every((c) => c.inventory.id !== a.root?.inventory_id)
);
check("candidates sorted nearest first",
  a.candidates.every((c, i, arr) => i === 0 || (arr[i-1].distanceKm ?? 999) <= (c.distanceKm ?? 999)));

const { getItems } = await import("../src/lib/db/queries.js");
const flagged = (await getItems(DEMO_TRIP_ID)).filter((i) => i.status === "at_risk");
check("exactly the blast radius is flagged at_risk", flagged.length === 4, `${flagged.length} flagged`);
check("hotel is NOT flagged (upstream)", !flagged.some((i) => i.title.includes("Check in")));

const cleared = await clearDisruptions(DEMO_TRIP_ID);
const after = (await getItems(DEMO_TRIP_ID)).filter((i) => i.status === "at_risk");
check("reset removes the disruption", cleared === 1, `${cleared} removed`);
check("reset restores every flagged item", after.length === 0, `${after.length} still flagged`);

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
