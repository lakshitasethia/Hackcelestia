# Where this is, and what to do next

Written at the end of the session that added web research, the propose/confirm
gate and the PDF export. It exists so the next session does not have to
rediscover things that cost real time and tokens to learn.

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

3. **`npm run test:apply` has 2 failing checks** — "the refusal names the
   offending operation" and "the broken stop is NOT marked replaced". Confirmed
   pre-existing: they fail identically on a stash of all this work. Never
   investigated.

4. **No test covers the traveller UI flow.** Every bug in the last stretch —
   stale verified prices, duplicate landmarks, the budget in the wrong currency,
   the missing link to the confirm step — was found by clicking, not by a suite.
   A Playwright pass over plan -> proposal -> accept -> confirm would have caught
   all four.

5. **The demo needs two trips.** Switzerland shows planning; Amalfi shows
   disruption and re-planning, because it has seeded availability and spare
   alternatives. One trip doing both is downstream of item 1.

6. **Invented places.** The planner prompt now names this as the worst thing it
   can produce and lists real examples, after it emitted a "Schweizer Schokolade
   Factory Tour" in Bern. Hardened, not eliminated. Verification is the only real
   defence and see item 2.

7. **The print view has no day 13** — the journey home has no stops, so the
   document ends at day 12 while the header says 13 days. Harmless, reads oddly.

## Things that are right and should not be redesigned

- The solver/model split in `compose.ts`.
- Two gates: accept the plan, then confirm the booking.
- The DAG. `addItems` builds the chain in memory and writes once (52 stops in
  0.33s, was 40s); the blast radius walks it unchanged.
- RLS. `agent_runs` was leaking trip-less runs to any signed-in user; closed.
  `scripts/test-rls.mts` passes in full and should stay that way.
- Researched inventory is `provisional` against a `manual` vendor, so
  `confirmTrip` holds rather than reserves. Nothing researched auto-books.

## Running it

    npm run dev
    npm run test:abroad      # research -> plan -> commit, no network
    npm run test:cache       # proves a cache hit never reaches the network
    npm run test:assignment  # the trip reaches operator and guide, via real RLS
    npm run test:rls
    npm run research:warm -- "<prompt>"   # offline price verification, minutes

Demo accounts are `voyage-demo-2026`. **Sign in, never Create account** — signing
up over a seeded operator email demotes it to a traveller and the guide's run
sheet silently empties. `npm run db:seed:auth` restores it.

The guide's run sheet shows the next 48 hours only, so a trip planned for next
month correctly shows nothing.
