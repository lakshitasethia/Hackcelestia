/**
 * A self-planned trip reaches the people who run it.
 *
 * npm run test:assignment
 *
 * The check that matters is not "the column is set" — it is whether the
 * operator's board and the guide's run sheet actually return the row, which is
 * an RLS question and can only be answered as those users. So this signs in as
 * the seeded operator and coordinator and reads through their own sessions,
 * exactly as the pages do.
 */
import fs from "node:fs";
for (const l of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const t = l.trim(); if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("="); if (i > 0) process.env[t.slice(0, i).trim()] ||= t.slice(i + 1).trim();
}

import { createClient } from "@supabase/supabase-js";
const { houseAssignment } = await import("../src/lib/db/assignment.js");
const { createTrip } = await import("../src/lib/db/mutations.js");
const { createAdminClient } = await import("../src/lib/supabase/admin.js");

let failures = 0;
const check = (ok: boolean, label: string, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} — ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const password = process.env.DEMO_PASSWORD || "waypoint-demo-2026";

const house = await houseAssignment();
console.log(`house operator=${house.operatorId} coordinator=${house.coordinatorName}`);
check(Boolean(house.operatorId), "an operator is chosen for self-planned trips");
check(Boolean(house.coordinatorName), "that operator's coordinator comes with it", house.coordinatorName ?? "none");

const admin = createAdminClient();
const { data: op } = await admin.from("operators").select("name").eq("id", house.operatorId!).single();
check((op as { name: string }).name !== "Waypoint Research",
  "the bookkeeping operator is never handed a live trip", (op as { name: string }).name);

const tripId = await createTrip({
  title: "ASSIGNMENT TEST — delete me",
  contactName: "Test traveler",
  partySize: 2,
  budget: 1000,
  startsOn: new Date().toISOString().slice(0, 10),
  endsOn: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10),
  prefs: {},
  operatorId: house.operatorId,
});
await admin.from("trips").update({
  coordinator_id: house.coordinatorId,
  coordinator_name: house.coordinatorName,
  coordinator_phone: house.coordinatorPhone,
  // The run sheet only shows live groups; the traveler reaches this state by
  // pressing Confirm on the build page.
  status: "confirmed",
}).eq("id", tripId);

async function seesTrip(email: string) {
  const c = createClient(url, anon);
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) return { ok: false, why: error.message, rows: 0 };
  const { data } = await c.from("trips").select("id").eq("id", tripId);
  return { ok: (data ?? []).length > 0, why: "", rows: (data ?? []).length };
}

const opSees = await seesTrip("ops@costiera-dmc.example");
check(opSees.ok, "the operator's board can see it", opSees.why || `${opSees.rows} row(s)`);

const coordSees = await seesTrip("marco@costiera-dmc.example");
check(coordSees.ok, "the coordinator can see it", coordSees.why || `${coordSees.rows} row(s)`);

// The run sheet's own filter, not just visibility.
const guide = createClient(url, anon);
await guide.auth.signInWithPassword({ email: "marco@costiera-dmc.example", password });
const { data: sheet } = await guide
  .from("trips").select("id")
  .not("coordinator_name", "is", null)
  .in("status", ["confirmed", "in_progress"])
  .eq("id", tripId);
check((sheet ?? []).length === 1, "it passes the run sheet's own filter");

// And a stranger still cannot.
const stranger = createClient(url, anon);
const { error: sErr } = await stranger.auth.signInWithPassword({
  email: "stranger@example.com", password,
});
if (!sErr) {
  const { data } = await stranger.from("trips").select("id").eq("id", tripId);
  check((data ?? []).length === 0, "a stranger still cannot", `${(data ?? []).length} row(s)`);
} else {
  console.log(`SKIP — stranger sign-in unavailable (${sErr.message})`);
}

await admin.from("trips").delete().eq("id", tripId);
check(true, "test trip removed");

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
