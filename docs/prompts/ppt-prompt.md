# Voyage — master prompt for rebuilding the HackCelestial 3.0 deck

**How to use this file:** paste the whole thing into a fresh Claude chat, attach
`Voyage_HackCelestial3.0_CheeseLayers (1).pptx`, and say *"rebuild this deck
exactly to this spec."* Everything below is final copy — it is meant to be
placed, not rewritten.

---

## PART 0 — WHAT THIS DECK HAS TO DO

Seven slides. The slide **titles are fixed by the HackCelestial template** and
must not be renamed. The job is a shortlist, not a defence: a judge skimming at
20 seconds a slide has to come away with one sentence — *"they model an itinerary
as a dependency graph, so they can compute what a disruption costs instead of
guessing."*

Every slide is built to deliver that one idea from a different angle. If a
sentence does not serve it, cut the sentence.

**Three things in the current deck are factually stale and must be corrected:**

1. **Slide 1's abstract describes the wrong demo.** It says *"a skipper calls:
   the swell is too high… four other bookings depend on that boat."* The product
   moved to north India and rupees. It is now a **river guide on the Ganga at
   Rishikesh**, and the money is in **₹**. Replacement copy is in Part 2.
2. **Slide 5 says "four agents." There are six.** Intake, Composer, Re-planner,
   Concierge (Vela), Operator copilot, Research — plus a seventh, vendor-reply,
   that parses a supplier's reply back into a proposed change.
3. **Slide 6 says the vendor-communication agent was "scoped and cut."** It was
   built after that slide was written (`src/lib/agent/vendor-reply.ts`). Move it
   out of the "didn't build" list and into the agent roster.

---

## PART 1 — DESIGN SYSTEM (do not deviate)

**Canvas:** 16:9, 10in × 5.625in (9144000 × 5143500 EMU). Every slide fills it.

**Palette** — lifted from the existing deck, keep it exactly:

| Role | Hex | Where |
|---|---|---|
| Ink / primary | `#2E395E` | Headings, dark panels, node fills |
| Ink secondary | `#3A4876` | Body text on light, secondary panels |
| Muted | `#7B8AB8` | Labels, captions, edge lines |
| Faint | `#9AA3B2` | Footnotes, table rules |
| Wash light | `#EFF2FB` | Card backgrounds |
| Wash mid | `#D9DFF0` | Panel fills, table header bands |
| Accent — alarm | `#8C3D1D` | Disruption, blast radius, "at risk" |
| Accent — alarm bright | `#C7511F` | The single hottest element on a slide |
| Accent wash | `#FDECE3` | Behind alarm content |
| Accent tint | `#E8A987` | Alarm borders |
| Accent — safe | `#1E8F82` | Confirmed, verified, "human approved" |
| Paper | `#FFFFFF` | Slide ground |

**Rule of one hot thing.** `#C7511F` appears once per slide, on the element you
want looked at first. Everywhere else uses `#8C3D1D`.

**Type:**
- Headings + body: **DM Sans** (Medium for emphasis, not Bold)
- Display accents: **Kodchasan** (slide 1 wordmark only)
- Code, table names, function names, route paths: **Consolas**, `#3A4876`, at
  0.85× the surrounding size
- Slide title 24pt · section label 10pt letterspaced +8% uppercase · body 11pt ·
  caption 9pt · diagram labels 8–9pt. **Nothing below 8pt.**

**Layout grid:** 12-column, 0.45in outer margin, 0.14in gutter. Cards get 8px
radius, 1px `#D9DFF0` border, no drop shadow, no gradient, no glassmorphism.

**Diagram style:** flat vector. Rounded rectangles, 1.5pt strokes, orthogonal
connectors with small arrowheads. Dashed lines mean *"a signal, not data."* Red
dashed lines mean *"this boundary cannot be crossed."* No 3D, no isometric, no
stock icons, no clipart.

**Voice:** declarative and specific. Numbers over adjectives. Never "seamlessly,"
"revolutionary," "cutting-edge," "leverage," "empower." Say what the thing does.

---

## PART 2 — SLIDE BY SLIDE

---

### SLIDE 1 — Identification / Focus Area / Pitch Summary

*Template slide. Keep the three numbered blocks.*

**Header band:** `HackCelestial 3.0` · `Mahatma Education Society's — PILLAI
UNIVERSITY`

**01. Identification**
> Team Name: **CheeseLayers**

**02. Focus Area**
> Problem Statement Title: **Personalized Dynamic Tour Planning and Tour
> Operations (PS-7)**

**03. Pitch Summary — Abstract (100 words)** — REPLACE the existing text with:

> At 07:40 on the fifth morning a river guide calls from Rishikesh: the Ganga is
> running too high to put in, and four other bookings quietly depend on that
> raft. Voyage models an itinerary as a dependency graph rather than a list, so
> every stop declares what it cannot happen without. A deterministic engine walks
> that graph and computes exactly what the break costs — which stops die, how
> much money is exposed, how much of it is non-refundable, and which replacements
> actually survive the cause. Agents then draft two or three recovery plans that
> a human approves before anything is booked. Traveler, operator and field
> coordinator watch the same trip update live.

*(97 words.)*

**Layout:** left third is a full-bleed `#2E395E` panel carrying the **Voyage**
wordmark in Kodchasan, reversed white, with a hairline DAG motif behind it at 12%
opacity — six nodes, five edges, one node struck through. Right two-thirds is
white, the three numbered blocks stacked, each with its number in `#C7511F`
Kodchasan at 32pt against a `#EFF2FB` chip.

---

### SLIDE 2 — Proposed Solution

**Title:** Proposed Solution
**Deck line:** *One trip. Three screens. Touch it anywhere and the other two
update before you can hit refresh.*

**Block A — THREE SYNCED VIEWS** (three equal cards)

| | | |
|---|---|---|
| **Traveler**<br>`/plan · /trip/[id]` | **Operator**<br>`/ops · /ops/disruption/[id]` | **Field Coordinator**<br>`/field/[id]` |
| Builds an itinerary from real inventory, compares any stop against every alternative in town, sees the same blast radius the operator sees, and talks to Vela — a concierge who can draft a change but cannot book one. | Every group, vendor and movement on a 72-hour board. Money outstanding, reviews worst-first, and every open disruption waiting on one click. | Today and tomorrow on a phone. Confirm a stop or flag it with a cause. Plain forms, built for one hand and two bars of signal. |

**Block B — THE DISRUPTION PATH, END TO END** (six numbered steps, horizontal)

1. **Inject** — a seeded scenario, or a coordinator flags a stop from the field.
2. **Assess** — one graph traversal returns blast radius, exposure, and cause-aware substitutes.
3. **Propose** — the agent writes two or three genuinely different recovery plans.
4. **Trace** — every tool call rendered with arguments, results and timings.
5. **Approve & apply** — rewires edges, cancels bookings, books substitutes, moves inventory seats, atomically.
6. **Sync** — the traveler's tab and the coordinator's phone update in place.

**Footer strip, `#FDECE3`, one line:**
> The same four operations — `drop` · `move` · `replace` · `add` — carry a storm
> and a traveler's whim. One validator, one write path, one approval.

**Diagram on this slide:** DIAGRAM A (see Part 3). Place it right of the three
cards if it fits; otherwise it moves to slide 3 and slide 2 stays type-only.

---

### SLIDE 3 — Flow Chart / Architecture

**Title:** Flow Chart / Architecture

Two labelled diagrams, side by side, no body copy. Left: **SYSTEM ARCHITECTURE**
(DIAGRAM B). Right: **DISRUPTION WORKFLOW** (DIAGRAM C). Full specs in Part 3.

One caption line under both, 9pt `#7B8AB8`:
> The agent layer never touches the database. `applyProposal` is the only code in
> the system that changes a live itinerary, and a person presses it.

---

### SLIDE 4 — Innovation and Unique Functionality

**Title:** Innovation and Unique Functionality

Two columns of five. Left column header **INNOVATION & UNIQUENESS**, right column
header **HOW IT ADDRESSES THE PROBLEM**. Rows align across.

**Left — INNOVATION & UNIQUENESS**

1. **The itinerary is a graph, not a list** — prerequisites are real Postgres edges (`itinerary_items.depends_on uuid[]`), so impact is a traversal, not guesswork.
2. **The model doesn't optimize — the code does** — availability, transit, penalties and cost deltas are solved before the model sees anything. Measured: it was out by ₹670 on its own arithmetic, which is why nothing takes its word.
3. **Substitutes have to survive the cause** — a storm rules out anything `weather_sensitive`, so a rained-off river trip is never replaced with another thing the rain also stopped.
4. **One approval boundary for every agent** — six agents, one validator, one human click, no exceptions.
5. **Multi-tenancy enforced by the database** — RLS decides, not the page. Signed in as the wrong account, the trip's own URL is a 404.

**Right — HOW IT ADDRESSES THE PROBLEM**

1. **Manual impact assessment** — one traversal replaces phoning every vendor to ask what's affected.
2. **Blind trust in AI arithmetic** — every number shown to a human is recomputed server-side first.
3. **Naive replacement** — the substitute that fails for the same reason as the original is the classic bad fix; the cause filter makes it impossible.
4. **Fear of runaway automation** — nothing books itself. Every write waits behind one visible approval.
5. **Cross-account data leaks** — access control lives in Postgres, not in application code that can have bugs.

**Diagram on this slide:** DIAGRAM D (the approval funnel), placed as a narrow
band across the bottom third — six agents converging into one validator, one
gate, one writer.

---

### SLIDE 5 — Technical Details

**Title:** Technical Details

**STACK** (logo/chip row): Next.js 14 (App Router) · TypeScript · Supabase
(Postgres · Auth · RLS · Realtime) · Groq · Tailwind · Vercel

**ARCHITECTURE NOTES**
- No REST layer for mutations — server actions write and revalidate in one step.
- Realtime over **Broadcast**, not Postgres Changes — the nudge carries no itinerary data, so no row is ever exposed to a subscriber that RLS wouldn't grant.
- Supabase Auth (email + Google), middleware-guarded routes, three RLS-backed roles.
- Provider failover chain — Groq → Mistral → Gemini — so a spent free tier degrades instead of ending the run.

**THE SIX AGENTS** *(this replaces the current "four")*
- **Re-planner** — the real one. Five tools (`get_blast_radius`, `search_availability`, `price_option`, `check_vendor`, `propose_replan`), depth decided at runtime, full trace persisted to `agent_steps`. Measured: 3 calls, 3 proposals, 50.1s.
- **Concierge (Vela)** — same loop, traveler-facing tools (`search_catalogue`, `propose_change`), writes drafts only.
- **Operator copilot** — same loop, every tool read-only. It has no way to write anything anywhere.
- **Intake** — one structured call, prose to a trip spec. No loop; calling it an agent would be generous.
- **Research** — when a traveler asks for a town nobody seeded, two narrow web passes build catalogue rows instead of answering "not in the catalogue."
- **Vendor reply** — parses *"sorry, 9 is gone, we could do 2pm"* into a `move` op that goes through the same validator and the same button.

**COMPOSITION IS A SOLVER, NOT A GENERATION** *(new block — this is a strength,
say it out loud)*
> Routing is breadth-first search over a leg graph read from the catalogue; day
> allocation is arithmetic; every rupee is summed from real rows. A model asked
> to order six Himalayan towns will send you Amritsar → Chopta → Manali, because
> it has no way to feel two days of driving.

**TESTING**
> 24 schema/seed invariants · 15 row-level-security checks across 4 identities ·
> 12 re-planner tool checks that cost no model tokens — plus suites for the
> deterministic engine, the write path, lodging preferences, the eleven-stage
> lifecycle, a full end-to-end trip build/delete, realtime delivery and provider
> failover.
>
> **Caught a real bug:** a stop added with no declared prerequisite is an orphan
> in the graph, so every later blast radius comes out silently smaller. The
> manual builder chained new stops; the agent path did not. `verify.sql` now
> asserts no itinerary has two roots.

**COST**
> Free tier throughout — Supabase, Groq, Vercel. Demo cost effectively ₹0. The
> real constraint is 200,000 tokens/day on Groq's free tier, per organization;
> sustained use needs a paid plan.

**SCALE, in one line, `#7B8AB8` 9pt:**
> ~22,000 lines of TypeScript · 14 migrations · 17 tables · 8-town north-India
> catalogue · 9 vendors.

---

### SLIDE 6 — Existing Solutions and Comparison

**Title:** Existing Solutions and Comparison

Keep the comparison matrix. Columns: *Consumer planners* · *Operator platforms* ·
*LLM trip planners* · **Voyage** (highlighted column, `#EFF2FB` fill, `#C7511F`
header).

| | Consumer planners | Operator platforms | LLM trip planners | **Voyage** |
|---|---|---|---|---|
| Itinerary model | List | List (bookings) | List (prompt) | **Graph (DAG)** |
| Disruption cost | ✗ | Manual — phone calls | ✗ | **Automatic, deterministic** |
| Real inventory | ✗ | ✓ | ✗ | **Yes — own database** |
| Recovery options | ✗ | ✗ | ✗ | **Yes — human approves** |
| Shared live view | ✗ | ✗ | ✗ | **Yes — 3 roles** |
| Data separation | ✗ | App-level | ✗ | **Database (RLS)** |

**Positioning line, below the table:**
> Voyage doesn't replace a booking platform's breadth — supplier integrations,
> card payments and multi-region inventory are out of scope. It does the one
> thing none of these three categories do: model dependencies, and recover from a
> break with a human in the loop.

**WHAT WE DELIBERATELY DIDN'T BUILD** *(revised — vendor comms moves out)*
> Payments are a ledger and a state machine, not a processor — `bookings.state`
> moves held → confirmed → cancelled with real penalties the re-planner prices
> against, and `payments` records what an operator says was received. **No card
> is charged anywhere in this codebase**, on purpose: a fake checkout would have
> been the worse version of this. · Inventory is reserved in our own database,
> not brokered to supplier systems. · Weather is seeded, not live — an API that
> flakes on stage is a liability. · Reviews are ratings, not a reputation system.

---

### SLIDE 7 — Supplementary Information

**Title:** Supplementary Information (Optional)

Three link cards, as now:

**Demo Video** — Walkthrough of Voyage handling a live disruption end to end.
✓ Blast radius computed live, on camera · ✓ Recovery plan proposed, then approved

**Live Deployed Site** — The running prototype: plan a trip, then break it.
✓ Build an itinerary from real inventory · ✓ Watch all three roles sync in real time

**Source Code** — Full stack: Next.js app, agent tools, seed data.
✓ Every server action and agent tool · ✓ Seed data to reproduce this exact demo

**ADD a fourth block — WHERE THIS GOES NEXT** *(this is an ideathon; the vision
is scored, and an honest roadmap reads stronger than a padded feature list)*

> **Payments** — the ledger already models what is owed, held and refundable.
> A processor drops in behind it without touching the itinerary graph.
> **Supplier integrations** — `check_vendor` and the reply parser are the two
> ends of a channel; a real supplier API replaces the middle.
> **Corridors beyond north India** — routing is now a query over the catalogue,
> so a new region is an INSERT, not a deploy.
> **Predictive disruption** — the graph already knows what is downstream of what;
> the next step is flagging exposure before the guide calls.

**Footnote:** Links go live after deployment — placeholders shown above.

---

## PART 3 — DIAGRAM SPECIFICATIONS

Draw these as native PowerPoint shapes wherever possible so text stays crisp.

---

### DIAGRAM A — "A list can't tell you what breaks"

Two panels, equal width, divider hairline between.

**LEFT — "Modelled as a list"** (grey, `#9AA3B2` strokes, `#EFF2FB` fills)
Six stacked chips: `Hotel` · `Shuttle` · `Rafting` · `Riverside lunch` · `Yoga`
· `Ganga aarti`. Strike through `Rafting` with a grey X.
Caption: **"One stop is gone. Nothing else knows."**

**RIGHT — "Modelled as a graph"** (full colour)
A DAG, left to right:

```
                   ┌──────────────┐
                   │ Hotel  🔒    │  4 nights prepaid, non-refundable
                   │ Day 1–4      │
                   └──┬────────┬──┘
                      │        └───────────────┐
                      ▼                        ▼
              ┌───────────────┐        ┌─────────────────┐
              │ Shuttle to    │        │ Cab to Chopta   │  ← stays green
              │ Tapovan       │        │ Day 5           │
              └───────┬───────┘        └─────────────────┘
                      ▼
              ┌───────────────┐
              │ RAFTING 09:00 │  ✕  cause: WEATHER
              └───────┬───────┘
                      ▼
              ┌───────────────┐
              │ Riverside     │  depth 1
              │ lunch         │
              └───────┬───────┘
                      ▼
              ┌───────────────┐
              │ Yoga, ashram  │  depth 2
              └───────┬───────┘
                      ▼
              ┌───────────────┐
              │ Ganga aarti   │  depth 3
              └───────────────┘
```

Colour rules: the struck node gets `#C7511F` stroke + `#FDECE3` fill and a bold
✕. The three downstream nodes get `#8C3D1D` stroke on `#FDECE3`. `Hotel` and
`Cab to Chopta` stay `#2E395E` on `#EFF2FB` — **this contrast is the entire
point of the diagram**, so leave whitespace around the Chopta branch.
Small padlock glyph on `Hotel`.

**Result strip beneath, `#2E395E` band, reversed white:**
> **4 items affected · ₹2,050 exposed · ₹300 non-refundable · max depth 3**
> The hotel is not in there. Nothing flows backwards.

Caption: **"Kill the rafting and the lunch, the yoga and the aarti go with it.
An afternoon of rain costs an afternoon, not the back half of a holiday."**

---

### DIAGRAM B — System architecture

Five horizontal bands, top to bottom, plus two side rails.

**Band 1 — CLIENTS** (three boxes)
`Traveler /trip/[id]` · `Operator /ops` · `Coordinator /field/[id]` *(draw this
one narrow, phone-shaped)*

**Band 2 — NEXT.JS 14 APP ROUTER** (one wide box, `#D9DFF0`)
Split internally: `Server Components — reads` | `Server Actions — writes`
Tag beneath: *no REST layer for mutations*

**Band 3 — split into two columns, and the split is the message**

*Left column, `#EFF2FB`, solid border — **DETERMINISTIC CORE***
- `blast_radius()` — SQL graph traversal
- `disruption/engine.ts` — exposure, non-refundable, cause-aware candidates
- `agent/plan.ts · validateOps` — the shared validator
- `trip/stage.ts` — the 11-stage lifecycle
- **`applyProposal()` — the only code that writes a live itinerary**

*Right column, `#FDECE3`, **red dashed border** — **AGENT LAYER***
- Intake · Composer (solver) · Re-planner · Vela · Copilot · Research · Vendor-reply

Label along the dashed border, `#C7511F`, small caps:
**PROPOSES ONLY — CANNOT WRITE**

**Band 4 — THE GATE.** A full-width bar, `#1E8F82` fill, reversed white, with a
single cursor/click glyph:
**HUMAN APPROVES ▸** — *the only arrow that crosses from the agent column into
`applyProposal`*

Draw exactly one arrow from the agent column, down through this bar, into
`applyProposal`. Every other route into the core is blocked — show the block with
a small ⃠ where a direct agent→database arrow would otherwise go.

**Band 5 — SUPABASE POSTGRES** (`#2E395E`, reversed)
`trips` · `itinerary_items (depends_on uuid[])` · `bookings` · `availability` ·
`disruptions` · `replan_proposals` · `agent_runs / agent_steps` · `payments` ·
`reviews` · `messages`
Two badges on this band: 🛡 **RLS on every read** · 🔑 **service role on writes,
guarded by `assertTripAccess`**

**Right rail** — `Groq gpt-oss-120b (re-plan) / 20b (chat)` with a small failover
chain beneath: `→ Mistral → Gemini`. Connect to the agent column only.

**Left rail** — `Supabase Realtime — Broadcast`. A **dashed** arrow from the
database band up to all three clients, labelled:
*"a nudge, not the data — each client re-fetches under its own permissions"*

---

### DIAGRAM C — Disruption workflow

A horizontal swimlane, six columns, four role rows. Numbered circles in
`#C7511F`; step 5 is the visual peak.

| Lane | Step |
|---|---|
| **FIELD** | ① **Flag** — guide taps a stop, types one sentence, picks a cause: `WEATHER` |
| **SERVER** | ② **Assess** — traversal returns `4 items · ₹2,050 · ₹300 NR · depth 3`, candidates filtered by cause |
| **AGENT** | ③ **Propose** — 5 tools, runtime-decided depth → 2–3 plans · ④ **Trace** — every call, its arguments, its result, its timing |
| **HUMAN** | ⑤ **APPROVE** — one button. Nothing before this changed anything. |
| **SERVER** | ⑥ **Apply, atomically** — rewire `depends_on` edges · cancel bookings behind dropped stops · book substitutes · move `availability.slots_taken` · mark losing options superseded |
| **ALL** | ⑦ **Broadcast** — traveler's tab and guide's phone update in place, no refresh |

Draw a **vertical dashed red line between ④ and ⑤** running the full height of
the diagram, labelled down its length: **NOTHING IS WRITTEN LEFT OF THIS LINE.**

Cause-aware substitution gets a small callout hanging off step ②:
> `cause = weather` ⇒ every `weather_sensitive` candidate is excluded.
> An ashram, a yoga hall, a massage room — never another thing the rain stopped.

Timing chip at the far right: **measured end to end — 50.1s of agent time, one
click.**

---

### DIAGRAM D — The approval funnel (slide 4)

A wide, shallow funnel. Left: six small chips in a vertical stack — Intake,
Composer, Re-planner, Vela, Copilot, Research/Vendor-reply. They all converge
into:

`validateOps()` — *ids checked · locked stops protected · cost delta recomputed*

which narrows into a single `#1E8F82` gate — **one human click** — which opens
into one arrow labelled `applyProposal()` → the database.

Caption beneath, `#7B8AB8` 9pt:
> The worst thing a bad generation can do is put a bad suggestion in front of
> someone who declines it.

---

## PART 4 — FACT SHEET (numbers a judge may ask you to justify)

Every figure below is drawn from the codebase. Do not invent others.

- **Blast radius on the demo trip:** 4 items · ₹2,050 exposed · ₹300 non-refundable · max depth 3
- **Re-planner, measured:** 5 tools · 3 calls · 3 proposals · 50.1s (55–240s range on the free tier)
- **Model arithmetic error caught in testing:** ₹670 — the reason `validateOps` recomputes every delta
- **Groq free tier:** 200,000 tokens/day and 8,000 tokens/min, **per organization, not per key**
- **Models:** `gpt-oss-120b` for the re-planner, `gpt-oss-20b` for chat — split so a judge typing at Vela can't slow the re-plan
- **Demo trip:** 2 travelers · 8 days · Delhi → Auli · ₹35,000
- **Corridor:** Delhi · Amritsar · Chandigarh · Manali · Haridwar · Rishikesh · Chopta · Auli
- **Catalogue:** 9 vendors, ~21 bookable items, 3 lodging tiers per town
- **Codebase:** ~22,000 lines TS/TSX · 14 migrations · 17 tables
- **Lifecycle:** 11 stages — Discover → Personalize → Plan → Price → Book → Prepare → Operate → Assist → Adapt → Complete → Review
- **Roles:** traveler · operator · coordinator, all three RLS-enforced

**The two lines that win a Q&A:**
> *"The model does preference-ordering and explanation. It does not do the
> optimization — availability, transit, penalties and cost are all solved in code
> before it sees anything."*

> *"The agent proposes; a human accepts. There is exactly one function in the
> codebase that changes a live itinerary, and it sits behind a button."*

---

## PART 5 — INSTRUCTIONS TO THE MODEL BUILDING THE DECK

- Keep all seven template slide titles verbatim. Do not add or remove slides.
- Use the copy in Part 2 as final text. Tighten only if a box overflows; never
  pad to fill space.
- Build DIAGRAM A, B, C and D as native shapes. They are the reason this deck
  gets shortlisted — budget the most effort there.
- Diagram A is the single most important object in the deck. If only one diagram
  can be excellent, make it that one.
- Respect the rule of one hot thing: `#C7511F` once per slide.
- No stock photography, no icons that aren't geometric, no gradients, no
  drop shadows, no 3D.
- Every route path, table name and function name in Consolas.
- Leave real whitespace. A judge reading five decks in ten minutes will forgive
  an empty half-inch and will not forgive a wall of 9pt text.
