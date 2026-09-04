/**
 * The re-planner's five tools, exercised without the model.
 *
 *   npm run test:replan-tools
 *
 * `test:agent` is the real suite, but it costs a meaningful slice of a daily
 * token budget and cannot run at all once that budget is spent — which is
 * exactly when you most want to know whether something is broken. This covers
 * the half of the re-planner that is deterministic: the tools do every
 * database read and write, and the model only decides the order it calls them
 * in. So a change to the data layer can break these; it cannot break the
 * ordering.
 *
 * Not a substitute for `test:agent`. It says the machinery the agent drives is
 * sound, not that the agent drives it well.
 */
import fs from "node:fs";
for (const l of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const t = l.trim();
  if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("=");
  if (i > 0) process.env[t.slice(0, i).trim()] ||= t.slice(i + 1).trim();
}

const { DEMO_TRIP_ID } = await import("../src/lib/db/queries.js");
const { injectDisruption, assessDisruption, clearDisruptions } = await import(
  "../src/lib/disruption/engine.js"
);
const { buildTools } = await import("../src/lib/agent/tools.js");
const { noTrace } = await import("../src/lib/agent/tool.js");
const { serviceRoleClient } = await import("../src/lib/db/client.js");

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failures++;
};

const db = serviceRoleClient();

await clearDisruptions(DEMO_TRIP_ID);

// The boat is the stop the whole demo turns on, so it is the one to break.
const { data: items } = await db
  .from("itinerary_items")
  .select("id, title")
  .eq("trip_id", DEMO_TRIP_ID);

const boat = (items as { id: string; title: string }[]).find((i) =>
  i.title.toLowerCase().includes("boat")
);
if (!boat) throw new Error("no boat on the seeded trip — re-run npm run db:seed");

const { id: disruptionId } = await injectDisruption({
  tripId: DEMO_TRIP_ID,
  rootItemId: boat.id,
  source: "weather",
  severity: "high",
  headline: "Storm warning — tools smoke test",
  payload: { condition: "Swell too high to sail." },
});

try {
  const assessment = await assessDisruption(disruptionId);
  const tools = buildTools(assessment, noTrace);
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));

  check("all five tools are built", tools.length === 5, tools.map((t) => t.name).join(", "));

  // -- get_blast_radius ------------------------------------------------------

  const radius = JSON.parse(await byName.get_blast_radius.run({ item_id: boat.id }));
  check("get_blast_radius returns the four affected stops", radius.length === 4,
    `${radius.length} items`);
  check("the break itself is at depth 0",
    radius.some((r: { item_id: string; depth: number }) => r.item_id === boat.id && r.depth === 0));
  // The hotel *check-in* is upstream of the boat and must not be in the radius.
  // Matching on "hotel" alone would catch "Transfer — hotel to Positano
  // marina", which is downstream and belongs there.
  check("the hotel check-in is not in the radius (it is upstream)",
    !radius.some((r: { title: string }) => r.title.toLowerCase().includes("check in")),
    radius.map((r: { title: string }) => r.title).join("; "));

  // -- search_availability ---------------------------------------------------

  const options = JSON.parse(
    await byName.search_availability.run({ item_id: boat.id })
  );
  const list = Array.isArray(options) ? options : options.options ?? [];
  check("search_availability offers replacements", list.length > 0, `${list.length} options`);
  check("and none of them is the broken boat",
    !list.some((o: { inventory_id?: string; id?: string }) =>
      (o.inventory_id ?? o.id) === boat.id));

  // -- price_option ----------------------------------------------------------

  const first = list[0] as { inventory_id: string; starts_at: string; title: string };
  const priced = JSON.parse(
    await byName.price_option.run({
      item_id: boat.id,
      with_inventory_id: first.inventory_id,
    })
  );
  check("price_option returns a numeric net delta",
    typeof priced.net_delta === "number",
    `${first.title}: ${priced.net_delta}`);
  // The boat is prepaid, so its penalty has to show up in the arithmetic —
  // this is the number the whole "what does the break cost" claim rests on.
  check("...that accounts for the forfeited deposit",
    priced.cancellation_penalty > 0 &&
      priced.net_delta ===
        Math.round((priced.replacement_cost - priced.current_cost +
          priced.cancellation_penalty) * 100) / 100,
    `${priced.replacement_cost} - ${priced.current_cost} + ${priced.cancellation_penalty}`);

  // -- check_vendor ----------------------------------------------------------

  const before = await db.from("messages").select("id", { count: "exact", head: true });
  await byName.check_vendor.run({
    inventory_id: first.inventory_id,
    starts_at: first.starts_at,
  });
  const after = await db.from("messages").select("id", { count: "exact", head: true });
  check("check_vendor leaves an outbound message behind",
    (after.count ?? 0) > (before.count ?? 0),
    `${before.count} -> ${after.count}`);

  // -- propose_replan --------------------------------------------------------

  const proposalsBefore = await db
    .from("replan_proposals").select("id", { count: "exact", head: true });

  const proposed = JSON.parse(
    await byName.propose_replan.run({
      summary: "Smoke test proposal",
      rationale: "Written by test:replan-tools, not by a model.",
      cost_delta: 0,
      operations: [
        { op: "drop", item_id: boat.id, reason: "Storm — cannot sail." },
      ],
    })
  );
  // `recorded`, not merely "not rejected": the tool reports a validation
  // refusal as {rejected} and a database failure as {error}, and only one of
  // those three shapes means a draft exists.
  check("propose_replan records a draft", proposed.recorded === true,
    JSON.stringify(proposed).slice(0, 220));

  const proposalsAfter = await db
    .from("replan_proposals").select("id", { count: "exact", head: true });
  check("propose_replan writes a draft",
    (proposalsAfter.count ?? 0) > (proposalsBefore.count ?? 0),
    `${proposalsBefore.count} -> ${proposalsAfter.count}`);

  // The boundary the whole design rests on: a proposal is a draft, and drafting
  // one must not touch the live itinerary.
  const { data: boatNow } = await db
    .from("itinerary_items").select("status").eq("id", boat.id).single();
  check("...and changes nothing on the live itinerary",
    (boatNow as { status: string }).status !== "cancelled",
    `boat is ${(boatNow as { status: string }).status}`);
} finally {
  await clearDisruptions(DEMO_TRIP_ID);
}

console.log(
  failures === 0
    ? "\nThe re-planner's machinery is sound. Ordering is still test:agent's job."
    : `\n${failures} check(s) FAILED.`
);
process.exitCode = failures === 0 ? 0 : 1;
