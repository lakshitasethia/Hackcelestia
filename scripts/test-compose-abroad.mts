/**
 * Everything after the web pass, with the web pass stubbed.
 *
 * npm run test:abroad
 *
 * `test:research` proves the live search; this proves the half that must keep
 * working when the search is slow, rate-limited or off. It feeds a hand-written
 * `ResearchResult` for Switzerland — the shape the real agent returns — through
 * ingestion, the leg graph, the composer and the currency handling, and asserts
 * that a country the catalogue was never seeded for comes out as a real
 * itinerary.
 *
 * No network beyond Supabase, so it is cheap and repeatable.
 */
import fs from "node:fs";
for (const l of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const t = l.trim(); if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("="); if (i > 0) process.env[t.slice(0, i).trim()] ||= t.slice(i + 1).trim();
}

const { ingestResearch } = await import("../src/lib/agent/catalogue.js");
const { planItinerary, commitItinerary } = await import("../src/lib/agent/compose.js");
const { loadLegGraph } = await import("../src/lib/agent/corridor.js");
const { createAdminClient } = await import("../src/lib/supabase/admin.js");
const { createTrip } = await import("../src/lib/db/mutations.js");
const { getItems } = await import("../src/lib/db/queries.js");

let failures = 0;
const check = (ok: boolean, label: string, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} — ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

import { spec, research } from "./fixture-swiss.mjs";

console.log("--- ingest ---");
const ingest = await ingestResearch(research);
console.log(`created ${ingest.created}, reused ${ingest.reused}`);
check(ingest.created + ingest.reused >= research.places.length,
  "every researched place reaches the catalogue",
  `${ingest.created + ingest.reused} of ${research.places.length + research.legs.length}`);

const supabase = createAdminClient();
const { data: sourced } = await supabase
  .from("inventory")
  .select("id, title, provisional, source_url, country, time_zone, to_city, overnight")
  .eq("country", "Switzerland");

const rows = (sourced ?? []) as Record<string, unknown>[];
check(rows.length > 0, "rows land under the right country", String(rows.length));
check(rows.every((r) => r.provisional === true),
  "every researched row is marked provisional");
check(rows.every((r) => r.time_zone === "Europe/Zurich"),
  "rows carry the destination's timezone");
check(rows.filter((r) => r.to_city).length >= research.legs.length,
  "the legs record where they go",
  String(rows.filter((r) => r.to_city).length));

console.log("\n--- vendors ---");
const { data: vendors } = await supabase
  .from("vendors").select("name, channel").ilike("name", "Researched%");
const vrows = (vendors ?? []) as { name: string; channel: string }[];
check(vrows.length > 0, "researched inventory has vendors", String(vrows.length));
/** The safety property: nothing researched can be auto-booked. */
check(vrows.every((v) => v.channel === "manual"),
  "every researched vendor is manual, so confirmTrip holds instead of reserving");

console.log("\n--- leg graph ---");
const graph = await loadLegGraph(research.cities);
check(graph.legs.length >= research.legs.length,
  "the graph is a query over the catalogue now", String(graph.legs.length));
const hop = graph.route("Zurich", "Interlaken");
check(hop.length === 2, "routes Zurich → Interlaken via Lucerne",
  hop.map((l) => `${l.from}→${l.to}`).join(", "));

console.log("\n--- compose ---");
const plan = await planItinerary(spec, {
  cityHint: research.cities,
  timeZone: research.timeZone,
  currency: research.currency,
  fxToBudget: research.fxToBudget,
});

console.log(`${plan.dayCount} days, ${plan.stops.length} stops, ` +
  `${Math.round(plan.total)} ${plan.currency} ≈ ${Math.round(plan.totalInBudget ?? 0)} ${plan.budgetCurrency}`);
for (const day of [...new Set(plan.stops.map((s) => s.day))].sort((a, b) => a - b)) {
  const stops = plan.stops.filter((s) => s.day === day);
  console.log(`  Day ${String(day).padStart(2, "0")} · ${plan.cityByDay[day]}`);
  for (const s of stops) {
    console.log(`    ${s.localTime}  ${s.title.padEnd(38)} ${String(Math.round(s.cost)).padStart(4)} CHF` +
      (s.satisfies ? `  ← ${s.satisfies}` : ""));
  }
}
for (const w of plan.warnings) console.log(`  ! ${w}`);

check(plan.stops.length >= 10, "plans a real itinerary", String(plan.stops.length));
/**
 * The invariant, not a particular day. Which day the first train falls on
 * depends on how much the catalogue can fill Zurich with, so pinning day 2
 * made this fail the moment a real research pass added more to do there — a
 * test failing for a reason that is not a bug is worse than no test.
 */
const travelDays = [...new Set(plan.stops.map((s) => s.day))].filter((d) =>
  plan.stops.some((s) => s.day === d && s.title.startsWith("Train:"))
);
const mislabelled = travelDays.filter((d) => {
  const leg = plan.stops.find((s) => s.day === d && s.title.startsWith("Train:"))!;
  // A leg's own `city` is where it departs; the day belongs to where it lands.
  return plan.cityByDay[d] === leg.city;
});
check(
  travelDays.length > 0 && mislabelled.length === 0,
  "every travel day is labelled with where you end up, not where you left",
  `${travelDays.length} travel days, ${mislabelled.length} mislabelled`
);

/** No stop should appear twice under two spellings. */
const norm = (t: string) =>
  t.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)
   .filter((w) => w && !["the","a","an","and","of","to","in","at"].includes(w))
   .sort().join(" ");
const seen = new Map<string, string>();
const dupes: string[] = [];
for (const s of plan.stops.filter((s) => !s.title.startsWith("Train:"))) {
  const k = `${s.city}|${norm(s.title)}`;
  if (seen.has(k) && seen.get(k) !== s.title) dupes.push(`${seen.get(k)} / ${s.title}`);
  else if (!seen.has(k)) seen.set(k, s.title);
}
check(dupes.length === 0, "the same place never appears twice under two spellings",
  dupes.join("; ") || "none");
check(
  plan.warnings.some((w) => w.includes("of your 13 days")),
  "says so when it fills fewer days than were asked for",
  plan.warnings.find((w) => w.includes("days")) ?? "NO WARNING"
);
check(plan.cities.length === 4, "uses all four towns", plan.cities.join(" → "));
check(plan.cities[0] === "Zurich", "starts where the research said to", plan.cities[0]);
check(plan.timeZone === "Europe/Zurich", "the trip is read in Swiss time", plan.timeZone);
check(plan.currency === "CHF" && plan.budgetCurrency === "INR",
  "keeps the two currencies apart", `${plan.currency}/${plan.budgetCurrency}`);
/**
 * The budget has to be denominated in the same money as the plan, or the trip
 * page compares a rupee figure to a franc one and reports being 398,078 francs
 * under a 400,000 franc budget.
 */
check(
  plan.budgetInPlanCurrency !== null &&
    Math.abs(plan.budgetInPlanCurrency - 400000 / 105) < 1,
  "the budget is converted into the plan's own currency",
  `${Math.round(plan.budgetInPlanCurrency ?? 0)} CHF`
);
check(
  plan.budgetInPlanCurrency !== null && plan.total < plan.budgetInPlanCurrency,
  "and the comparison then makes sense",
  `${Math.round(plan.total)} vs ${Math.round(plan.budgetInPlanCurrency ?? 0)} CHF`
);

check(plan.totalInBudget !== null && Math.abs(plan.totalInBudget - plan.total * 105) < 1,
  "converts the total at the researched rate",
  `${Math.round(plan.total)}×105 = ${Math.round(plan.totalInBudget ?? 0)}`);
check(plan.stops.some((s) => s.satisfies === "chocolate factory"),
  "the compulsory chocolate factory is in the plan",
  plan.stops.find((s) => s.satisfies === "chocolate factory")?.title ?? "MISSING");
check(plan.stops.some((s) => s.title.includes("Train:")),
  "the trains between towns are real stops");
check(
  [...new Set(plan.stops.map((s) => s.day))].length >= 6,
  "spreads over the calendar", String([...new Set(plan.stops.map((s) => s.day))].length)
);
/**
 * Nothing may be scheduled before it opens.
 *
 * Checked against what the catalogue actually holds, not against the fixture.
 * Ingestion reuses a stored row when one already matches, so on a database that
 * has seen a real research pass the fixture's opening times are not the ones in
 * play — and a test asserting them fails for a reason that has nothing to do
 * with the scheduler it is meant to be testing.
 */
const { data: openingRows } = await supabase
  .from("inventory")
  .select("title, opens_at")
  .eq("country", "Switzerland")
  .not("opens_at", "is", null);

const opensByTitle = new Map(
  ((openingRows ?? []) as { title: string; opens_at: string }[]).map((r) => [
    r.title,
    r.opens_at.slice(0, 5),
  ])
);

const tooEarly = plan.stops.filter((s) => {
  const opens = opensByTitle.get(s.title);
  return opens && s.localTime < opens;
});
check(tooEarly.length === 0, "nothing is scheduled before it opens",
  tooEarly.map((s) => `${s.title}@${s.localTime} opens ${opensByTitle.get(s.title)}`).join(", ") || "none");

console.log("\n--- commit ---");
const tripId = await createTrip({
  title: spec.title!,
  contactName: "Test traveler",
  partySize: 2,
  budget: spec.budget,
  startsOn: spec.startsOn!,
  endsOn: spec.endsOn!,
  prefs: { interests: spec.interests, pace: "moderate" },
});
await commitItinerary(tripId, plan, spec);

const items = await getItems(tripId);
check(items.length === plan.stops.length,
  "every planned stop becomes an itinerary row", `${items.length}/${plan.stops.length}`);
check(items.some((i) => i.depends_on.length > 0),
  "the stops chain into a graph, so blast radius still works");

const { data: trip } = await supabase
  .from("trips").select("time_zone, currency, destinations, ends_on").eq("id", tripId).single();
const t = trip as { time_zone: string; currency: string; destinations: string[]; ends_on: string };
check(t.time_zone === "Europe/Zurich", "the trip stores the Swiss timezone", t.time_zone);
check(t.destinations.length === 4, "the trip records where it goes", t.destinations.join(", "));

console.log(`\nprint view: /trip/${tripId}/print`);
await supabase.from("trips").delete().eq("id", tripId);

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
