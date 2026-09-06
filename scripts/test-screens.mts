/**
 * The screens render, and the button you are meant to press is on them.
 *
 * npm run test:screens        (needs `npm run dev` in another terminal)
 *
 * This is the suite the project did not have, and its absence is why every bug
 * in the last stretch — stale verified prices, duplicate landmarks, a budget in
 * the wrong currency, a missing link to the confirm step — was found by
 * clicking rather than by a test. All four would have passed everything else in
 * `npm run test:all`, because the logic under them was right and the screen was
 * not.
 *
 * It drives real HTTP against the dev server as a signed-in traveler, so it
 * exercises the middleware, RLS, the server components and the rendering — the
 * whole stack a judge will actually touch. What it deliberately does not do is
 * script a browser: the failure mode worth guarding is "the primary action
 * vanished from the page", and that is visible in the HTML.
 *
 * The cookies are produced by @supabase/ssr itself rather than hand-rolled, so
 * this cannot drift from the format the middleware reads.
 */
import fs from "node:fs";
for (const l of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const t = l.trim(); if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("="); if (i > 0) process.env[t.slice(0, i).trim()] ||= t.slice(i + 1).trim();
}

import { createServerClient } from "@supabase/ssr";

const BASE = process.env.SCREENS_BASE_URL ?? "http://localhost:3000";
const PASSWORD = process.env.DEMO_PASSWORD ?? "waypoint-demo-2026";
const TRIP = "7a000000-0000-4000-a000-000000000001";

let failures = 0;
const check = (ok: boolean, label: string, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} — ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

// ------------------------------------------------------------ signing in --

/** An in-memory cookie jar shaped like the one @supabase/ssr expects. */
function jar() {
  const store = new Map<string, string>();
  return {
    store,
    getAll: () => [...store].map(([name, value]) => ({ name, value })),
    setAll: (list: { name: string; value: string }[]) =>
      list.forEach(({ name, value }) => store.set(name, value)),
    header: () => [...store].map(([n, v]) => `${n}=${v}`).join("; "),
  };
}

async function signIn(email: string) {
  const cookies = jar();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: cookies.getAll, setAll: cookies.setAll } }
  );
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  if (error) throw new Error(`could not sign in as ${email}: ${error.message}`);
  return cookies;
}

async function page(cookies: ReturnType<typeof jar>, path: string) {
  const response = await fetch(`${BASE}${path}`, {
    headers: { cookie: cookies.header() },
    redirect: "manual",
  });
  const html = response.status < 400 ? await response.text() : "";
  return { status: response.status, html };
}

/** Case- and entity-insensitive: Next escapes apostrophes as &#x27;. */
const has = (html: string, needle: string) =>
  html
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .toLowerCase()
    .includes(needle.toLowerCase());

// --------------------------------------------------------------- the run --

const reachable = await fetch(BASE, { redirect: "manual" })
  .then((r) => r.status < 500)
  .catch(() => false);

if (!reachable) {
  console.log(
    `\n\x1b[31mNo dev server at ${BASE}.\x1b[0m Start one with \`npm run dev\` ` +
      `and run this again. This suite is deliberately end-to-end; there is no ` +
      `point stubbing the thing it exists to check.\n`
  );
  process.exit(1);
}

console.log("\n\x1b[1m1. The door is locked\x1b[0m");

const anon = jar();
for (const path of ["/plan", "/ops", `/trip/${TRIP}`, "/field"]) {
  const { status } = await page(anon, path);
  check(status === 307 || status === 302,
    `${path} redirects a stranger to the login`, `${status}`);
}
const landing = await page(anon, "/");
check(landing.status === 200, "the pitch stays open to everyone — a judge should reach it without an account");

/**
 * The rename from Voyage left a "V" monogram sitting next to the word WAYPOINT
 * on the login screen — the first thing a judge, or anyone following a shared
 * link, ever sees. Cheap to check, embarrassing to miss twice.
 */
const login = await page(anon, "/login");
check(!/>\s*V\s*</.test(login.html),
  "the login page carries no leftover V monogram from the rename");
check(!has(login.html, "voyage"),
  "and nothing anywhere still calls the product Voyage");

console.log("\n\x1b[1m2. Discover\x1b[0m");

const explore = await page(anon, "/explore");
check(explore.status === 200, "the catalogue renders before a trip exists");
check(has(explore.html, "explore") || has(explore.html, "discover"),
  "and says what it is");

console.log("\n\x1b[1m3. The traveler's own trip\x1b[0m");

const ananya = await signIn("ananya@example.com");
const trip = await page(ananya, `/trip/${TRIP}`);
check(trip.status === 200, "the traveler reaches her itinerary", `${trip.status}`);

// The lifecycle rail is the slide that answers "did you read the brief", so it
// is the one thing on this page that must never quietly stop rendering.
const stages = ["Discover", "Personalize", "Plan", "Price", "Book", "Prepare",
  "Operate", "Assist", "Adapt", "Complete", "Review"];
const missing = stages.filter((s) => !has(trip.html, s));
check(missing.length === 0,
  "all eleven PS-7 stages are on the rail",
  missing.length ? `missing: ${missing.join(", ")}` : "11/11");

check(has(trip.html, "needs") || has(trip.html, "depends"),
  "the dependency edge is visible on the page, not just in the database");

/**
 * `stage.ts` exists so that every surface agrees on the single next thing to
 * do, and renders it as a button. A trip that shows the rail but no action is
 * the exact regression the rail was built to prevent, and nothing else catches
 * it — the unit tests prove the function returns an action, not that anybody
 * rendered one.
 */
const actions = ["Add stops", "Review and confirm", "Export your itinerary",
  "Ask the concierge", "See what is affected", "Close it out",
  "Leave a review", "See your review"];
const shown = actions.filter((a) => has(trip.html, a));
check(shown.length > 0,
  "the rail carries a next action, not just a highlighted stage",
  shown.join(", ") || "no action rendered");

check(has(trip.html, "\u20ac") || has(trip.html, "eur"),
  "costs are shown in the trip's own currency");

/**
 * The intro loader is a full-screen opaque overlay, and it belongs to the
 * marketing page alone. It used to be server-rendered onto *every* route and
 * removed only once a client effect ran, so anything that delayed hydration —
 * a cold compile, a slow device, a backgrounded tab — left a black rectangle
 * over a live itinerary. Deciding it from the route means the HTML of an app
 * page cannot contain it, and this is the check that keeps it that way.
 */
check(!has(trip.html, "CHARTING YOUR COURSE"),
  "the brand loader is not server-rendered over the itinerary");

const pitch = await page(anon, "/");
check(has(pitch.html, "CHARTING YOUR COURSE"),
  "but the landing page still opens with it");
check(has(pitch.html, "loader-failsafe"),
  "and it carries the CSS failsafe, so a stalled main thread cannot strand it");

console.log("\n\x1b[1m4. Every surface in the lifecycle answers\x1b[0m");

const traveler: [string, string][] = [
  [`/trip/${TRIP}/build`, "Book — the confirm gate"],
  [`/trip/${TRIP}/print`, "Prepare — the export"],
  [`/trip/${TRIP}/review`, "Complete and Review"],
];
for (const [path, label] of traveler) {
  const { status, html } = await page(ananya, path);
  check(status === 200 && html.length > 500, label, `${status}`);
}

// Compare needs a real item id, so find one the way the page does.
const { createAdminClient } = await import("../src/lib/supabase/admin.js");
const admin = createAdminClient();
const { data: items } = await admin
  .from("itinerary_items")
  .select("id,title")
  .eq("trip_id", TRIP)
  .eq("status", "confirmed")
  .limit(1);
const item = items?.[0] as { id: string; title: string } | undefined;

if (item) {
  const compare = await page(ananya, `/trip/${TRIP}/compare/${item.id}`);
  check(compare.status === 200, `Compare alternatives for "${item.title}"`, `${compare.status}`);
  check(has(compare.html, "switch") || has(compare.html, "instead") || has(compare.html, "alternative"),
    "and it offers a switch rather than only listing options");
} else {
  check(false, "a confirmed stop exists to compare", "none found — re-seed");
}

const ops = await signIn("ops@costiera-dmc.example");

/**
 * The traveler and the operator must agree about one trip.
 *
 * The board reported the sum of *budgets* as "booked value" and as what was
 * outstanding, while the traveler's page summed the actual itinerary — so the
 * demo trip read EUR 4,500 on one screen and EUR 2,770 on the other, in a
 * product whose entire pitch is that three people see the same trip. Both now
 * come from the same rows; this is what keeps them there.
 */
const money = /ITINERARY TOTAL[\s\S]{0,200}?(\u20ac[\d,]+)/i.exec(
  trip.html.replace(/<[^>]+>/g, " ").replace(/&#x20AC;|&euro;/gi, "\u20ac")
);
const opsBoard = await page(ops, "/ops");
const opsMoney = /BOOKED VALUE[\s\S]{0,200}?(\u20ac[\d,]+)/i.exec(
  opsBoard.html.replace(/<[^>]+>/g, " ").replace(/&#x20AC;|&euro;/gi, "\u20ac")
);

check(Boolean(money && opsMoney),
  "both surfaces state a figure for the trip",
  `traveler ${money?.[1] ?? "?"} / operator ${opsMoney?.[1] ?? "?"}`);
check(Boolean(money && opsMoney && money[1] === opsMoney[1]),
  "the operator's booked value equals the traveler's itinerary total",
  `${money?.[1]} vs ${opsMoney?.[1]}`);

const stranger = await signIn("stranger@example.com");

console.log("\n\x1b[1mGate 1 — the plan, before it is a trip\x1b[0m");

/**
 * `/plan/proposal/[id]` is the first of the two gates the product turns on, and
 * it is the one screen in the lifecycle with no seeded row behind it — a
 * proposal only exists between composing and accepting. So this makes one from
 * the Switzerland fixture (no network, no model), renders it as its owner, and
 * removes it again. Without this the gate is reachable only by paying for a
 * live research pass, which is why it had never been checked.
 */
const { ingestResearch } = await import("../src/lib/agent/catalogue.js");
const { planItinerary } = await import("../src/lib/agent/compose.js");
const { spec, research } = await import("./fixture-swiss.mjs");

const { data: traveller } = await admin
  .from("profiles").select("id").eq("email", "ananya@example.com").single();

let proposalId: string | null = null;
try {
  await ingestResearch(research);
  const plan = await planItinerary(spec, {
    cityHint: research.cities,
    timeZone: research.timeZone,
    currency: research.currency,
    fxToBudget: research.fxToBudget,
  });
  const { data: row } = await admin
    .from("trip_proposals")
    .insert({
      traveler_id: (traveller as { id: string }).id,
      description: "Screens suite — India to Switzerland, 13 days.",
      spec: spec as never,
      research: research as never,
      plan: plan as never,
    } as never)
    .select("id")
    .single();
  proposalId = (row as { id: string } | null)?.id ?? null;
} catch (error) {
  check(false, "a proposal could be composed from the fixture",
    String((error as Error).message).slice(0, 120));
}

if (proposalId) {
  const proposal = await page(ananya, `/plan/proposal/${proposalId}`);
  check(proposal.status === 200, "the proposal gate renders", `${proposal.status}`);
  // The exact label, not a synonym: this is the button the whole first gate
  // exists for, and "a button is present" is not the assertion worth making.
  check(has(proposal.html, "Yes, build this trip"),
    "and offers the one button that turns a plan into a trip");
  check(has(proposal.html, "CHF") || has(proposal.html, "\u20b9") || has(proposal.html, "estimate"),
    "with prices attached, and it says which are estimates");

  // A stranger must not be able to read somebody else's draft trip either.
  const peeked = await page(stranger, `/plan/proposal/${proposalId}`);
  check(peeked.status === 404 || peeked.status === 307,
    "a proposal is as private as the trip it would become", `${peeked.status}`);

  await admin.from("trip_proposals").delete().eq("id", proposalId);
}

console.log("\n\x1b[1m5. Nobody sees anyone else's trip\x1b[0m");

const trespass = await page(stranger, `/trip/${TRIP}`);
check(trespass.status === 404,
  "a signed-in stranger gets a 404 on the traveler's URL", `${trespass.status}`);

console.log("\n\x1b[1m6. The operator and the guide\x1b[0m");

for (const [path, label] of [
  ["/ops", "the operator's board"],
  ["/ops/customers", "every customer, across trips"],
  ["/ops/reviews", "what came back, worst first"],
] as [string, string][]) {
  const { status, html } = await page(ops, path);
  check(status === 200 && html.length > 500, label, `${status}`);
}

const marco = await signIn("marco@costiera-dmc.example");

/**
 * `/field` redirects when a guide runs exactly one group — a coordinator should
 * not have to pick their trip out of a list of one. So the check that matters
 * is where it lands, not that it answered 200: a 307 here is correct and a 307
 * to the login is the failure.
 */
const fieldEntry = await page(marco, "/field");
const landed = fieldEntry.status === 200
  ? "/field"
  : (await fetch(`${BASE}/field`, { headers: { cookie: marco.header() }, redirect: "manual" }))
      .headers.get("location") ?? "";
check(!landed.includes("/login"),
  "the guide is not bounced to the login", landed || "/field");
check(fieldEntry.status === 200 || landed.startsWith("/field/"),
  "one assignment goes straight to that group's run sheet", landed || "rendered the list");

const sheet = await fetch(`${BASE}${landed.startsWith("/field/") ? landed : "/field"}`, {
  headers: { cookie: marco.header() },
});
const sheetHtml = await sheet.text();
check(sheet.status === 200, "the run sheet renders", `${sheet.status}`);
check(has(sheetHtml, "day") || has(sheetHtml, "nothing"),
  "and it is grouped into days, or says plainly that there is nothing in the next 48 hours");

console.log(
  failures === 0
    ? "\n\x1b[32mAll checks passed.\x1b[0m Every screen in the lifecycle renders, for the right person."
    : `\n\x1b[31m${failures} FAILED\x1b[0m`
);
process.exit(failures === 0 ? 0 : 1);
