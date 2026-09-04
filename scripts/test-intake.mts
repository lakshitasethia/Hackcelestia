/** Prose in, a trip spec out. npx tsx --conditions=react-server scripts/test-intake.mts */
import fs from "node:fs";
for (const l of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const t = l.trim(); if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("="); if (i > 0) process.env[t.slice(0, i).trim()] ||= t.slice(i + 1).trim();
}
const { extractTripSpec } = await import("../src/lib/agent/intake.js");
const { getInterestTags } = await import("../src/lib/db/queries.js");

let failures = 0;
const check = (ok: boolean, label: string, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} — ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const tags = await getInterestTags();

const spec = await extractTripSpec(
  "It's our anniversary — four of us, arriving 12 September 2026 and leaving on the 16th. " +
  "Budget is about 6k. We're big on food and want to be out on the water, but my mother is " +
  "coming and can't manage steep steps. No meat for two of us. Nothing rushed."
);
console.log(JSON.stringify(spec, null, 2));

check(spec.partySize === 4, "counts the party", String(spec.partySize));
check(spec.budget === 6000, "reads '6k' as 6000", String(spec.budget));
check(spec.startsOn === "2026-09-12", "reads the arrival date", String(spec.startsOn));
check(spec.endsOn === "2026-09-16", "reads 'the 16th' against the same month", String(spec.endsOn));
check(spec.pace === "relaxed", "reads 'nothing rushed' as a pace", String(spec.pace));
check(spec.interests.length > 0, "picks up interests", spec.interests.join(", "));
check(
  spec.interests.every((tag) => tags.includes(tag)),
  "every interest is a tag the catalogue actually uses",
  spec.interests.join(", ")
);
check(Boolean(spec.mobility), "records the access need", spec.mobility ?? "");
check(spec.dietary.length > 0, "records the dietary need", spec.dietary.join(", "));

// The failure that matters more than any of the above: a confident wrong
// number. Nothing here names a budget or a size, so both must come back null.
const vague = await extractTripSpec("A few days somewhere warm next spring, nothing fancy.");
console.log(JSON.stringify(vague, null, 2));
check(vague.budget === null, "invents no budget", String(vague.budget));
check(vague.partySize === null, "invents no party size", String(vague.partySize));
check(vague.startsOn === null, "'next spring' is not a date", String(vague.startsOn));
check(vague.unclear.length > 0, "says what it could not pin down", vague.unclear.join("; "));

console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) failed.`}`);
process.exit(failures === 0 ? 0 : 1);
