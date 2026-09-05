/**
 * The research cache actually prevents research.
 *
 * npm run test:cache
 *
 * The thing worth testing is not that a row is written — it is that a hit
 * costs no Groq tokens, and that two differently-worded requests for the same
 * trip land on the same entry. So this calls the real `researchTrip` with no
 * network reachable for the search model, and passes only if it never needs it.
 */
import fs from "node:fs";
for (const l of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const t = l.trim(); if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("="); if (i > 0) process.env[t.slice(0, i).trim()] ||= t.slice(i + 1).trim();
}

const { fingerprint, writeCache, researchTrip } = await import("../src/lib/agent/research.js");
const { createAdminClient } = await import("../src/lib/supabase/admin.js");
import { spec, research } from "./fixture-swiss.mjs";
import type { TripSpec } from "../src/lib/agent/intake.js";

let failures = 0;
const check = (ok: boolean, label: string, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} — ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const key = fingerprint(spec);

// Same trip, different words and a different start date in the same month.
const reworded: TripSpec = {
  ...spec,
  title: "Alps and chocolate",
  startsOn: "2026-10-03",
  endsOn: "2026-10-15",
  destinations: ["switzerland"],
};
check(fingerprint(reworded) === key,
  "the same trip fingerprints the same however it is worded");

// Things that genuinely change the research must miss.
check(fingerprint({ ...spec, destinations: ["Japan"] }) !== key,
  "a different country is different research");
check(fingerprint({ ...spec, endsOn: "2026-10-25" }) !== key,
  "a much longer trip is different research");
check(fingerprint({ ...spec, currency: "USD" }) !== key,
  "a different budget currency is different research");
check(fingerprint({ ...spec, mustDo: ["skiing"] }) !== key,
  "a different must-do is different research");

await writeCache(key, spec, research);

/**
 * The real assertion. `GROQ_API_KEY` is emptied, so any attempt to search
 * throws immediately — if `researchTrip` returns a result at all, it never
 * reached the network.
 */
const realKey = process.env.GROQ_API_KEY;
process.env.GROQ_API_KEY = "";

const hit = await researchTrip(spec);
check(hit.cities.join() === research.cities.join(),
  "a cache hit returns the same research", hit.cities.join(" → "));
check(hit.places.length === research.places.length,
  "with all of its places", String(hit.places.length));

const rewordedHit = await researchTrip(reworded);
check(rewordedHit.cities.length > 0,
  "a differently-worded ask for the same trip hits too");

let refused = false;
try {
  await researchTrip({ ...spec, destinations: ["Patagonia"] } as TripSpec);
} catch {
  refused = true;
}
check(refused, "a genuinely new destination still tries to research");

process.env.GROQ_API_KEY = realKey;

const supabase = createAdminClient();
const { data } = await supabase
  .from("research_cache").select("hits").eq("fingerprint", key).single();
check((data as { hits: number }).hits >= 2, "hits are counted",
  String((data as { hits: number }).hits));

await supabase.from("research_cache").delete().eq("fingerprint", key);

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
