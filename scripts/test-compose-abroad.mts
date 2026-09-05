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
check(
  plan.cityByDay[2] === "Lucerne",
  "a travel day is labelled with where you end up, not where you left",
  plan.cityByDay[2]
);
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
/** Nothing may be scheduled before it opens. */
const tooEarly = plan.stops.filter((s) => {
  const item = research.places.find((p) => p.title === s.title);
  return item?.opensAt && s.localTime < item.opensAt;
});
check(tooEarly.length === 0, "nothing is scheduled before it opens",
  tooEarly.map((s) => `${s.title}@${s.localTime}`).join(", "));

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
