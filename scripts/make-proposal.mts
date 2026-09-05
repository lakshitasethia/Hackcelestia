/**
 * A proposal to look at, without spending a research pass.
 *
 * npx tsx --conditions=react-server scripts/make-proposal.mts
 *
 * Composes the shared Switzerland fixture and stores it as a `trip_proposals`
 * row for the first profile in the database, then prints the URL. For eyeballing
 * `/plan/proposal/[id]` — the confirmation screen — when the live research is
 * rate-limited or you simply do not want to pay for it to check a margin.
 */
import fs from "node:fs";
for (const l of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const t = l.trim(); if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("="); if (i > 0) process.env[t.slice(0, i).trim()] ||= t.slice(i + 1).trim();
}

const { createAdminClient } = await import("../src/lib/supabase/admin.js");
const { planItinerary } = await import("../src/lib/agent/compose.js");
const { ingestResearch } = await import("../src/lib/agent/catalogue.js");
import { spec, research } from "./fixture-swiss.mjs";

await ingestResearch(research);

const plan = await planItinerary(spec, {
  cityHint: research.cities,
  timeZone: research.timeZone,
  currency: research.currency,
  fxToBudget: research.fxToBudget,
});

const supabase = createAdminClient();
const { data: profile } = await supabase
  .from("profiles").select("id, email").limit(1).single();

const { data, error } = await supabase
  .from("trip_proposals")
  .insert({
    traveler_id: (profile as { id: string }).id,
    description:
      "A trip from India to Switzerland for around 12 to 13 days, arriving " +
      "2 October 2026 and flying home on the 14th. Two of us, budget about " +
      "4 lakh rupees. Keep the stays budget-friendly. A chocolate factory is " +
      "compulsory, and we want the mountains and the scenic trains.",
    spec: spec as never,
    research: research as never,
    plan: plan as never,
  } as never)
  .select("id")
  .single();

if (error) throw new Error(error.message);

console.log(`/plan/proposal/${(data as { id: string }).id}`);
console.log(`(owned by ${(profile as { email: string | null }).email})`);
