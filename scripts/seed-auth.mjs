#!/usr/bin/env node
/**
 * Give the seeded trip real owners.
 *
 * `seed.sql` cannot do this itself. `profiles` hangs off `auth.users`, and
 * `auth.users` rows are made by GoTrue — hand-writing them means hand-writing
 * a bcrypt hash into a schema Supabase reserves the right to change. So the
 * SQL seeds the trip with `traveler_id` null and this runs immediately after,
 * creating three people through the admin API and pointing the trip at them.
 *
 * Which matters more than it sounds: the traveler policy is
 * `traveler_id = auth.uid()`, and null matches nobody. Without this step,
 * moving the reads onto the RLS client makes the demo trip invisible to
 * everyone — and RLS failures surface as empty lists, not errors.
 *
 * Idempotent. Re-running finds the existing users and re-points the trip,
 * which is what `db:seed` needs since the SQL deletes and recreates it.
 *
 *   node scripts/seed-auth.mjs
 */
import pg from "pg";
import { loadEnv, connectionConfig, explain } from "./pg-config.mjs";

loadEnv();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) throw new Error("Supabase URL and service role key are required");

const OPERATOR_ID = "0d000000-0000-4000-a000-000000000001";
const TRIP_ID = "7a000000-0000-4000-a000-000000000001";

/**
 * One shared password across all three. These are demo identities in a demo
 * database with no real data behind them, and three passwords to mistype on
 * stage is three chances to lose ninety seconds.
 */
export const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? "voyage-demo-2026";

/** Emails match what the seed already wrote into the trip's contact fields and
 *  the operator's contact, so the two halves of the demo agree. */
const PEOPLE = [
  {
    key: "traveler",
    email: "ananya@example.com",
    fullName: "Ananya Sharma",
    role: "traveler",
    operatorId: null,
  },
  {
    key: "operator",
    email: "ops@costiera-dmc.example",
    fullName: "Costiera DMC Operations",
    role: "operator",
    operatorId: OPERATOR_ID,
  },
  {
    key: "coordinator",
    email: "marco@costiera-dmc.example",
    fullName: "Marco Ferrara",
    role: "coordinator",
    operatorId: OPERATOR_ID,
  },
  /**
   * A demo prop rather than a person: a real, confirmed account that owns
   * nothing. Signed in as her, the Sharma party's URL is a 404 — which is the
   * only way to *show* that RLS is doing the work rather than assert it. She
   * is deliberately never pointed at a trip, so re-seeding cannot accidentally
   * give her one.
   */
  {
    key: "stranger",
    email: "stranger@example.com",
    fullName: "Someone Else",
    role: "traveler",
    operatorId: null,
  },
];

async function admin(path, init = {}) {
  const res = await fetch(`${url}/auth/v1${path}`, {
    ...init,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`${path} → ${res.status} ${body.msg ?? body.message ?? ""}`);
  }
  return body;
}

/** Find by email, or create. The admin list endpoint has no exact-email
 *  filter worth trusting, so this pages and matches locally — three users is
 *  never going to be more than one page. */
async function findOrCreate({ email, fullName }) {
  const { users = [] } = await admin("/admin/users?per_page=200");
  const existing = users.find((u) => u.email?.toLowerCase() === email.toLowerCase());

  if (existing) {
    // Reset the password every run so a forgotten change on the dashboard
    // cannot make the documented demo credentials wrong.
    await admin(`/admin/users/${existing.id}`, {
      method: "PUT",
      body: JSON.stringify({
        password: DEMO_PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: fullName },
      }),
    });
    return { id: existing.id, created: false };
  }

  const created = await admin("/admin/users", {
    method: "POST",
    body: JSON.stringify({
      email,
      password: DEMO_PASSWORD,
      // Skips the confirmation email entirely, which matters because the
      // project has confirmations on and Supabase's built-in SMTP is rate
      // limited to a handful an hour.
      email_confirm: true,
      user_metadata: { full_name: fullName },
    }),
  });
  return { id: created.id, created: true };
}

const db = new pg.Client(connectionConfig());

try {
  await db.connect();
} catch (err) {
  // connect() throws outside the query try/catch below, so without this
  // the resolver's bare ENOTFOUND is the last thing you see.
  console.error(`\nseed-auth could not connect: ${explain(err)}`);
  process.exit(1);
}

try {
  const ids = {};

  for (const person of PEOPLE) {
    const { id, created } = await findOrCreate(person);
    ids[person.key] = id;

    // The `on_auth_user_created` trigger already made the profile row; this
    // sets the parts a signup cannot know — the role, and which operator's
    // staff they are.
    await db.query(
      `insert into profiles (id, role, full_name, email, operator_id)
       values ($1, $2, $3, $4, $5)
       on conflict (id) do update
         set role = excluded.role,
             full_name = excluded.full_name,
             email = excluded.email,
             operator_id = excluded.operator_id`,
      [id, person.role, person.fullName, person.email, person.operatorId]
    );

    console.log(
      `${created ? "created" : "updated"}  ${person.role.padEnd(11)} ${person.email}`
    );
  }

  // Point the trip at them. This is the line that decides whether RLS returns
  // the demo trip or an empty list.
  const { rowCount } = await db.query(
    `update trips set traveler_id = $1, coordinator_id = $2 where id = $3`,
    [ids.traveler, ids.coordinator, TRIP_ID]
  );

  if (rowCount === 0) {
    throw new Error(
      `trip ${TRIP_ID} not found — run \`npm run db:seed\` before this script`
    );
  }

  console.log(`\ntrip ${TRIP_ID} now belongs to ananya@example.com`);
  console.log(`stranger@example.com owns nothing, on purpose — the 404 prop`);
  console.log(`all four sign in with: ${DEMO_PASSWORD}`);
} catch (err) {
  console.error(`\nseed-auth failed: ${explain(err)}`);
  process.exitCode = 1;
} finally {
  await db.end();
}
