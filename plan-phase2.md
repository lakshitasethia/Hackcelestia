# Waypoint — Phase 2 Build Spec (the actual product)

Product: **Personalized Dynamic Tour Planning & Tour Operations Platform** (HackCelestia PS-7)
`plan.md` covers the Phase 1 landing page and is done. This doc covers everything behind it.

Timeline: ~1 week. Stack per `techstack.md` (Next.js 14 App Router, Supabase, Vercel), agents on the Claude API.

---

## 0. Scope discipline — read this first

PS-7 as written is a full travel ERP. Building all of it means shipping nothing that works. This
spec is deliberately a **thin vertical slice**, deep on one axis:

- **One destination region** (Amalfi Coast — already the hero photography on the landing page)
- **One operator**, three vendors, one hotel, four activities, one transfer provider
- **One tour group** of two travelers, seeded mid-trip so the disruption demo has somewhere to land

Breadth only where it is nearly free (a table with three rows renders the same as one with three
thousand). Depth goes into the disruption path, because that is where the brief actually scores.

**The scoring insight:** every team will ship a trip builder. The brief's differentiator is the
Dynamic Management paragraph — handle changes before or during a tour, *identify impact*, and
re-plan against "cost, availability, timing, location, **dependencies**, and traveler preferences."
That is the hard part and the part the landing page already promises ("8 sec median re-plan",
"98% resolved without a call"). The product must make good on it.

---

## 1. Roles

| Role | Surface | What they do |
|---|---|---|
| **Traveler** | `/plan`, `/trip/[id]` | Set preferences, build and modify an itinerary, compare alternatives, see live costs, approve re-plans |
| **Operator** | `/ops` | Console over customers, bookings, vendors, schedules, groups, payments; sees disruptions and agent activity |
| **Coordinator** | `/field` | Mobile-first. The guide on the ground with the group: today's schedule, confirm/flag a stop, receive re-plans |

The brief lists coordinators under the operator's responsibilities ("tour groups, **coordinators**,
schedules"). Traveler↔operator alone is a booking site; the coordinator is what makes it an
operations platform, and it is where the agent's work becomes visible to a human.

---

## 2. The one decision everything else rests on

**An itinerary is a DAG, not a list.** Every item declares what it depends on:

```
flight_arr ──> airport_transfer ──> hotel_checkin ──> dinner_res
                                          └────────> day2_boat_tour
```

With `depends_on[]` on each item, "identify impact" — the thing the brief explicitly asks for —
is a graph traversal from the broken node. Blast radius, timing conflicts, and cost deltas all
fall out of the same walk. Model it as a flat day-by-day list and you will hand-write special
cases until the deadline.

### Schema (Supabase / Postgres)

```
profiles          id, role(traveler|operator|coordinator), name, email, phone
operators         id, name, contact
vendors           id, operator_id, name, type(hotel|activity|transport|guide), contact, capacity
inventory         id, vendor_id, title, type, duration_min, base_cost, location(geog), open_hours
availability      id, inventory_id, date, slots_total, slots_taken
trips             id, traveler_id, operator_id, status, party_size, budget, start, end, prefs jsonb
itinerary_items   id, trip_id, day, inventory_id, vendor_id, starts_at, ends_at,
                  location(geog), cost, status(planned|confirmed|at_risk|cancelled|replaced),
                  depends_on uuid[],          -- the DAG edge
                  lock_reason text            -- why it cannot be moved (e.g. non-refundable)
bookings          id, trip_id, item_id, vendor_id, state, amount, external_ref
disruptions       id, trip_id, source(weather|transport|vendor|manual), severity,
                  detected_at, root_item_id, payload jsonb
replan_proposals  id, disruption_id, plan jsonb, cost_delta, rationale, state(draft|sent|accepted|rejected)
messages          id, thread_key, from_role, to_role, body, structured jsonb, sent_at
agent_runs        id, trip_id, kind, status, started_at, ended_at, input jsonb
agent_steps       id, run_id, seq, tool_name, tool_input jsonb, tool_output jsonb, ms
```

`agent_runs` / `agent_steps` are not bookkeeping — they are a **judging asset**. Surfacing the
agent's step trace in the UI turns "we used AI" from a claim into something judges can watch.

RLS from day one: travelers see their own trips, operators see their org, coordinators see
assigned groups. Cheap now, painful to retrofit.

---

## 3. The agent layer

Provider: **Claude API**, model `claude-opus-5`, via `@anthropic-ai/sdk`.

**Every call runs server-side** in a Next.js route handler. The API key never reaches the browser.

### Standing conventions

- `thinking: { type: "adaptive" }` — adaptive thinking, no `budget_tokens` (removed on this model)
- `output_config: { effort: "high" }` — the re-planner is intelligence-sensitive; drop to `low`
  for trivial extraction calls
- `max_tokens: 16000` non-streaming; stream anything user-facing and long
- Prompt caching: put the stable system prompt and the deterministic tool list first, volatile
  trip state after the last `cache_control` breakpoint. Verify with `usage.cache_read_input_tokens`
- Tool inputs always parsed with `JSON.parse` — never string-matched

### The five agents, ranked by how much they earn their place

**1. Disruption re-planner — the flagship.** A genuine agent loop: multi-step, tool-using,
depth unknowable in advance. Use the SDK tool runner:

```ts
import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";

const finalMessage = await client.beta.messages.toolRunner({
  model: "claude-opus-5",
  max_tokens: 16000,
  thinking: { type: "adaptive" },
  output_config: { effort: "high" },
  tools: [getBlastRadius, searchAvailability, priceOption, checkVendor, proposeReplan],
  messages: [{ role: "user", content: disruptionBrief }],
});
```

Tools it gets:

| Tool | Does |
|---|---|
| `get_blast_radius` | Traverse `depends_on` from the broken item; return affected items + locks |
| `search_availability` | Query `inventory` × `availability` for substitutes near the gap |
| `price_option` | Cost delta of a candidate swap, including cancellation penalties |
| `check_vendor` | Ask a vendor if they can take the slot (writes to `messages`) |
| `propose_replan` | Write a `replan_proposals` row for human approval |

Mark write tools `strict: true` so inputs validate exactly. **The agent proposes; a human accepts.**
`propose_replan` writes a draft — it does not mutate the live itinerary. That boundary is both
correct engineering and a good thing to say out loud to judges.

**2. Vendor & coordinator comms.** Drafts the message to the boat operator, and parses
"we can do 2pm not 9am" back into structured availability. This is the coordination USP, automated.
Extraction uses structured outputs, not prompt-and-hope:

```ts
const res = await client.messages.parse({
  model: "claude-opus-5",
  max_tokens: 16000,
  output_config: { format: zodOutputFormat(VendorReplySchema) },
  messages: [{ role: "user", content: replyText }],
});
res.parsed_output // null on parse failure — guard it
```

**3. Operator copilot.** Tool-calling over the ops tables. "Which groups are affected by the Kyoto
rain tomorrow?" → real query → real answer. Same tool-runner shape, read-heavy tool set.

**4. Conversational intake.** Prose trip description → structured `trips.prefs`. Cheap, high demo
value, `effort: "low"`.

**5. Itinerary composer.** Candidates + constraints → day plan. **Be honest in the writeup:** a
solver does feasibility (transit time, opening hours, budget), the LLM does preference-ordering
and explains *why*. Do not claim the LLM is doing the optimization — judges who know will notice.

---

## 4. Build order

Each checkpoint leaves something demoable. Never a half-built planner *and* a half-built console.

| Day | Ship | Notes |
|---|---|---|
| **1** | Supabase project, schema, RLS, seed data | The DAG + a realistic seeded mid-trip group. Seed beats building a booking flow. |
| **2** | Traveler planner — prefs → itinerary → live costed plan | Reads/writes the DAG. Proves the core object. |
| **3** | Operator console — groups, bookings, vendors, schedule | Mostly views over the same tables; cheap if day 1 was right. |
| **4** | **Disruption engine (deterministic)** — inject event, traverse graph, render blast radius | No LLM yet. Graph + rules. Must work before agents touch it. |
| **5** | **Agent layer** — re-planner tool runner, vendor comms, copilot, `agent_steps` trace UI | The TCS answer. Day 4 gives it something real to call. |
| **6** | Coordinator view + Supabase Realtime notifications | Closes the coordination loop; the re-plan lands on the guide's phone live. |
| **7** | Demo script, rehearsal, polish, README | Non-negotiable. A rehearsed 3-minute path beats two more features. |

**Deliberate ordering choice:** day 4 before day 5. A deterministic engine that produces correct
blast radii is the thing the agent reasons over. Building the agent first means debugging a model
and a graph traversal simultaneously, and losing.

---

## 5. Demo script (write it day 1, rehearse day 7)

1. Traveler describes a trip in prose → intake agent returns a structured plan → itinerary renders
2. Operator console: the group appears, vendors confirmed, schedule green
3. **Inject the storm.** Amalfi boat tour, tomorrow 09:00
4. Blast radius lights up the DAG — boat, the transfer feeding it, the restaurant depending on it
5. Agent runs. **Trace panel shows every tool call live** — this is the moment that answers "are
   you actually using AI"
6. Two re-plan proposals with cost deltas and rationale. Operator accepts one
7. Coordinator's phone updates in realtime; traveler gets the new plan
8. Total elapsed: the "8 sec" number on the landing page, now real

---

## 6. Risks

| Risk | Mitigation |
|---|---|
| Scope creep back toward "full ERP" | The slice in §0 is fixed. New tables need a reason. |
| Agent latency wrecks the demo | Cache the stable prefix; pre-warm before demoing; have a recorded fallback |
| Real external APIs (weather/flights) flake on stage | Seeded disruption injector is primary; live API is a bonus, behind a flag |
| Day 5 agents built on a broken day 4 graph | Unit-test blast radius on the seeded trip before any LLM call |
| Vercel cold starts on agent routes | Keep route handlers thin; heavy work stays in Supabase |

---

## 7. Out of scope, explicitly

Real payments (mock the state machine), multi-region inventory, operator onboarding/signup flow,
mobile apps, i18n, and anything requiring a vendor to actually install software.
