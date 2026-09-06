# Build execution — what happens between now and the finale

Written 6 Sep 2026, at the end of the session that closed the remaining PS-7
gaps and renamed the project to Voyage.

This is the **execution plan**: what to do, in what order, and by when.
It deliberately does not repeat what is already written down elsewhere:

| If you need | Read |
|---|---|
| What the product is and how it is built | `README.md` |
| Constraints that cost a day to rediscover, and the ranked backlog | `NEXT.md` |
| How to run the three-browser demo | `DEMO.md` |
| Why the repo is called Voyage and what the password is now | `NEXT.md`, and the memory note |

---

## Restore context in sixty seconds

Voyage is a personalized dynamic tour planning and operations platform, built
for **HackCelestial 3.0, PS-7** (Tech Alegria, Pillai University). Three people
see the same trip — traveler, operator, coordinator — and an itinerary is a
**DAG, not a list**, so "identify the impact of a change" is a graph traversal
rather than a pile of special cases.

Prove the whole thing still works, from cold:

```bash
npm run db:setup      # migrations + seed + verify, idempotent
npm run test:all      # 8 suites, no model calls, ~3 minutes
```

Expect **24 PASS** from `db:verify` and **159 PASS / 0 FAIL** from `test:all`.
Anything else means the database drifted, not that the code broke — re-seed
before you read a diff. (That mistake already cost one session: `test:apply`'s
two "pre-existing, never investigated" failures were dirty seed state.)

Demo accounts are all password **`voyage-demo-2026`**, and you must **sign in,
never Create account** — signing up over a seeded operator email demotes it to a
traveller and the guide's run sheet silently empties.

---

## The clock

| Date | What it demands |
|---|---|
| **9 Sep 2026** | **Ideathon / Review round — an idea PPT.** Not a prototype. |
| 13 Sep 2026 | Finalist announcement |
| **26–27 Sep 2026** | **Grand finale — 24 hours, offline, at PCE New Panvel. A working prototype or simulation is mandatory.** |

The public site still says the gate closes 6 Sep. It is stale; the deadline is
the 9th.

**The single most important scheduling fact:** the thing due on the 9th is a
deck, and the thing due on the 26th is the running product. They want different
work. Do not spend the next three days writing code that no judge will see
before the 13th.

---

## Where things stand

Every requirement PS-7 names is now built. The four that were missing as of
5 Sep — accommodation preferences, comparing alternatives, payments, and the
Complete/Review stages — were closed in commit `7f2fa0c`.

**Tests: 338 checks pass across 19 suites, 1 fails.** The one red tick is
deliberate and is discussed below.

Surfaces, and who each is for:

```
/                          the pitch
/explore                   Discover — the catalogue by town, before a trip exists
/plan  /trip/[id]/build    Personalize, Plan, Price
/plan/proposal/[id]        gate 1 — "the plan is right"
/trip/[id]                 the itinerary, the lifecycle rail, payments, Vela
/trip/[id]/compare/[item]  compare alternatives, and switch
/trip/[id]/build           gate 2 — "go and spend my money"
/trip/[id]/print           Prepare — the PDF
/trip/[id]/review          Complete, then Review
/ops                       Operate — groups, vendors, 72h, money, disruptions
/ops/disruption/[id]       Adapt — blast radius, candidates, the agent
/ops/customers             every customer, across trips
/ops/reviews               what came back, worst first
/field/[id]                the coordinator, on a phone, next 48 hours only
```

---

## Phase 1 — now to 9 Sep: the deck

Three days, and the deliverable is a PPT. Code changes in this window are a
distraction unless they produce a screenshot.

### 1.1 The one diagram that carries the idea

Everything else in the deck is supporting material for this:

```
hotel ──> transfer ──> boat ──┬──> lunch on Capri
                              └──> return transfer ──> dinner
```

Kill the boat: lunch, the return transfer and dinner go with it. The hotel does
not, because nothing downstream flows backwards. That is `blast_radius()` in
Postgres, and it is the reason the impact analysis is a traversal instead of
guesswork. **Lead with this.** It is the only thing in the project that a judge
cannot assume every other team also has.

### 1.2 Slides worth building, in order

1. **The moment.** 07:40 on day two, the skipper calls, the swell is too high,
   and four other bookings quietly depend on that boat. Not "travelers want
   personalization" — every team will open with that.
2. **The one decision.** The DAG diagram above.
3. **The three lenses.** Traveler, operator, coordinator, on the same trip, in
   sync over Realtime broadcast. Screenshot the three side by side.
4. **The lifecycle.** PS-7 prints eleven stages; `src/lib/trip/stage.ts` is
   those eleven stages as one pure function, rendered as a rail on the
   itinerary. Screenshot it. This is the slide that answers "did you read the
   brief".
5. **The agent boundary.** *The agent proposes; a human accepts.* One approval
   path (`applyProposal`), not one per agent. Three of the five agents cannot
   write anything at all.
6. **Honest limitations.** See 1.4.
7. **PS-7 coverage table.** Requirement, where it lives, one line each.

### 1.3 Screenshots to capture

Run the app and take these before writing a word of the deck — they will
change what you want to say:

```bash
npm run dev     # http://localhost:3000/app
```

- `/trip/[id]` with the lifecycle rail visible and a stage highlighted
- `/ops/disruption/[id]` mid-assessment: blast radius, candidates, agent trace
- `/trip/[id]/compare/[itemId]` showing a price delta on a real swap
- `/field/[id]` on a narrow viewport — it should look like a phone
- `/trip/[id]/review` with stars filled in

Use `DEMO.md` for the three-browser setup; it is written for exactly this.

### 1.4 Say the limitations out loud

A judge who finds a weakness you hid distrusts the rest of the deck. A judge who
sees you name it first does not go looking. Take these straight from `README.md`'s
"Honest accounting", which is already written in the right tone:

- The composer **routes, it does not reason about geography** — breadth-first
  search over a hand-written leg graph. Deliberate: a model asked to order six
  Himalayan towns sends you Amritsar → Chopta → Manali, because it cannot feel
  two days of driving.
- **Payments are a ledger, not a processor.** No card is charged anywhere.
- **Inventory is reserved, not brokered.** Seats move atomically; no vendor
  system is contacted.
- **Weather is seeded.** A live API that flakes on stage is a liability.
- **Feasibility is a solver, not the model.** The model orders preferences and
  explains itself; it does not decide whether a plan fits.

---

## Phase 2 — 13 to 26 Sep: harden for the finale

Only if you are shortlisted. A working prototype is **mandatory** for the
finals, so this window is about the demo surviving contact with a stage.

Ordered by what actually threatens the demo, which is not the same as ordered by
how interesting the work is.

### 2.1 A Playwright pass over the traveller flow — *do this first*

This is item 3 in `NEXT.md`'s backlog and it is now the top risk. Every bug in
the last stretch — stale verified prices, duplicate landmarks, the budget in the
wrong currency, the missing link to the confirm step — was found by clicking,
not by a suite. The session that closed the PS-7 gaps added **five new screens**
that have logic tests and no click-through test at all.

Cover, in one pass: `/plan` → propose → `/plan/proposal/[id]` → accept →
`/trip/[id]` → compare → switch → confirm → `/trip/[id]/review` → rate.

Acceptance: it fails loudly if a primary button disappears. That is the failure
mode the lifecycle rail was built to prevent and nothing currently guards it.

### 2.2 Catalogue depth

`NEXT.md` item 1, and the biggest *product* limitation rather than a code one. A
13-day Swiss plan uses all 7 Zurich activities, so the re-planner has nothing
spare to substitute and the days are thinner than they should be. Fix: more
places per city out of the planner pass, or several passes merged.

Everything below this is smaller than it.

### 2.3 Two demo trips

`NEXT.md` item 4. Switzerland shows planning from a sentence; Amalfi shows
disruption and re-planning, because it has seeded availability and spare
alternatives. One trip doing both is downstream of 2.2.

### 2.4 The remaining soft spot, if there is time

Mutating server actions authorize through `assertTripAccess` by **convention**,
not by mechanism — writes still run as the service role, on purpose, because
`applyProposal` moves catalogue rows no user-facing policy grants a write on. A
new mutating action that forgets the call is a hole with no second line of
defence. Worth a lint rule or a test that enumerates every `"use server"` export
and asserts each one calls a guard.

---

## Phase 3 — the 24 hours of the finale

- **Re-seed before you present.** `npm run db:seed`. The agent suites leave the
  trip re-planned; the seed computes every date from `current_date`, so the trip
  is always live on the day you run it.
- **Rehearse on the venue's wifi.** If a script dies with
  `ENOTFOUND db.<ref>.supabase.co`, that host publishes only an AAAA record and
  the network has no IPv6 route. Set `SUPABASE_POOLER_HOST` — the pooler is
  dual-stack. This is in `README.md` and it looks exactly like a deleted
  project, which is a bad thing to debug on stage.
- **Do not rehearse the agent repeatedly.** Groq's free tier is 200,000 tokens a
  day **per organization, not per key** — rotating a key changes nothing. An
  exhausted daily budget 429s until the rolling window reopens tens of minutes
  later, which is not a pause you can wait out mid-demo.
- **Never run `npm run build` while `npm run dev` is running.** They share
  `.next`; the symptom is every route 404ing with `MODULE_NOT_FOUND`.
- Have the PDF export open in a tab as a fallback. If anything live fails, the
  document still tells the story.

---

## The one red tick, and why not to "fix" it

`npm run test:research` fails one check: **"most rows cite the page they came
from" (0/35, wants ≥17)**.

This is a measurement, not a bug. The assertion wants half of 35 places to carry
a `sourceUrl`; Groq's free tier delivers 4. It has never passed and cannot pass
without paying for search — `NEXT.md` item 2 has the numbers.

**Do not weaken the assertion to go green.** The figure it reports is the honest
one, and softening it only hides the day the search vendor actually breaks. If
someone asks about it, the answer is that price verification is a known,
measured, documented gap with a price tag attached, and the UI already says
"N of M checked, the rest are estimates" to the traveler's face.

(Two Switzerland entries sit in `research_cache` with different fingerprints,
one with 4 sourced rows and one with none; the test hits the empty one. Clearing
and re-warming improves the number and still does not reach half.)

---

## Commands

```bash
# state
npm run db:setup          # migrations + seed + verify, idempotent, safe to re-run
npm run db:seed           # reset the demo to a clean, live-today trip
npm run db:verify         # 24 schema and seed invariants
npm run db:types          # regenerate row types after any migration

# the free suites — run these constantly
npm run test:all          # disruption, field, apply, lodging, compare, lifecycle, flow, realtime
npm run test:rls          # four people sign in; nobody sees anyone else's trip
npm run test:lodging      # accommodation preferences: bed, bill, and the town it could not match
npm run test:compare      # compare and switch; the ledger and the graph must agree
npm run test:lifecycle    # the eleven stages, payments arithmetic, closing out, reviews
npm run test:abroad       # research -> plan -> commit, with the web pass stubbed
npm run test:cache        # proves a cache hit never reaches the network
npm run test:replan-tools # the re-planner's five tools, without the model

# these cost real model calls — run deliberately
npm run test:intake  test:copilot  test:concierge  test:agent  test:research

npm run dev               # http://localhost:3000/app
```

---

## Invariants — do not redesign these

Repeated here because they are the things a future session is most likely to
"simplify" and regret. The full list is in `NEXT.md`.

- **The DAG.** `itinerary_items.depends_on` is the whole idea. Blast radius,
  timing conflicts and cost deltas all fall out of one traversal, and it lives
  in Postgres so the UI and the agent cannot disagree about it.
- **One write path.** `applyProposal` is the only code that changes a live
  itinerary, and a human clicks it. `switchStop` takes the long road through
  `validateOps` for exactly this reason — the four-line shortcut silently skips
  rewiring edges, cancelling the old booking and moving the seats.
- **The solver/model split** in `compose.ts`. Never let a model decide whether a
  plan fits.
- **Two gates.** "The plan is right", then later "go and spend my money".
- **`src/lib/trip/stage.ts` stays pure.** It decides what every surface tells
  the user to do next; keep database calls out of it so it cannot answer
  differently in two places.
- **Re-run `test:intake` after touching the intake prompt.** Adding nine lines
  to it once silently stopped it extracting pace, mobility and dietary. The
  fields it gets by inference are load-bearing and invisible.
