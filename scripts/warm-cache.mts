/**
 * Research a trip once, so every later run of it is free.
 *
 *   npx tsx --conditions=react-server scripts/warm-cache.mts "<the prompt>"
 *   npx tsx --conditions=react-server scripts/warm-cache.mts --fixture "<the prompt>"
 *
 * A research pass costs roughly 40,000 Groq tokens and the free tier allows
 * 200,000 a day per organization — five runs. Rehearsing anything, or being
 * two people, exhausts that fast.
 *
 * So: do the expensive part once, deliberately, when the budget is there. The
 * cache is keyed on what the prompt *means* rather than its wording, so the
 * warmed entry is hit by any phrasing of the same trip.
 *
 * `--fixture` stores the hand-written Switzerland result under the real
 * prompt's fingerprint instead of searching. That exercises every screen with
 * no research tokens at all, which is what you want when the plumbing is what
 * you are testing. It is fixture data, so do not record a video off it.
 */
import fs from "node:fs";
for (const l of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const t = l.trim(); if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("="); if (i > 0) process.env[t.slice(0, i).trim()] ||= t.slice(i + 1).trim();
}

const argv = process.argv.slice(2);
const useFixture = argv.includes("--fixture");
const prompt = argv.filter((a) => a !== "--fixture").join(" ").trim();

if (!prompt) {
  console.error('Give it the prompt, quoted:\n  scripts/warm-cache.mts "A trip from India to Switzerland..."');
  process.exit(1);
}

const { extractTripSpec } = await import("../src/lib/agent/intake.js");
const { researchTrip, fingerprint, writeCache } = await import("../src/lib/agent/research.js");
const { ingestResearch } = await import("../src/lib/agent/catalogue.js");

// Intake runs on the 20b, which has its own allowance — so working out what
// the prompt means costs nothing from the pool this script exists to protect.
console.log("Reading the prompt…");
const spec = await extractTripSpec(prompt);
console.log(`  ${spec.destinations.join(", ")} · ${spec.startsOn} → ${spec.endsOn} · ${spec.currency}`);

const key = fingerprint(spec);
console.log(`  fingerprint ${key.slice(0, 16)}…`);

let result;
if (useFixture) {
  const { research } = await import("./fixture-swiss.mjs");
  console.log("Storing the Switzerland FIXTURE (no web search, not real research).");
  result = research;
} else {
  console.log("Researching for real — this spends tokens and takes a minute…");
  result = await researchTrip(spec, null, { fresh: true });
  console.log(`  ${result.cities.join(" → ")} · ${result.places.length} places · ${result.sources.length} sources`);
}

await ingestResearch(result);
await writeCache(key, spec, result);

console.log(
  `\nWarm. Any phrasing of this trip now costs zero research tokens for ${14} days.` +
  (useFixture ? "\nFIXTURE DATA — fine for testing screens, not for the video." : "")
);
