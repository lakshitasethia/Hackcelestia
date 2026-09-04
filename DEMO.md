# Voyage — the three-minute demo

Rehearse this. A rehearsed three minutes beats two more features, and every
number below is one you will be asked to justify.

---

## Pre-flight (do this 15 minutes before, not on stage)

```bash
npm run db:setup      # rebuilds schema + seed; safe to re-run
npm run db:seed       # re-run this even if setup just did — it resets the dates
npm run db:verify     # every row must say PASS, all 24 of them
npm run dev
```

> **If any of those says `ENOTFOUND db.<ref>.supabase.co`,** the project is
> almost certainly fine — that host is IPv6-only and the venue's wifi has no
> IPv6 route. Put the transaction pooler string (Supabase → Settings →
> Database → Connection string → Transaction pooler) into `SUPABASE_DB_URL` in
> `.env.local` and run it again. **Get this into `.env.local` before you
> travel**, not while a judge waits.

### Sign the three windows in

This is the step that did not exist before there was a login, and it is the one
that will cost you a minute on stage if you leave it until then. Cookies are
per browser profile, so three people signed in at once means three *separate*
browser sessions — not three tabs, and not three windows of the same profile.

| Window | Sign in as | Password | Then go to |
|---|---|---|---|
| A — normal Chrome | `ops@costiera-dmc.example` | `voyage-demo-2026` | `/ops` |
| B — Chrome incognito | `ananya@example.com` | `voyage-demo-2026` | `/trip/<id>` |
| C — a second browser (Safari, Firefox, or a second Chrome profile) | `marco@costiera-dmc.example` | `voyage-demo-2026` | `/field` |
| D — *optional, a third browser or profile* | `stranger@example.com` | `voyage-demo-2026` | the **same** `/trip/<id>` URL as B |

All four accounts are recreated by `npm run db:seed`, so a re-seed never
locks you out. Two incognito windows share one session, which is why C has to
be a different browser rather than a second incognito window.

Window D is a prop, not a lens. `stranger@example.com` is a real confirmed
account that owns nothing, so the traveler's own URL renders a **404** for
her. Leave that 404 on screen before you start; you point at it once and never
touch it. If you cannot spare a third browser, skip D — the Q&A section below
has the fallback.

Then **pre-warm both agents once and reset**:

1. `/ops` → Demo controls → **Storm front**
2. Open the disruption → **Run the re-planner** → let it finish
3. Open `/trip/<id>`, press **Ask Vela**, send one message
4. `/ops` → Demo controls → **Reset trip** (this also wipes the chat)

This matters for two reasons. The first run pays the cold start. And Groq's free
tier meters tokens per minute across an agent loop that resends its history each
iteration — a run that has just been exercised is a run whose rate-limit window
you understand.

> ### Count your re-planner runs. This is the real constraint.
>
> The free tier caps the re-planner's model at **200,000 tokens per day**, and
> the agent loop resends its whole transcript every iteration, so one full run
> is an appreciable slice of that. A morning of rehearsing can spend the day's
> budget before you present, and when it goes you get a 429 that **no amount of
> waiting inside the demo will clear** — the daily window reopens over tens of
> minutes, not seconds.
>
> Two things follow. Pre-warm the re-planner **once**, not repeatedly. And if
> you want to rehearse properly, put a card on the Groq account the day before
> — the paid tier is inexpensive and it removes the single most likely way for
> this demo to fail on stage.
>
> The chat agents run on a different model with a separate budget, so warming
> Vela does not spend the re-planner's. `npm run test:agent` names which limit
> it hit and how long until it reopens.

The two run on different models on purpose, so warming one does not eat the
other's minute. That is also why you can let a judge type at Vela without
risking the re-plan you are about to show them.

**Windows, arranged before you start talking** — signed in per the table
above, and left on these pages:

| Window | URL | Signed in as | Note |
|---|---|---|---|
| A | `/ops` | operator | The operator's board. Your main screen. |
| B | `/trip/<id>` | Ananya | The traveler. Leave it visible. |
| C | `/field` | Marco | Narrow it to phone width. This is the guide. |

Do not reload B or C at any point. The entire claim is that you never have to.

**If sign-in breaks on the morning:** put `AUTH_ENFORCED=false` in `.env.local`
and restart. That drops the login wall *and* puts the reads back on the service
role, so all three windows work anonymously in one browser exactly as they did
before auth existed. You lose Window D's answer and nothing else. Take that
trade instantly rather than debugging OAuth in front of judges.

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

### *(optional, +30s)* — The traveler changes their own plan

**Take this out if you are tight; keep it if there is any chance the judges will
want to touch something.** It is the only part of the demo somebody else can
drive, and it makes the accept boundary concrete before the storm makes it
dramatic. Everything after it shifts thirty seconds later.

Still in Window B. Press **Ask Vela**, and type:

```
Add a wine tasting on day 4
```

> "Same trip, same graph — this time nothing has gone wrong. She reads the
> itinerary and the catalogue, and she writes a draft."

The card appears: what changes, and what it costs.

> "That's the whole product in one card. She hasn't booked anything. She
> *can't* — the only tool she has that writes at all writes a draft, and this
> button is the same code an operator runs when they accept a re-plan."

Press **Do it**. Point at Window A.

> "One traveler, one sentence, and the operator's board already knows."

Then say the honest part out loud, because someone will ask:

> "The model is not choosing this. The dates, the price and the dependency
> wiring are computed before it sees anything, and the number on that card is
> recomputed by the server — in testing the model was out by €670 on its own
> arithmetic, which is why nothing takes its word for it."

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
| Anywhere before **Accept** | `/ops` → Demo controls → **Reset trip** | Clears the disruption, restores every at-risk stop, wipes the field reports, and deletes the concierge and copilot conversations along with any undecided drafts. Instant, no re-seed, and you can do it while someone is asking a question. |
| You accepted a **concierge** suggestion | `npm run db:seed` (~1s) | Same reason as below: accepting is a real write. Reset trip deliberately keeps an accepted change, because deleting the record of a decision somebody made is not what "reset" should mean. |
| You **accepted a plan** | `npm run db:seed` (~1s) | Accepting is a real, permanent write — the boat is `replaced`, three stops are `cancelled`, and a substitute now sits in the itinerary. **Reset trip cannot undo that**, and it is not supposed to: an operator cannot un-cancel a supplier by clicking a button. Re-seeding rebuilds the group from `supabase/seed.sql`. |

Between rehearsals of the full path, re-seed. It is faster than explaining to a
judge why the boat is missing.

---

## If something goes wrong

| Failure | What to do |
|---|---|
| Agent is rate-limited (429) | It retries and waits out the token window. If it fails, say so and pivot: *"the deterministic assessment above is the part that has to be right, and it's still there"* — then show a completed run from a previous disruption. |
| Agent proposes nothing | Reset, re-run. The loop pins its first and last turns to `propose_replan` precisely because prose records nothing, but a bad generation is still possible. |
| Terminal shows a 400 `tool_use_failed` mentioning `tool_choice` | Already handled — Groq rejects the request when the model reaches for a tool the pin forbids, so the loop lifts the pin and retries. You will see it in the log and nothing on screen. |
| Accepting a plan errors with "cannot be applied" | Working as intended — the plan was incomplete and the itinerary was left untouched rather than half-changed. Accept the other proposal, or re-run the agent. |
| Vela takes 20-30 seconds to answer | Groq's free tier meters 8000 tokens a minute and the loop resends its history, so a burst of questions inside one minute waits out the window once. Say so — *"free tier, metered by the minute"* — and carry on; the panel says the same thing on screen after eleven seconds. A single question from cold is one to two seconds. |
| Vela says she cannot change something | Read the reason out; it is almost always right and it is almost always the point. A locked stop is prepaid, an at-risk stop is one the operator is already re-planning, and anything outside the catalogue does not exist. The validator refuses these before the model gets a say. |
| The copilot answers something you can see is wrong | It reads the board and nothing else. Point at the board — the answer is checkable in a way a chatbot's usually is not, which is the argument for putting it next to the data rather than in front of it. |
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

**"What stops one customer seeing another customer's trip?"**
*Point at Window D.* Same URL as Window B, different person signed in, 404.

Then say where that comes from, because the answer is the interesting part:
nothing in the page checks. `getTrip` takes an id and applies no ownership
filter at all — Postgres row-level security answers with no row, and the page
404s on null. The policy is one line, `traveler_id = auth.uid() or operator_id
= current_operator_id() or coordinator_id = auth.uid()`, and it is the same
predicate the write path asks before it will touch anything.

If Window D is not up, run `npm run test:rls` in the terminal instead: it signs
in as four different people and checks fifteen ways that nobody reads anyone
else's data. Worth mentioning either way that it caught the case reading the
policy could not — `items_via_trip` carries no auth condition of its own and is
safe only because Postgres applies the trip's RLS inside the subquery.

Be straight about the limit if pushed: the writes still run as the service
role, because applying a re-plan has to move availability seats no traveler may
touch. Authorization for those is a guard every mutating action calls, which is
a convention rather than a mechanism, and it is the next thing to harden.

**"Does this work for more than one destination?"**
The schema does — vendors, inventory and availability are generic, and the trip
carries its own dates and preferences. The seed is one region because depth on
the disruption path scores better than breadth nobody demos.

**"Is the chatbot just a wrapper around your form?"**
No, and the difference is the validator. It emits the same four operations the
re-planner emits, into the same table, checked by the same code — invented ids
rejected, locked stops refused, cost recomputed — and applied by the same
function behind a human click. The chat is a second way into one approval path,
not a second approval path.

**"What's missing?"**
One of the five planned agents, and one boundary that is a convention rather
than a mechanism.

The agent that was cut is vendor comms — drafting a message to a supplier and
parsing the reply back into structured availability. The outbound half exists
(`check_vendor` writes to `messages`); nothing reads a reply.

The boundary is write authorization. Reads go through RLS, proven by
`test:rls`. Writes run as the service role, because applying a re-plan moves
availability seats and cancels vendor bookings that no traveler-facing policy
grants — so every mutating server action calls `assertTripAccess` first, which
asks RLS the same question. It holds today; it is a rule someone has to
remember rather than something the database enforces.
