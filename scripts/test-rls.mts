/**
 * Does row-level security actually keep people apart?
 *
 *   npm run test:rls
 *
 * Every other suite reads as the service role, which bypasses RLS entirely —
 * so none of them can answer this. This one signs in as real users with the
 * anon key and asks the database directly, which is the only way to find out
 * whether the policies do what they say. It deliberately does not import
 * `queries.ts`: those helpers need a request's cookies, and the point here is
 * the boundary underneath them.
 *
 * The stranger is created and deleted by this script, so a pass means a person
 * who exists but owns nothing genuinely sees nothing.
 */
import fs from "node:fs";
for (const l of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const t = l.trim();
  if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("=");
  if (i > 0) process.env[t.slice(0, i).trim()] ||= t.slice(i + 1).trim();
}

const { createClient } = await import("@supabase/supabase-js");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const password = process.env.DEMO_PASSWORD?.trim() || "voyage-demo-2026";

const TRIP = "7a000000-0000-4000-a000-000000000001";

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failures++;
};

/** A client carrying one person's session, exactly as a browser would. */
async function signIn(email: string) {
  const c = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`${email}: ${error.message}`);
  return c;
}

const admin = createClient(url, service, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// -- a stranger: signed in, owns nothing ------------------------------------

const strangerEmail = `stranger.${Date.now()}@example.com`;
const { data: created, error: createErr } = await admin.auth.admin.createUser({
  email: strangerEmail,
  password,
  email_confirm: true,
  user_metadata: { full_name: "A Stranger" },
});
if (createErr) throw new Error(`could not create the stranger: ${createErr.message}`);
const strangerId = created.user!.id;

try {
  const traveler = await signIn("ananya@example.com");
  const operator = await signIn("ops@costiera-dmc.example");
  const coordinator = await signIn("marco@costiera-dmc.example");
  const stranger = await signIn(strangerEmail);
  const anonymous = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const tripsVisibleTo = async (c: ReturnType<typeof createClient>) => {
    const { data } = await c.from("trips").select("id");
    return (data ?? []).map((r: { id: string }) => r.id);
  };

  // -- the three lenses can each see the trip -------------------------------

  check("the traveler sees their trip", (await tripsVisibleTo(traveler)).includes(TRIP));
  check("the operator sees the trip they run", (await tripsVisibleTo(operator)).includes(TRIP));
  check("the coordinator sees the group they are running",
    (await tripsVisibleTo(coordinator)).includes(TRIP));

  // -- and nobody else does -------------------------------------------------

  const strangerTrips = await tripsVisibleTo(stranger);
  check("a signed-in stranger sees no trips at all", strangerTrips.length === 0,
    `${strangerTrips.length} visible`);
  check("an anonymous visitor sees no trips",
    (await tripsVisibleTo(anonymous)).length === 0);

  // The subtle one. `items_via_trip` carries no auth check of its own — it is
  // `exists (select 1 from trips t where t.id = trip_id)`, and works only
  // because Postgres applies trips' own RLS to that subquery. If that
  // assumption is wrong, every itinerary in the database is world-readable to
  // anyone with an account, and nothing above would have caught it.
  const { data: strangerItems } = await stranger
    .from("itinerary_items").select("id").eq("trip_id", TRIP);
  check("itinerary items inherit their trip's visibility",
    (strangerItems ?? []).length === 0, `${(strangerItems ?? []).length} leaked`);

  const { data: travelerItems } = await traveler
    .from("itinerary_items").select("id").eq("trip_id", TRIP);
  check("...without hiding them from the traveler",
    (travelerItems ?? []).length > 0, `${(travelerItems ?? []).length} stops`);

  /**
   * `payments` and `reviews` are here for the reason the whole file exists.
   *
   * Both inherit visibility through `exists (select 1 from trips ...)`, a
   * subquery that carries no auth check of its own and is safe only because
   * Postgres applies `trips`' own RLS inside it. If that assumption were ever
   * wrong, every group's money and every rating would be readable by anyone
   * with an account — and reading the policy would not tell you, because the
   * policy looks identical either way.
   */
  for (const table of [
    "bookings",
    "disruptions",
    "agent_runs",
    "replan_proposals",
    "payments",
    "reviews",
  ]) {
    const { data } = await stranger.from(table).select("id").limit(5);
    check(`a stranger reads no ${table}`, (data ?? []).length === 0);
  }

  // A negative that only means something if the positive is also true: an
  // empty table would pass the loop above for the wrong reason.
  await admin.from("payments").insert({
    trip_id: TRIP,
    kind: "deposit",
    amount: 250,
    currency: "EUR",
  });
  await admin.from("reviews").insert({
    trip_id: TRIP,
    rating: 4,
    comment: "RLS probe",
  });

  const { data: strangerMoney } = await stranger
    .from("payments").select("id").eq("trip_id", TRIP);
  check("a stranger still reads no payments once there are some to read",
    (strangerMoney ?? []).length === 0);

  const { data: travelerMoney } = await traveler
    .from("payments").select("id").eq("trip_id", TRIP);
  check("...but the traveler reads their own",
    (travelerMoney ?? []).length > 0, `${(travelerMoney ?? []).length} row(s)`);

  const { data: strangerReviews } = await stranger
    .from("reviews").select("id").eq("trip_id", TRIP);
  check("a stranger reads no reviews once there are some to read",
    (strangerReviews ?? []).length === 0);

  const { data: operatorReviews } = await operator
    .from("reviews").select("id").eq("trip_id", TRIP);
  check("...but the operator running the trip reads them",
    (operatorReviews ?? []).length > 0, `${(operatorReviews ?? []).length} row(s)`);

  await admin.from("payments").delete().eq("trip_id", TRIP).eq("amount", 250);
  await admin.from("reviews").delete().eq("trip_id", TRIP).eq("comment", "RLS probe");

  // -- writes ---------------------------------------------------------------

  const { error: writeErr } = await stranger
    .from("trips").update({ title: "hijacked" }).eq("id", TRIP).select("id");
  const { data: afterWrite } = await admin
    .from("trips").select("title").eq("id", TRIP).single();
  check("a stranger cannot rename someone else's trip",
    (afterWrite as { title: string }).title !== "hijacked",
    writeErr ? writeErr.message : "silently matched no rows");

  // -- the catalogue is shared on purpose -----------------------------------

  const { data: inv } = await stranger.from("inventory").select("id").limit(3);
  check("the catalogue stays readable to any signed-in user",
    (inv ?? []).length > 0, `${(inv ?? []).length} rows`);
  const { data: anonInv } = await anonymous.from("inventory").select("id").limit(3);
  check("but not to anonymous visitors", (anonInv ?? []).length === 0);

  // -- profiles -------------------------------------------------------------

  const { data: profiles } = await stranger.from("profiles").select("id");
  check("a traveler sees only their own profile row",
    (profiles ?? []).length === 1 &&
      (profiles as { id: string }[])[0].id === strangerId,
    `${(profiles ?? []).length} rows`);
} finally {
  await admin.auth.admin.deleteUser(strangerId);
}

console.log(
  failures === 0
    ? "\nRLS holds: every lens sees its own trip, and nobody sees anyone else's."
    : `\n${failures} check(s) FAILED.`
);
process.exitCode = failures === 0 ? 0 : 1;
