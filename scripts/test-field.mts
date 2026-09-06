/** End-to-end check of the coordinator surface's data path. npx tsx scripts/test-field.mts */
import fs from "node:fs";
for (const l of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const t = l.trim();
  if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("=");
  if (i > 0) process.env[t.slice(0, i).trim()] ||= t.slice(i + 1).trim();
}

const { DEMO_TRIP_ID, getCoordinatorTrips, getRunSheet, groupByLocalDay } =
  await import("../src/lib/db/queries.js");
const { reportFieldState, findOpenDisruptionFor } = await import(
  "../src/lib/db/mutations.js"
);
const { injectDisruption, clearDisruptions } = await import(
  "../src/lib/disruption/engine.js"
);

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failures++;
};

await clearDisruptions(DEMO_TRIP_ID);

// -- the run sheet ---------------------------------------------------------

const assigned = await getCoordinatorTrips();
check("the seeded group has a coordinator", assigned.length >= 1,
  assigned[0]?.coordinator_name ?? "none");
check("assignment resolves to the demo trip",
  assigned.some((t) => t.id === DEMO_TRIP_ID));

const sheet = await getRunSheet(DEMO_TRIP_ID, 2);
check("run sheet is not empty", sheet.length > 0, `${sheet.length} stops`);

const raft = sheet.find((i) => i.title.toLowerCase().includes("rafting"));
// If tomorrow's rafting is outside the window the guide never sees the stop the
// whole demo turns on, and the failure is silent in the UI.
check("tomorrow's rafting is on the run sheet", !!raft, raft?.starts_at);

const days = groupByLocalDay(sheet);
check("run sheet splits into Today and Tomorrow",
  days.length === 2 && days[0].label === "Today" && days[1].label === "Tomorrow",
  days.map((d) => `${d.label}(${d.items.length})`).join(" "));
check("stops are in chronological order",
  sheet.every((s, i) => i === 0 || sheet[i - 1].starts_at <= s.starts_at));

// -- reporting a stop ------------------------------------------------------

const first = sheet[0];
await reportFieldState(first.id, "done");
const afterDone = await getRunSheet(DEMO_TRIP_ID, 2);
const doneItem = afterDone.find((i) => i.id === first.id)!;
check("a stop marked done reads back as done", doneItem.field_state === "done");
check("marking a stop done leaves the booking status alone",
  doneItem.status === first.status, `${first.status} -> ${doneItem.status}`);
check("the database stamps the report time", !!doneItem.field_updated_at);

// -- escalating a stop -----------------------------------------------------

if (!raft) process.exit(1);

await reportFieldState(raft.id, "issue", "River guide says the flow is too high to put in.");
check("no disruption exists until one is opened",
  (await findOpenDisruptionFor(raft.id)) === null);

const raised = await injectDisruption({
  tripId: DEMO_TRIP_ID,
  rootItemId: raft.id,
  source: "vendor",
  severity: "high",
  headline: `Flagged on the ground — ${raft.title}`,
  payload: { reported_by: "coordinator" },
});
check("flagging opens a disruption the operator can see", !!raised.id);

const flagged = (await getRunSheet(DEMO_TRIP_ID, 2)).find((i) => i.id === raft.id)!;
check("the flagged stop carries the guide's note",
  flagged.field_note === "River guide says the flow is too high to put in.", flagged.field_note ?? "");
check("the office marks the stop at risk", flagged.status === "at_risk");

// Flagging twice must add detail, not a second identical ticket in the queue.
check("a second flag finds the open disruption",
  (await findOpenDisruptionFor(raft.id)) === raised.id);

// -- reset -----------------------------------------------------------------

await clearDisruptions(DEMO_TRIP_ID);
const reset = await getRunSheet(DEMO_TRIP_ID, 2);
check("reset clears every field report",
  reset.every((i) => i.field_state === "pending"),
  reset.filter((i) => i.field_state !== "pending").map((i) => i.title).join(", "));
check("reset clears the notes with them",
  reset.every((i) => !i.field_note));
check("reset restores every at-risk stop",
  reset.every((i) => i.status !== "at_risk"));

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
