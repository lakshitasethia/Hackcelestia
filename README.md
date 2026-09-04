# Voyage

**Personalized dynamic tour planning and tour operations.** HackCelestia PS-7.

A tour operator's week does not fall apart at the planning stage. It falls apart
at 07:40 on the second morning, when the skipper calls to say the swell is too
high, and four other bookings quietly depend on that boat. Voyage is built
around that moment: an itinerary modelled as a dependency graph, a deterministic
engine that computes exactly what a break costs, and an agent that proposes ways
out for a human to accept.

Three people see the same trip: the **traveler** who booked it, the **operator**
who runs it, and the **coordinator** standing on the quay. When one of them
changes something, the other two see it without refreshing.

---

## The one decision everything rests on

An itinerary is a **DAG, not a list**. Every stop declares what it cannot happen
without:

```
hotel ──> transfer ──> boat ──┬──> lunch on Capri
                              └──> return transfer ──> dinner
```

`itinerary_items.depends_on uuid[]` is that edge. It means "identify impact" —
the thing PS-7 actually asks for — is a graph traversal rather than a pile of
hand-written special cases:

```sql
select * from blast_radius('…the boat…');   -- 4 items, max depth 2
```

Kill the boat and lunch, the return transfer and dinner go with it. The hotel
does not, because nothing downstream flows backwards. Blast radius, timing
conflicts and cost deltas all fall out of the same walk, and the traversal lives
in Postgres so the UI and the agent cannot disagree about it.

---

## What is actually built

| Surface | Route | Who it is for |
|---|---|---|
| Landing site | `/` | The pitch |
| Sign in | `/login` | Everyone — email and password, or Google |
| Planner | `/plan`, `/trip/[id]/build` | Traveler — dates, budget, interests, then build from real inventory |
| Itinerary | `/trip/[id]` | Traveler — the plan, live costs, what is at risk |
| Operations | `/ops` | Operator — groups, vendors, 72-hour schedule, open disruptions |
| Impact assessment | `/ops/disruption/[id]` | Operator — blast radius, candidates, the agent, the accept flow |
| Field run sheet | `/field/[id]` | Coordinator — today and tomorrow, report or escalate, on a phone |

Two of those surfaces carry a chat agent: **Vela**, the traveler's concierge, on
`/trip/[id]`, and a read-only **copilot** on `/ops`. `/plan` has a third, smaller
one — describe the trip in a sentence and the form fills itself in.

### The disruption path, end to end

1. A disruption is injected — a seeded scenario from the operator's demo
   controls, or a coordinator flagging a stop from the field.
2. The **deterministic engine** (`src/lib/disruption/engine.ts`) traverses the
   graph, marks the blast radius `at_risk`, totals the exposure and the
   non-refundable portion, and finds substitutes that survive the *cause* — a
   storm rules out anything `weather_sensitive`, so the boat is never replaced
   with another boat.
3. The **re-planning agent** (`src/lib/agent/replan.ts`) reads that assessment,
   calls the same tools, and writes two or three genuinely different plans.
4. Every tool call it made is rendered in the trace panel, with arguments,
   results and timings.
5. The operator accepts one. `applyProposal` checks the whole plan is
   applicable before writing any of it, then rewrites the itinerary
   deterministically: it rewires the dependency edges around the swap, cancels
   the bookings behind dropped stops and books the substitutes, returns and
   takes the matching `availability` seats, and marks the losing options
   superseded rather than deleting them.
6. The traveler's tab and the coordinator's phone update in place.

### The concierge, and why it is the same thing

A traveler types "add a wine tasting on day four" into the panel on their own
itinerary. What happens next is deliberately the disruption path with the storm
taken out:

1. Vela reads the trip. The whole itinerary and the whole catalogue ride in her
   opening brief, so the usual request needs no lookup at all.
2. She calls `propose_change`, which emits the **same four operations** the
   re-planner emits — `drop`, `move`, `replace`, `add` — and they go through the
   **same validator** (`src/lib/agent/plan.ts`). Invented ids are rejected, a
   locked stop cannot be dropped, and the cost delta is recomputed rather than
   believed.
3. The draft appears in the chat as a card: what changes, what it costs, and two
   buttons.
4. Accepting runs `applyProposal` — the identical deterministic code an operator
   runs. The operator's board and the guide's phone update in place.

She cannot touch a stop the operator is already re-planning. A traveler moving a
dinner that a storm had threatened would have set it back to `confirmed` on the
way through, quietly un-flagging a problem nobody had dealt with.

### The boundary that matters

**The agent proposes; a human accepts.** `propose_replan` and `propose_change`
both write a row to `replan_proposals`. Neither can touch a booking. The only
code that changes a live itinerary is `applyProposal`, which is ordinary
deterministic TypeScript behind a button. So the worst thing a bad generation can
do is put a bad suggestion in front of someone who declines it.

That is one approval path, not one per agent, and it is the reason a chat box was
safe to add at all. The copilot does not even have that: every tool behind it is
a read, so it has no way to write anything anywhere.

---

## Honest accounting

Worth saying plainly, because the alternative is being caught:

- **Four agents, and they are not equally impressive.** The re-planner is the
  real one: a tool-using loop, depth decided at runtime, five tools, its trace
  persisted to `agent_steps`. The concierge and the copilot are the same loop
  with different tools and a tighter iteration cap. Intake is a single
  structured call and no loop at all — calling it an agent would be generous.
- **Three of them cannot write anything.** The copilot's tools are all reads.
  Intake returns a spec to a form and touches no table. The concierge writes
  drafts only. One code path — `applyProposal` — changes a live itinerary, and a
  person clicks it.
- **The re-planner has a daily budget, and it is the likeliest thing to break
  a demo.** Groq's free tier allows 200,000 tokens a day on `120b`, and an
  agent loop that resends its transcript each iteration spends a real fraction
  of that per run. Exhaust it and every subsequent run 429s until the rolling
  window reopens tens of minutes later — which is not a pause you can wait out
  mid-demo. `withRateLimitRetry` now tells the three cases apart: a per-minute
  breach it waits out, a request larger than the ceiling it refuses
  immediately, and a spent daily budget it reports with the number and the
  reopening time rather than sleeping pointlessly. Rehearsing repeatedly means
  paying for the tier.
- **The chat is fast until it is not.** A single request is 1–2 seconds. Groq's
  free tier allows 8000 tokens a minute and an agent loop resends its history
  every iteration, so a burst of questions inside one minute will hit that
  window and wait it out — 15 to 35 seconds, once, before returning to normal.
  The chat runs on `openai/gpt-oss-20b` and the re-planner on `120b` partly for
  this reason: the limits are per model, so a demo typing at the concierge
  cannot slow the re-plan it is about to show.
- **Feasibility is a solver, not the model.** Availability, transit distance,
  cancellation penalties and cost deltas are all computed in code before the
  model sees anything. The model does preference-ordering and explains its
  reasoning. It is not doing the optimization, and the writeup does not claim it.
  The same is true in chat: the figure on a proposal card is recomputed by
  `validateOps`, never the number Vela said.
- **Vendor comms was cut.** The build spec listed five agents and ranked them;
  the one that drafts a message to a vendor and parses the reply back into
  structured availability is the one that did not get built. `check_vendor`
  writes the outbound approach to `messages`, so the trail exists — nothing
  reads a reply.
- **Payments are a state machine, not a payment processor.** `bookings.state`
  moves through held → confirmed → cancelled and the penalties are real numbers
  the re-planner prices against; no money moves.
- **RLS runs on the reads; the writes are still service-role, on purpose.**
  Every read in `src/lib/db/queries.ts` goes through the cookie-scoped client,
  so the policies are what decide which rows come back — `getTrip` takes an id
  and applies no ownership filter of its own. Signed in as someone else, the
  demo trip's URL is a 404. `npm run test:rls` signs in as four different
  people and proves it, including the case nothing else could catch: the
  `items_via_trip` policy carries no auth check of its own and works only
  because Postgres applies `trips`' RLS to the subquery inside it. If that
  assumption were wrong every itinerary would be readable by anyone with an
  account, and no amount of reading the policy would tell you.

  The writes still run as the service role, and that is a decision rather than
  a leftover: `applyProposal` moves `availability.slots_taken` and cancels
  vendor bookings — catalogue rows no user-facing policy grants a write on, and
  should not. So authorization for writes lives one layer up, in
  `src/lib/auth/guard.ts`: every mutating server action calls
  `assertTripAccess`, which asks RLS the same question the read path asks. A
  new mutating action that forgets it is a hole, and there is no second line of
  defence beneath it. That is the remaining soft spot, and it is a convention
  rather than a mechanism.
- **Inventory is reserved, not brokered.** Confirming a trip or accepting a
  re-plan creates real `bookings` rows and moves `availability.slots_taken`
  atomically, so a seat taken by one group is gone for the next. What it does
  not do is talk to a vendor system — an `auto` vendor's booking is marked
  confirmed on the strength of nothing but the schema saying they are reachable.
- **Weather is seeded.** `OPENWEATHER_API_KEY` is optional and unused by the
  demo path on purpose: a live API that flakes on stage is a liability.

---

## Realtime

The three surfaces stay in sync over Supabase Realtime **Broadcast**, not
Postgres Changes. Postgres Changes streams row data, so every subscriber needs a
SELECT policy covering those rows — which, with no sign-in, would mean opening
`itinerary_items` to anonymous readers and undoing the RLS the schema is careful
about. A broadcast carries no itinerary data at all. It is a nudge saying "this
trip moved"; each client then re-fetches through the server, where its own
permissions still apply.

- Server side: `notifyTrip(tripId, event)` — one HTTP POST, never throws. A
  dropped notification degrades to "the other screens update on next
  navigation", which must not roll back an accepted re-plan.
- Client side: `<LiveRefresh tripIds={…} />` subscribes and calls
  `router.refresh()`, showing what arrived and when.

---

## Stack

Next.js 14 (App Router, server components, server actions) · Supabase (Postgres,
RLS, Realtime) · Groq for the agent · Tailwind · Vercel.

No client-side data fetching library, no state manager, and no API routes for
mutations — server actions do the write and revalidate the readers in one step.
The field surface in particular is plain forms posting to server actions, which
is a deliberate choice for the screen most likely to be used one-handed on a
cliff path with two bars of signal.

---

## Running it

### 1. Environment

```bash
cp .env.example .env.local
```

Fill in, from your Supabase project's **Settings → API** and **Settings →
Database**:

| Variable | Where from |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Settings → API — server-side only, bypasses RLS |
| `SUPABASE_DB_PASSWORD` | Settings → Database |
| `GROQ_API_KEY` | console.groq.com — free tier, no card |

`GROQ_MODEL` and `GROQ_CHAT_MODEL` are optional overrides; see `.env.example`
for why they are two settings and not one.

**Google sign-in** needs two things set up outside this repo, and it is inert
until both are done:

1. Google Cloud console → *APIs & Services → Credentials → OAuth client ID*
   (Web application). The authorized redirect URI must be exactly
   `https://YOUR-PROJECT-REF.supabase.co/auth/v1/callback` — Supabase's, not
   this app's.
2. Supabase → *Authentication → Providers → Google* → enable it and paste in
   that client ID and secret. Then, under *Authentication → URL Configuration*,
   add `http://localhost:3000` and the deployed origin to **Redirect URLs**, or
   the callback is refused.

Until then, set `NEXT_PUBLIC_GOOGLE_AUTH=off` to hide the button: Supabase
rejects an unconfigured provider at its own `/authorize` endpoint, so the user
lands on raw JSON that this app never gets the chance to intercept. Email and
password work with no setup at all.

`AUTH_ENFORCED=false` turns the route guard off while leaving session refresh
alone — the switch to reach for if sign-in breaks shortly before a demo.

### 2. Database

```bash
npm install
npm run db:setup     # migrations, seed, and verification in one pass
npm run db:types     # regenerate row types from the live schema
```

`db:seed` now runs `scripts/seed-auth.mjs` after the SQL, which creates three
real accounts and points the seeded trip at them. That step is not optional:
`trips_read` matches on `traveler_id = auth.uid()`, and the SQL seeds that
column null, so without it the demo trip is invisible to everybody once RLS is
doing the filtering.

| Sign in as | Email | Sees |
|---|---|---|
| Traveler | `ananya@example.com` | Her own itinerary, and Vela |
| Operator | `ops@costiera-dmc.example` | The board, every group and vendor |
| Coordinator | `marco@costiera-dmc.example` | The run sheet for her group |

All three use `voyage-demo-2026` (override with `DEMO_PASSWORD`). They are
recreated on every re-seed, so a password changed in the dashboard is undone
rather than remembered.

> **If a script says `ENOTFOUND db.<ref>.supabase.co`.** That host publishes
> only an AAAA record, so on a network with no IPv6 route — a lot of conference
> wifi — it cannot be reached and every `pg`-based script dies looking exactly
> like a deleted project. It is not. Copy the transaction pooler string from
> Supabase → Settings → Database → Connection string into `SUPABASE_DB_URL` in
> `.env.local`; the pooler is dual-stack and every script prefers it when set.
> `scripts/db-setup.mjs` checks for the AAAA record and tells you which of the
> two you are looking at.

`db:setup` records applied migrations in `supabase_migrations.schema_migrations`
— the same ledger the Supabase CLI uses — so it and `supabase db push` agree
about what has run. It is safe to re-run; already-applied migrations are
skipped.

> **If the host does not resolve.** A free-tier Supabase project pauses after a
> week idle and is deleted after ninety days, at which point its hostname stops
> resolving entirely and every command fails with `ENOTFOUND`. Create a fresh
> project, put the new URL, keys and database password in `.env.local`, and run
> `npm run db:setup` again — the schema and the whole demo group are rebuilt
> from the files in `supabase/`. Nothing about the demo lives only in the
> database.

The seed computes every date from `current_date`, so the trip is always in
progress on whatever day you run it.

### 3. Develop

```bash
npm run dev          # http://localhost:3000/app
```

### Checks

```bash
npm run test:all         # everything below except the agent, in order, leaving a clean database

npm run db:verify        # schema and seed invariants — every row should say PASS
npm run test:rls         # four people sign in; nobody sees anyone else's trip
npm run test:disruption  # the deterministic engine, against the live database
npm run test:field       # the coordinator run sheet, reporting and escalation
npm run test:apply       # the write path — a plan that cannot fully apply must not half-apply
npm run test:flow        # the whole product end to end on a trip built from scratch
npm run test:realtime    # a browser-key subscriber receives what the server broadcasts
npm run test:agent       # a full re-planner run, including its trace
npm run test:concierge   # the traveler's concierge, through to an accepted change
npm run test:copilot     # the operator's copilot, including that it refuses to write
npm run test:intake      # prose to a trip spec, including inventing nothing
```

`db:verify` is the one to run after any migration or re-seed. The plan's
ordering was deliberate — the blast radius has to be provably correct *before*
an agent reasons over it, or a wrong re-plan could mean a bad graph or a bad
model and you end up debugging both at once.

`test:flow` is the one that catches seams. Every other suite exercises one layer
against the seeded group; this one plans a trip from nothing, confirms it, books
it, breaks it, re-plans it, accepts, checks the guide's run sheet, and deletes
itself — including giving back every seat it took. A layer can pass alone and
still fail here.

The last four are excluded from `test:all` on purpose: each costs real model
calls, and the re-planner takes anywhere from 55 to 240 seconds on Groq's free
tier. Run them deliberately.

They are worth running deliberately, though. `test:concierge` is the one that
caught the bug this feature was most likely to ship with: an added stop with no
declared prerequisites is an orphan in the graph, so nothing upstream reaches it
and every later blast radius is quietly smaller. The manual planner had always
chained a new stop to whatever preceded it; the agent path had not, which means
the re-planner had the same hole. `applyProposal` now chains through the same
helper `addItem` uses, and `verify.sql` asserts no itinerary has two roots.

> **Do not run `npm run build` while `npm run dev` is running.** They share the
> `.next` directory, and the production build overwrites the dev server's
> chunks — the symptom is every route suddenly 404ing with `MODULE_NOT_FOUND`
> in the terminal. Stop the dev server, or `rm -rf .next` and restart it.

---

## Layout

```
src/
  app/
    plan/  trip/[id]/  trip/[id]/build/   traveler (+ the concierge panel)
    ops/   ops/disruption/[id]/           operator
    field/ field/[id]/                    coordinator
    login/ auth/callback/             sign in, and where OAuth lands
  lib/
    auth/       who is looking at this page, and what they may act on
    db/         queries (RLS), mutations (service role), row types
    disruption/ the deterministic engine and the demo scenarios
    agent/      the loop, the shared plan validator, and the four agents
    realtime/   the broadcast contract and the server-side sender
    supabase/   admin (service role), server (RLS), browser clients
  middleware.ts   session refresh + the route guard
supabase/
  migrations/  schema, RLS, blast_radius, the field columns, atomic seat moves
  seed.sql     one operator, six vendors, eighteen inventory items, one group
  verify.sql   invariants — run after every migration
scripts/       db setup, type generation, the test suites
```

`plan.md` is the Phase 1 landing page. `plan-phase2.md` is the build spec this
implements. `DEMO.md` is the three-minute path.
