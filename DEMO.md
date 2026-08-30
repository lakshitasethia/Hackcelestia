# Voyage — the three-minute demo

Rehearse this. A rehearsed three minutes beats two more features, and every
number below is one you will be asked to justify.

---

## Pre-flight (do this 15 minutes before, not on stage)

```bash
npm run db:setup      # rebuilds schema + seed; safe to re-run
npm run db:verify     # every row must say PASS
npm run dev
```

Then **pre-warm the agent once and reset**:

1. `/ops` → Demo controls → **Storm front**
2. Open the disruption → **Run the re-planner** → let it finish
3. `/ops` → Demo controls → **Reset trip**

This matters for two reasons. The first run pays the cold start. And Groq's free
tier meters tokens per minute across an agent loop that resends its history each
iteration — a run that has just been exercised is a run whose rate-limit window
you understand.

**Windows, arranged before you start talking:**

| Window | URL | Note |
|---|---|---|
| A | `/ops` | The operator's board. Your main screen. |
| B | `/trip/<id>` | The traveler. Leave it visible. |
| C | `/field` | Narrow it to phone width. This is the guide. |

Do not reload B or C at any point. The entire claim is that you never have to.

---

## The run

### 0:00 — The shape of the problem *(20s)*

Open `/app`.

> "A tour operator's week doesn't fall apart at the planning stage. It falls
> apart at 07:40 on the second morning. Three people are looking at the same
> trip — the traveler, the operator, and the guide standing on the quay — and
> when something breaks, all three have to agree within minutes."

### 0:20 — The traveler's plan, and the graph underneath it *(25s)*

Window B, `/trip/<id>`. Scroll to Day 02.

> "Two travelers, five days on the Amalfi Coast, €4,500. Note what's under each
> stop: **Needs**. Lunch on Capri needs the boat. The return transfer needs the
> boat. Dinner needs the return transfer."

> "That's not decoration — the itinerary is a dependency graph, not a list. It's
> the reason the next sixty seconds work at all."

### 0:45 — The operator's board *(20s)*

Window A, `/ops`.

> "The operator sees every group, every vendor, and every movement in the next
> 72 hours. Marco Ferrara is the guide with this group. Right now, nothing is on
> fire."

### 1:05 — The guide escalates *(25s)*

Window C, `/field`. This is the phone.

> "Marco is on the quay. Tomorrow's boat day is on his run sheet."

Open **Flag a problem** on the boat. Type — really type it, it reads as real:

```
Skipper says the swell is too high to sail.
```

Set the cause to **Weather**. Then **Report to the office.**

> "One tap, a sentence, and what kind of problem it is. That last part matters —
> the cause decides which replacements are even considered."

### 1:30 — It arrives, live *(15s)*

Point at Window A. **Do not touch it.** It already says one open disruption.

> "Nobody refreshed that. The operator's board just heard about a problem
> reported from a phone on a quay in Positano."

### 1:45 — Impact, computed not guessed *(30s)*

Window A → **Assess impact**.

> "Four items affected. €1,115 exposed. €195 of it non-refundable — that number
> is what stops the naive answer of 'just cancel it'."

Point at the indented chain.

> "The indentation is the dependency depth. The boat, then lunch and the return
> transfer one hop out, then dinner two hops out. The hotel is *not* in there —
> nothing flows backwards. And it's locked: four nights prepaid, non-refundable.
> Any re-plan has to work around it."

> "Six candidate replacements, and every one of them survives a storm. No boat
> is being offered to replace a boat. All of that is a graph traversal and a
> query — no model has run yet."

### 2:15 — The agent *(30s)*

**Run the re-planner.**

While it runs, the trace panel fills. Point at it.

> "Every tool call it makes, in order, with its arguments, its result and how
> long it took. Anyone can say they used AI — this is the part you can audit."

> "It cannot book anything. `propose_replan` writes a draft. The only code that
> changes a live itinerary is deterministic TypeScript that runs when a human
> accepts."

### 2:45 — Accept, and everyone knows *(15s)*

Read the two proposals aloud — the cost delta and one line of rationale each.
Accept one.

> "One click."

Point at Window B, then Window C. Both have already changed.

> "The traveler's itinerary, and the guide's run sheet. Neither of them did
> anything."

### 3:00 — Land it

> "The landing page claims an eight-second median re-plan and 98% resolved
> without a phone call. That's the mechanism behind both."

---

## Reset between runs

**Which reset you need depends on how far you got.**

| You stopped at | Use | Why |
|---|---|---|
| Anywhere before **Accept** | `/ops` → Demo controls → **Reset trip** | Clears the disruption, restores every at-risk stop, wipes the field reports. Instant, no re-seed, and you can do it while someone is asking a question. |
| You **accepted a plan** | `npm run db:seed` (~1s) | Accepting is a real, permanent write — the boat is `replaced`, three stops are `cancelled`, and a substitute now sits in the itinerary. **Reset trip cannot undo that**, and it is not supposed to: an operator cannot un-cancel a supplier by clicking a button. Re-seeding rebuilds the group from `supabase/seed.sql`. |

Between rehearsals of the full path, re-seed. It is faster than explaining to a
judge why the boat is missing.

---

## If something goes wrong

| Failure | What to do |
|---|---|
| Agent is rate-limited (429) | It retries and waits out the token window. If it fails, say so and pivot: *"the deterministic assessment above is the part that has to be right, and it's still there"* — then show a completed run from a previous disruption. |
| Agent proposes nothing | Reset, re-run. The loop pins its first and last turns to `propose_replan` precisely because prose records nothing, but a bad generation is still possible. |
| Accepting a plan errors with "cannot be applied" | Working as intended — the plan was incomplete and the itinerary was left untouched rather than half-changed. Accept the other proposal, or re-run the agent. |
| The agent takes much longer than 60s | Groq's free tier varies a lot: runs have taken 55s, 111s and 242s on identical input. Nothing is wrong. This is the strongest argument for cutting the wait in a recording. |
| Realtime does not fire | Reload B and C manually and keep going. `revalidatePath` has already made them correct; only the liveness is lost. The `Live`/`Offline` pill tells you which case you are in before you point at it. |
| Database is unreachable | `npm run db:setup` and check the hostname resolves — a paused or deleted Supabase project fails with `ENOTFOUND`. See the README. |
| The itinerary looks wrong from a previous run | `npm run db:seed`. Takes about a second and restores the group exactly. |

---

## The questions you will be asked

**"Is the LLM doing the optimization?"**
No, and the writeup says so. Availability, transit distance, cancellation
penalties and cost deltas are computed in code before the model sees anything.
The model does preference-ordering across pre-costed options and explains why.

**"What stops it booking something wrong?"**
It has no write path to a booking. Its only write tool inserts a draft
proposal. `applyProposal` is ordinary deterministic code behind a human click.

**"Does this work for more than one destination?"**
The schema does — vendors, inventory and availability are generic, and the trip
carries its own dates and preferences. The seed is one region because depth on
the disruption path scores better than breadth nobody demos.

**"What's missing?"**
Sign-in. RLS policies are written and correct, but with no `auth.uid()` the
server reads run through the service-role client. Every one of those is marked
in `src/lib/db/queries.ts`.
