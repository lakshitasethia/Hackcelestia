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
| Planner | `/plan`, `/trip/[id]/build` | Traveler — dates, budget, interests, then build from real inventory |
| Itinerary | `/trip/[id]` | Traveler — the plan, live costs, what is at risk |
| Operations | `/ops` | Operator — groups, vendors, 72-hour schedule, open disruptions |
| Impact assessment | `/ops/disruption/[id]` | Operator — blast radius, candidates, the agent, the accept flow |
| Field run sheet | `/field/[id]` | Coordinator — today and tomorrow, report or escalate, on a phone |

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
5. The operator accepts one. `applyProposal` rewrites the itinerary
   deterministically, rewires the dependency edges around the swap, and marks
   the losing options superseded rather than deleting them.
6. The traveler's tab and the coordinator's phone update in place.

### The boundary that matters

**The agent proposes; a human accepts.** `propose_replan` writes a row to
`replan_proposals`. It cannot touch a booking. The only code that changes a live
itinerary is `applyProposal`, which is ordinary deterministic TypeScript. So the
worst thing a bad generation can do is put a bad suggestion in front of someone
who declines it.

---

## Honest accounting

Worth saying plainly, because the alternative is being caught:

- **One agent is an agent.** The re-planner is a real tool-using loop —
  multi-step, depth decided at runtime, five tools, its trace persisted to
  `agent_steps`. It runs on Groq (`openai/gpt-oss-120b` by default).
- **Intake is a form, not a model.** `/plan` collects structured preferences
  directly. The plan called for a prose-to-`prefs` extraction agent; it is not
  built, and the form is not pretending to be one.
- **Feasibility is a solver, not the model.** Availability, transit distance,
  cancellation penalties and cost deltas are all computed in code before the
  model sees anything. The model does preference-ordering and explains its
  reasoning. It is not doing the optimization, and the writeup does not claim it.
- **Payments are a state machine, not a payment processor.** `bookings.state`
  moves; no money does.
- **There is no sign-in yet.** RLS policies exist and are correct — travelers see
  their own trips, operators their org, coordinators their assigned groups — but
  with no `auth.uid()` to key off, server reads go through the service-role
  client. Every one of those reads is marked in `src/lib/db/queries.ts` so the
  swap is a small, findable change rather than an audit.
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

### 2. Database

```bash
npm install
npm run db:setup     # migrations, seed, and verification in one pass
npm run db:types     # regenerate row types from the live schema
```

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
npm run db:verify        # schema and seed invariants — every row should say PASS
npm run test:disruption  # the deterministic engine, against the live database
npm run test:field       # the coordinator run sheet, reporting and escalation
npm run test:apply       # the write path — a plan that cannot fully apply must not half-apply
npm run test:realtime    # a browser-key subscriber receives what the server broadcasts
npm run test:agent       # a full re-planner run, including its trace
```

`db:verify` is the one to run after any migration or re-seed. The plan's
ordering was deliberate — the blast radius has to be provably correct *before*
an agent reasons over it, or a wrong re-plan could mean a bad graph or a bad
model and you end up debugging both at once.

---

## Layout

```
src/
  app/
    plan/  trip/[id]/  trip/[id]/build/   traveler
    ops/   ops/disruption/[id]/           operator
    field/ field/[id]/                    coordinator
  lib/
    db/         queries, mutations, generated row types
    disruption/ the deterministic engine and the demo scenarios
    agent/      the re-planning loop and its five tools
    realtime/   the broadcast contract and the server-side sender
    supabase/   admin (service role), server (RLS), browser clients
supabase/
  migrations/  schema, RLS, the blast_radius function, the field columns
  seed.sql     one operator, six vendors, eighteen inventory items, one group
  verify.sql   invariants — run after every migration
scripts/       db setup, type generation, the test suites
```

`plan.md` is the Phase 1 landing page. `plan-phase2.md` is the build spec this
implements. `DEMO.md` is the three-minute path.
