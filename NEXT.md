# Where this is, and what to do next

> **Looking for the plan rather than the constraints?** `build_execution.md` has
> the dated execution plan — the deck for 9 Sep, the hardening for the 26–27 Sep
> finale, and the demo-day checklist. This file is the other half: the things
> that cost real time and tokens to learn, and the invariants not to redesign.

Written across two sessions: the one that added web research, the propose/confirm
gate and the PDF export, and the one that closed the remaining PS-7 gaps
(accommodation preferences, comparing alternatives, payments, Complete and
Review) and renamed the project to Waypoint. It exists so the next session does
not have to rediscover things that cost real time and tokens to learn.

## The shape of the thing

A sentence becomes an itinerary in three steps, and the split matters:

1. **Intake** (`agent/intake.ts`) — prose to a structured `TripSpec`. One call,
   no tools. Knows origin from destination ("India to Switzerland" is one
   destination, not two).
2. **Research** (`agent/research.ts`) — what exists, what it costs. Two passes,
   see the constraints below.
3. **Compose** (`agent/compose.ts`) — a *solver*. Routing is breadth-first over
   a leg graph, day allocation is arithmetic, costs are summed from rows. No
   model decides whether a plan fits. Keep it that way.

`planItinerary` decides and writes nothing; `commitItinerary` writes. The gap
between them is `/plan/proposal/[id]`, where a person says yes. There are two
gates on purpose: "the plan is right" and, later, "go and spend my money".

## Constraints that are not obvious and cost a day to find

**Groq limits are per organization, not per key.** Rotating a key changes
nothing. A second Groq account is a second org.

**`openai/gpt-oss-120b` allows 8,000 tokens per minute** on the free tier, and
`groq/compound-mini` runs on it. One web search costs ~7,500. So the real
ceiling is about one search a minute whatever the daily number says. This is why
price verification is offline (`npm run research:warm`) and not part of a
request somebody is waiting on.

**compound's context is small and it injects fetched pages into it.** Discovery
questions ("things to do in Lucerne", "which towns for 13 days") return
listicles and come back 413 *after* the search is paid for. Questions about one
named thing's price fit. Measured, on a fresh org with a full budget:

    "Lucerne: 4 things to do with prices"        -> 413
    "Best 5 towns for 13 days in Switzerland"    -> 413
    "price of the Swiss Travel Pass and Lindt"   -> OK, 7,190 tokens

Shape matters, length does not: a bare keyword string is a discovery query and
fails; a specific question ending "cite the page" succeeds.

**`openai/gpt-oss-120b` with Groq's `browser_search`** reads pages far better and
has the context to hold them, but bills you the fetched page content — one city
query measured 153,000 prompt tokens against a 200,000 daily allowance. Right
answer on a paid tier, unusable on the free one.

**Gemini was tried.** The key works and plain generation works, but Google Search
grounding returns 429 on the free tier — it needs billing enabled. Without
grounding there is no reason to switch.

## Ranked backlog

1. **Catalogue depth.** The biggest single limitation. Zurich has 7 activities
   and a 13-day plan uses all 7, so there is nothing spare for the re-planner to
   offer and the days are thinner than they should be. Fix: more places per city
   from the planner pass, or several passes per city merged. Everything below is
   smaller than this.

2. **Verification rate.** 3-4 prices of 35 come off a live page. The UI is honest
   about it ("N of M checked, the rest are estimates") which is defensible, but
   Dev Tier or a different search vendor would make it 15+.

   **This is the one red tick in the suite, and it is this, not a bug.**
   `npm run test:research` asserts "most rows cite the page they came from" —
   at least half of 35. The free tier delivers 4. The check has never passed
   and cannot pass without paying for search, so it is a standing measurement
   of the gap rather than a failure to chase. Deliberately *not* weakened to
   go green: the number it reports is the honest one, and softening the
   assertion would only hide the day the search vendor changes.

   Note also that the Switzerland cache holds two entries with different
   fingerprints, one with 4 sourced rows and one with none, and the test hits
   the empty one. Clearing `research_cache` and re-warming would improve the
   number but not enough to pass — `fingerprint()` covers destinations, days,
   month, must-dos and currency, so the two entries came from differently
   worded asks.

3. **No test covers the traveller UI flow.** Every bug in the last stretch —
   stale verified prices, duplicate landmarks, the budget in the wrong currency,
   the missing link to the confirm step — was found by clicking, not by a suite.
   A Playwright pass over plan -> proposal -> accept -> confirm would have caught
   all four.

4. **The demo needs two trips.** Switzerland shows planning; Amalfi shows
   disruption and re-planning, because it has seeded availability and spare
   alternatives. One trip doing both is downstream of item 1.

5. **Invented places.** The planner prompt now names this as the worst thing it
   can produce and lists real examples, after it emitted a "Schweizer Schokolade
   Factory Tour" in Bern. Hardened, not eliminated. Verification is the only real
   defence and see item 2.


## Closed since this was written

- **`npm run test:apply`'s 2 failures were dirty seed state, not code.** After
  `npm run db:seed` the suite passes in full, every time. The note here said
  "confirmed pre-existing, never investigated"; investigating took one re-seed.
  Worth remembering the next time a suite looks broken: check the database
  before you check the diff.

- **The print view's missing last day.** It iterated the days that *had stops*,
  which is not the same list as the days of the trip — the composer leaves the
  last one free for the journey home. It now walks `starts_on` to `ends_on` and
  prints an empty day as an empty day ("Travelling home. Nothing booked.").

- **The agent loop died on its own last step.** `withRateLimitRetry` recovers
  from a refused `tool_choice` pin by relaxing it, but matched the error body
  with `includes("tool_choice")` — and Groq also says *"Tool choice is
  required, but model did not call a tool"*. Capital T, one space, no match. So
  a re-planner that had already recorded two good proposals and simply wanted
  to answer in prose retried the identical pinned request four times and threw.
  Now matched with `/tool[_ ]choice/i`. This is the class of bug that takes a
  demo down at the worst possible moment.

- **A prompt addition silently cost three other fields.** Adding nine lines of
  lodging rules to the intake prompt — in the middle, before the `party_size`
  paragraph — made it stop extracting pace, mobility and dietary. `test:intake`
  caught it; a `git stash` of that one file proved it was the cause rather than
  model flakiness. Fixed by shortening the addition, moving it to the end, and
  giving pace/mobility/dietary explicit rules of their own, which they had
  never had. **Re-run `test:intake` after any edit to that prompt** — the
  fields it extracts by inference are load-bearing and invisible.

## Things that are right and should not be redesigned

- The solver/model split in `compose.ts`.
- Two gates: accept the plan, then confirm the booking.
- The DAG. `addItems` builds the chain in memory and writes once (52 stops in
  0.33s, was 40s); the blast radius walks it unchanged.
- RLS. `agent_runs` was leaking trip-less runs to any signed-in user; closed.
  `scripts/test-rls.mts` passes in full and should stay that way.
- Researched inventory is `provisional` against a `manual` vendor, so
  `confirmTrip` holds rather than reserves. Nothing researched auto-books.
- One write path. `switchStop` (the traveler's compare-and-switch) builds a
  one-operation plan and sends it through `validateOps` and `applyProposal`
  rather than updating `itinerary_items` directly. It would be four lines the
  short way and it would silently skip rewiring the dependency edges,
  cancelling the old booking, making the new one and moving the seats. Keep new
  itinerary writes going through that road.
- `src/lib/trip/stage.ts` is pure and takes rows. It decides what every surface
  tells the user to do next; keep it free of database calls so it stays
  testable and cannot answer differently in two places.

## Running it

    npm run dev
    npm run test:abroad      # research -> plan -> commit, no network
    npm run test:cache       # proves a cache hit never reaches the network
    npm run test:lodging     # accommodation preferences reach the solver
    npm run test:compare     # compare alternatives, switch, and the ledger agrees
    npm run test:lifecycle   # the eleven stages, payments, closing out, reviews
    npm run test:assignment  # the trip reaches operator and guide, via real RLS
    npm run test:rls
    npm run research:warm -- "<prompt>"   # offline price verification, minutes

Demo accounts are `waypoint-demo-2026`. **Sign in, never Create account** — signing
up over a seeded operator email demotes it to a traveller and the guide's run
sheet silently empties. `npm run db:seed:auth` restores it.

The guide's run sheet shows the next 48 hours only, so a trip planned for next
month correctly shows nothing.
