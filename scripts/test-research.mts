/**
 * India to Switzerland — the trip the catalogue could not plan.
 *
 * npm run test:research
 *
 * This is the end-to-end the whole feature exists for: a sentence naming a
 * country nothing was ever seeded for, through intake, a live web research
 * pass, catalogue ingestion, and the composer, to a plan with real prices and
 * real sources. It hits the network and it costs Groq tokens, so it is not in
 * `test:all`.
 */
import fs from "node:fs";
for (const l of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const t = l.trim(); if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("="); if (i > 0) process.env[t.slice(0, i).trim()] ||= t.slice(i + 1).trim();
}

const { extractTripSpec } = await import("../src/lib/agent/intake.js");
const { researchTrip } = await import("../src/lib/agent/research.js");
const { ingestResearch } = await import("../src/lib/agent/catalogue.js");
const { planItinerary } = await import("../src/lib/agent/compose.js");

let failures = 0;
const check = (ok: boolean, label: string, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} — ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const DESCRIPTION =
  "I want to take a trip from India to Switzerland for around 12 to 13 days. " +
  "Two of us, arriving on 2 October 2026 and flying home on 14 October 2026. " +
  "Budget is about 4 lakh rupees total. Keep the stays budget-friendly. " +
  "Switzerland is known for its chocolate so a chocolate factory is compulsory, " +
  "and we want the mountains and the scenic trains.";

console.log("--- intake ---");
const t0 = Date.now();
const spec = await extractTripSpec(DESCRIPTION);
console.log(JSON.stringify(spec, null, 2));

check(spec.origin?.toLowerCase().includes("india") ?? false,
  "reads India as the origin, not a destination", spec.origin ?? "null");
check(!spec.destinations.some((d) => d.toLowerCase() === "india"),
  "does not plan days in the country they are leaving", spec.destinations.join(", "));
check(spec.destinations.some((d) => d.toLowerCase().includes("switz")),
  "keeps Switzerland as the destination", spec.destinations.join(", "));
check(spec.startsOn === "2026-10-02", "reads the arrival date", String(spec.startsOn));
check(spec.endsOn === "2026-10-14", "reads the departure date", String(spec.endsOn));
check(spec.currency === "INR", "budget currency is the traveler's, not the destination's", spec.currency);
check(spec.budget === 400000, "reads '4 lakh' as 400000", String(spec.budget));
check(spec.mustDo.length > 0, "records the chocolate factory as a must-do", spec.mustDo.join("; "));

console.log(`\n--- research (live web) --- ${((Date.now() - t0) / 1000).toFixed(1)}s in`);
const t1 = Date.now();
const research = await researchTrip(spec);
const researchSecs = (Date.now() - t1) / 1000;

console.log(`country=${research.country} currency=${research.currency} ` +
  `tz=${research.timeZone} fx=${research.fxToBudget}`);
console.log(`cities: ${research.cities.join(" → ")}`);
console.log(`places: ${research.places.length}, legs: ${research.legs.length}, ` +
  `sources: ${research.sources.length}`);
console.log(`took ${researchSecs.toFixed(1)}s`);
for (const note of research.notes) console.log(`  note: ${note}`);

check(research.cities.length >= 2, "researches more than one town", research.cities.join(", "));
check(research.currency === "CHF", "prices Switzerland in francs", research.currency);
check(research.timeZone === "Europe/Zurich", "gets the timezone right", research.timeZone);
check(research.places.length >= 8, "finds enough to fill the days", String(research.places.length));
check(research.places.some((p) => p.type === "hotel"), "finds somewhere to sleep");
check(
  research.places.filter((p) => p.sourceUrl).length >= research.places.length / 2,
  "most rows cite the page they came from",
  `${research.places.filter((p) => p.sourceUrl).length}/${research.places.length}`
);
check(research.legs.length >= 1, "finds the trains between the towns", String(research.legs.length));
check(
  research.fxToBudget !== null && research.fxToBudget > 50 && research.fxToBudget < 200,
  "finds a sane CHF→INR rate",
  String(research.fxToBudget)
);
check(researchSecs < 60, "finishes inside a serverless budget", `${researchSecs.toFixed(1)}s`);

console.log("\n--- ingest ---");
const ingest = await ingestResearch(research);
console.log(`created ${ingest.created}, reused ${ingest.reused}`);
check(ingest.created + ingest.reused > 0, "writes the findings into the catalogue");

console.log("\n--- compose ---");
const plan = await planItinerary(spec, {
  cityHint: research.cities,
  timeZone: research.timeZone,
  currency: research.currency,
  fxToBudget: research.fxToBudget,
});

const dayBudget =
  Math.round((Date.parse(spec.endsOn!) - Date.parse(spec.startsOn!)) / 86_400_000) + 1;

console.log(`${plan.dayCount} days (asked for ${dayBudget}), ${plan.stops.length} stops, ` +
  `${Math.round(plan.total)} ${plan.currency}` +
  (plan.totalInBudget ? ` ≈ ${Math.round(plan.totalInBudget)} ${plan.budgetCurrency}` : ""));

for (const day of [...new Set(plan.stops.map((s) => s.day))].sort((a, b) => a - b)) {
  const stops = plan.stops.filter((s) => s.day === day);
  console.log(`  Day ${String(day).padStart(2, "0")} · ${stops[0]?.city}`);
  for (const s of stops) {
    console.log(`    ${s.localTime}  ${s.title}  ${Math.round(s.cost)} ${plan.currency}` +
      (s.satisfies ? `   ← ${s.satisfies}` : ""));
  }
}
for (const w of plan.warnings) console.log(`  ! ${w}`);

check(plan.stops.length > 0, "produces an itinerary at all", String(plan.stops.length));
check(plan.cities.length >= 2, "spans more than one town", plan.cities.join(" → "));
check(plan.dayCount >= 8, "fills something like the days asked for", String(plan.dayCount));
check(plan.currency === "CHF", "prices the plan in the destination's money", plan.currency);
check(plan.budgetCurrency === "INR", "remembers the budget is in rupees", plan.budgetCurrency);
check(
  plan.totalInBudget !== null,
  "can compare the total to the budget",
  String(plan.totalInBudget)
);
/**
 * The bug this guards is the one that looks like success. Before the FX pass,
 * a 1,900 CHF plan was compared against a 400,000 INR budget and reported as
 * comfortably inside it, when in rupees it is about 180,000 — the arithmetic
 * was fine and the units were nonsense.
 */
check(
  plan.totalInBudget === null || plan.totalInBudget > plan.total,
  "converts francs up into rupees rather than down",
  `${Math.round(plan.total)} CHF → ${Math.round(plan.totalInBudget ?? 0)} INR`
);
check(
  plan.stops.every((s) => /^\d{2}:\d{2}$/.test(s.localTime)),
  "every stop has a real clock time"
);
check(
  plan.stops.filter((s) => s.day === plan.dayCount).length >= 0 &&
    new Set(plan.stops.map((s) => s.day)).size >= 5,
  "spreads across the calendar rather than piling into one day",
  String(new Set(plan.stops.map((s) => s.day)).size)
);

console.log(
  `\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`} — ` +
    `${((Date.now() - t0) / 1000).toFixed(1)}s total`
);
process.exit(failures === 0 ? 0 : 1);
