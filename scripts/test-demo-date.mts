/**
 * A pinned demo date moves the seed and the application together.
 *
 * npm run test:demo-date
 *
 * `DEMO_DATE` exists so a video shot in two sittings a fortnight apart shows
 * the same dates in both segments. The failure it has to be proved against is
 * not "the seed used the wrong day" — that half is easy. It is the *half-pinned*
 * case: anchor the seed to a date the application still thinks is in the past
 * and you get a trip whose run sheet is empty and whose lifecycle rail says it
 * finished, which looks like the product is broken rather than like a
 * misconfiguration.
 *
 * So this seeds against a date well away from today and then asks the ordinary
 * read paths — the guide's 48-hour window, the operator's 72-hour board, the
 * traveler's stage — whether they agree about what day it is.
 */
import fs from "node:fs";
for (const l of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const t = l.trim(); if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("="); if (i > 0) process.env[t.slice(0, i).trim()] ||= t.slice(i + 1).trim();
}

// Far enough from today that nothing here can pass by coincidence.
const PINNED = "2026-11-17";
process.env.DEMO_DATE = PINNED;

const { execFileSync } = await import("node:child_process");

let failures = 0;
const check = (ok: boolean, label: string, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} — ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

console.log(`\n\x1b[1mSeeding against ${PINNED}\x1b[0m\n`);

// The seed runs in its own process, so it needs DEMO_DATE in that process's env
// rather than this one's.
execFileSync("node", ["scripts/sql.mjs", "supabase/seed.sql"], {
  env: { ...process.env, DEMO_DATE: PINNED },
  stdio: "ignore",
});
execFileSync("node", ["scripts/sql.mjs", "supabase/seed-india.sql"], {
  env: { ...process.env, DEMO_DATE: PINNED },
  stdio: "ignore",
});

const { now, localDay } = await import("../src/lib/format.js");
const { DEMO_TRIP_ID, getRunSheet, getSchedule, getTrip, getItems, getBookings } =
  await import("../src/lib/db/queries.js");
const { getOpenDisruptions } = await import("../src/lib/db/queries.js");
const { tripStage } = await import("../src/lib/trip/stage.js");

console.log("\x1b[1m1. The application moved with it\x1b[0m");

check(localDay(now(), "Asia/Kolkata") === PINNED,
  "the app believes today is the pinned day", localDay(now(), "Asia/Kolkata"));

const trip = (await getTrip(DEMO_TRIP_ID))!;
check(trip.starts_on === "2026-11-14",
  "the trip starts three days before it, as the seed intends", trip.starts_on ?? "null");

console.log("\n\x1b[1m2. The surfaces that ask 'what is happening now'\x1b[0m");

const sheet = await getRunSheet(DEMO_TRIP_ID, 2);
check(sheet.length > 0,
  "the guide's 48-hour run sheet is not empty — the half-pinned failure",
  `${sheet.length} stops`);

const raft = sheet.find((i) => i.title.toLowerCase().includes("rafting"));
check(Boolean(raft), "and tomorrow's rafting is on it", raft?.starts_at ?? "missing");

const schedule = await getSchedule(3);
check(schedule.length > 0,
  "the operator's 72-hour board is not empty either",
  `${schedule.length} movements`);

console.log("\n\x1b[1m3. The lifecycle agrees\x1b[0m");

const stage = tripStage({
  trip,
  items: await getItems(DEMO_TRIP_ID),
  bookings: await getBookings(DEMO_TRIP_ID),
  reviews: [],
  openDisruptions: (await getOpenDisruptions(DEMO_TRIP_ID)).length,
  today: localDay(now(), trip.time_zone ?? "Asia/Kolkata"),
});
check(stage.current === "operate",
  "the trip reads as under way, not finished", stage.current);

console.log("\n\x1b[1m4. Unset, nothing changes\x1b[0m");

delete process.env.DEMO_DATE;
const realToday = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
check(localDay(now(), "Asia/Kolkata") === realToday,
  "with no DEMO_DATE the clock is the real one", localDay(now(), "Asia/Kolkata"));

console.log("\n--- restoring today's seed ---");
execFileSync("npm", ["run", "db:seed"], { stdio: "ignore" });
check(true, "database re-seeded against today");

console.log(
  failures === 0
    ? "\n\x1b[32mAll checks passed.\x1b[0m A pinned date moves the seed and the app as one."
    : `\n\x1b[31m${failures} check(s) failed.\x1b[0m`
);
process.exit(failures === 0 ? 0 : 1);
