/**
 * Accommodation preferences, end to end, without the model.
 *
 * npm run test:lodging
 *
 * PS-7 lists "accommodation preferences" among the things a traveler must be
 * able to define, and for a long time this repo collected no such field — so
 * this suite exists to prove the claim rather than assert it in a README.
 *
 * It composes the same north-India trip four times, once per bracket, and
 * checks three things:
 *
 *   1. the bed that gets booked is in the bracket that was asked for,
 *   2. the totals actually move — a preference that changes nothing is a
 *      preference nobody can see,
 *   3. a town with no room in that bracket books the nearest one it has and
 *      *says so*, instead of quietly downgrading the trip.
 *
 * No model calls, so it is free and repeatable. Chopta is the interesting case:
 * it is a meadow at 2,700m with tents and one forest rest house, and asking for
 * luxury there has to fail honestly.
 */
import fs from "node:fs";
for (const l of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const t = l.trim(); if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("="); if (i > 0) process.env[t.slice(0, i).trim()] ||= t.slice(i + 1).trim();
}

const { planItinerary } = await import("../src/lib/agent/compose.js");
const { createAdminClient } = await import("../src/lib/supabase/admin.js");
import type { TripSpec } from "../src/lib/agent/intake.js";
import type { LodgingTier } from "../src/lib/db/types.js";

let failures = 0;
const check = (ok: boolean, label: string, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} — ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const supabase = createAdminClient();

/** id -> tier/title/price, so a composed stop can be graded. */
const { data: beds } = await supabase
  .from("inventory")
  .select("id, title, tier, base_cost, city")
  .eq("type", "hotel");

const bedById = new Map(
  ((beds ?? []) as { id: string; title: string; tier: string | null; base_cost: number; city: string | null }[])
    .map((b) => [b.id, b])
);

const today = new Date().toISOString().slice(0, 10);
const plus = (n: number) =>
  new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

const base: TripSpec = {
  title: "North India by rail",
  partySize: 2,
  budget: null,
  currency: "INR",
  startsOn: plus(7),
  endsOn: plus(13),
  origin: null,
  destinations: ["Delhi", "Rishikesh", "Chopta"],
  mustDo: [],
  transport: "trains",
  interests: [],
  pace: "moderate",
  dietary: [],
  mobility: null,
  style: null,
  lodging: null,
  unclear: [],
};

console.log(`--- composing ${base.destinations.join(" -> ")}, ${today} ---\n`);

type Run = {
  tier: LodgingTier | null;
  total: number;
  beds: { city: string; title: string; tier: string | null }[];
  warnings: string[];
};

const runs: Run[] = [];

for (const tier of [null, "budget", "midrange", "luxury"] as (LodgingTier | null)[]) {
  const plan = await planItinerary({ ...base, lodging: tier });

  const booked = plan.stops
    .map((s) => bedById.get(s.inventoryId))
    .filter((b): b is NonNullable<typeof b> => Boolean(b))
    .map((b) => ({ city: b.city ?? "?", title: b.title, tier: b.tier }));

  runs.push({ tier, total: plan.total, beds: booked, warnings: plan.warnings });

  console.log(`${(tier ?? "no preference").padEnd(14)} ${String(Math.round(plan.total)).padStart(7)} INR`);
  for (const b of booked) console.log(`   ${b.city.padEnd(12)} ${b.tier ?? "—"} · ${b.title}`);
  console.log();
}

const byTier = (t: LodgingTier | null) => runs.find((r) => r.tier === t)!;

console.log("--- the bed matches the bracket ---");

for (const tier of ["budget", "midrange"] as LodgingTier[]) {
  const run = byTier(tier);
  check(
    run.beds.length > 0,
    `${tier}: the trip books somewhere to sleep`,
    `${run.beds.length} beds`
  );
  check(
    run.beds.every((b) => b.tier === tier),
    `${tier}: every bed booked is ${tier}`,
    run.beds.map((b) => `${b.city}=${b.tier}`).join(", ")
  );
}

console.log("\n--- a stated preference changes the bill ---");

const cheap = byTier("budget");
const dear = byTier("luxury");
check(
  dear.total > cheap.total,
  "luxury costs more than budget",
  `${Math.round(cheap.total)} -> ${Math.round(dear.total)} INR`
);
check(
  byTier("midrange").total > cheap.total &&
    byTier("midrange").total < dear.total,
  "mid-range lands between the two",
  String(Math.round(byTier("midrange").total))
);

console.log("\n--- no preference is the cheapest bed, not an arbitrary one ---");
const none = byTier(null);
check(
  none.beds.every((b) => b.tier === "budget"),
  "with nothing stated it books the cheapest room in town",
  none.beds.map((b) => b.tier).join(", ")
);

console.log("\n--- a town that cannot match says so ---");

// Chopta has budget and midrange only. Asking for luxury there must book the
// nearest thing and warn, not silently hand over a tent as though it were the
// suite that was asked for.
const chopta = dear.beds.find((b) => b.city === "Chopta");
if (!chopta) {
  check(false, "the luxury run reaches Chopta", "no Chopta bed in the plan");
} else {
  check(
    chopta.tier !== "luxury",
    "Chopta has no luxury room, so it books something else",
    String(chopta.tier)
  );
  check(
    chopta.tier === "midrange",
    "and it books the nearest bracket, not the cheapest thing available",
    String(chopta.tier)
  );
  check(
    dear.warnings.some((w) => /luxury/i.test(w) && /Chopta/.test(w)),
    "the traveler is told which town could not be matched",
    dear.warnings.find((w) => /Chopta/.test(w)) ?? "no warning mentions Chopta"
  );
}

// The inverse: a run that met every preference must not invent a complaint.
check(
  !cheap.warnings.some((w) => /asked for/i.test(w)),
  "a fully-matched trip raises no accommodation warning",
  cheap.warnings.filter((w) => /asked for/i.test(w)).join(" | ")
);

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
