import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getBookings, getInventory, getItems, getTrip, summarize } from "@/lib/db/queries";
import { CHAT_MODEL, runToolLoop, type ChatMessage } from "./runtime";
import type { StepRecorder } from "./tool";
import { buildConciergeTools, dateOfDay } from "./concierge-tools";
import { TRIP_TZ, formatMoney, formatTime } from "@/lib/format";
import type { ItineraryItem, Trip } from "@/lib/db/types";

/**
 * Vela — the traveler's concierge.
 *
 * The re-planner is the same idea pointed at an operator after something
 * breaks. This one is pointed at the traveler before anything has, and the
 * boundary is identical: it can read the trip and it can write a *draft*, and
 * the only code that changes a live itinerary is `applyProposal`, behind a
 * button someone presses. "Add a wine tasting on day three" and "a storm killed
 * the boat" produce the same kind of object, validated by the same code.
 *
 * What is different is that a person is waiting. Everything below is shaped by
 * that: the whole itinerary and catalogue ride in the opening brief so the
 * common request needs no tool call at all, the loop is capped at three
 * iterations rather than six, and the thread is replayed as plain conversation
 * rather than as a tool transcript.
 */

/** Two turns of tools is plenty when the brief already holds the trip. A third
 *  exists so a rejected proposal can be corrected and still answered. */
const MAX_ITERATIONS = 3;

/**
 * How much of the conversation is replayed. Four is two exchanges — enough for
 * "make it later" to know what "it" is, short enough to stay fast.
 *
 * Everything sent here is sent again on every iteration of the loop, against a
 * budget of 8000 tokens a minute. The brief is worth that; a conversation from
 * five minutes ago is not, and the brief is rebuilt fresh each turn anyway, so
 * nothing about the trip is lost by forgetting the chat around it.
 */
const HISTORY_TURNS = 4;

export const THREAD_PREFIX = "concierge";

export function conciergeThread(tripId: string): string {
  return `${THREAD_PREFIX}:${tripId}`;
}

const SYSTEM = `You are Vela, concierge for a small Amalfi Coast tour operator,
talking to the traveler whose trip it is. Warm, specific, brief — two or three
sentences. Never gush, never pad.

YOU CANNOT CHANGE THE ITINERARY. To change anything you call propose_change,
which writes a draft the traveler accepts with a button. Until they press it
nothing has happened.

So describe what you have SUGGESTED, never what has happened. Write "I've
drafted moving dinner to 19:00" — never "dinner has been moved", "I've moved",
"that's booked", "I've added" or "done". The passive voice is the trap: if a
sentence could be read as the change already being live, rewrite it.

Rules:
- The brief has their whole itinerary and everything bookable. Answer questions
  straight from it, with no tool call.
- For a change, go straight to propose_change. Search the catalogue first only
  if you need to know seats are free.
- Times: give local_time ("15:00") and the trip day. Never compute UTC. If they
  name a part of the day, honour it — afternoon means afternoon.
- Use only ids from the brief or a tool result. Never invent one, and never show
  an id to the traveler; use the name of the stop.
- A LOCKED stop is prepaid and non-refundable. It cannot be dropped or swapped.
  Say why instead of proposing it.
- A stop marked at_risk is one the office is already re-planning. Do not touch
  it — say the operator is dealing with it and will confirm shortly.
- Dependencies are real: if a stop they want moved is needed by another, say
  what would break.
- If they ask for something not in the catalogue, say so and offer the nearest
  thing that is.
- One request, one proposal. Two asks go in one plan.

After propose_change succeeds, use this shape: "I've drafted <the change> —
<what it costs, from the figure the tool returned>. It's waiting for you."`;

export interface ConciergeReply {
  runId: string;
  /** What Vela said. */
  text: string;
  /** The draft she wrote, if she wrote one. */
  proposalId: string | null;
  toolCalls: number;
  ms: number;
}

export async function askConcierge(
  tripId: string,
  question: string
): Promise<ConciergeReply> {
  const started = Date.now();
  const supabase = createAdminClient();

  const trip = await getTrip(tripId);
  if (!trip) throw new Error("askConcierge: no such trip");

  const asked = question.trim();
  if (!asked) throw new Error("askConcierge: nothing was asked");

  const [items, bookings, inventory, history] = await Promise.all([
    getItems(tripId),
    getBookings(tripId),
    getInventory(),
    recentTurns(tripId),
  ]);

  // Recorded before the model runs, so a request that fails mid-flight still
  // shows in the thread as something the traveler said.
  await supabase.from("messages").insert({
    trip_id: tripId,
    thread_key: conciergeThread(tripId),
    direction: "inbound",
    from_role: "traveler",
    body: asked,
  });

  const { data: run, error: runError } = await supabase
    .from("agent_runs")
    .insert({
      trip_id: tripId,
      kind: "concierge",
      status: "running",
      input: { question: asked, model: CHAT_MODEL },
    })
    .select("id")
    .single();

  if (runError) throw new Error(`agent run: ${runError.message}`);
  const runId = (run as { id: string }).id;

  let seq = 0;
  let proposalId: string | null = null;

  const record: StepRecorder = async (step) => {
    // The proposal id is read off the trace rather than re-queried: the tool
    // just returned it, and a "newest draft for this trip" query would race a
    // second tab.
    if (step.tool === "propose_change") {
      const out = step.output as { proposal_id?: string } | null;
      if (out?.proposal_id) proposalId = out.proposal_id;
    }

    await supabase.from("agent_steps").insert({
      run_id: runId,
      seq: seq++,
      tool_name: step.tool,
      tool_input: step.input as never,
      tool_output: step.output as never,
      ms: step.ms,
    });
  };

  try {
    const messages: ChatMessage[] = [
      { role: "system", content: SYSTEM },
      { role: "user", content: briefFor(trip, items, bookings, inventory) },
      ...history,
      { role: "user", content: asked },
    ];

    const { text, toolCalls, inputTokens, outputTokens } = await runToolLoop({
      model: CHAT_MODEL,
      messages,
      tools: buildConciergeTools(trip, record),
      maxIterations: MAX_ITERATIONS,
      // Chat is cheap per turn and the history is already short, so the whole
      // exchange survives; the brief and the system prompt are what must not be
      // cut, and they are the preserved pair.
      keepRecent: 12,
      temperature: 0.5,
      maxTokens: 1500,
      reasoningEffort: "low",
    });

    // A proposal written with nothing said about it is worse than useless — the
    // card appears with no explanation. Prefer Vela's own words, fall back to
    // the summary she wrote into the draft.
    const reply = text || (await fallbackText(supabase, proposalId));

    await supabase.from("messages").insert({
      trip_id: tripId,
      thread_key: conciergeThread(tripId),
      direction: "outbound",
      from_role: "agent",
      body: reply,
      structured: proposalId ? { proposal_id: proposalId } : null,
    });

    await supabase
      .from("agent_runs")
      .update({
        status: "succeeded",
        output: { text: reply, proposal_id: proposalId, model: CHAT_MODEL },
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        ended_at: new Date().toISOString(),
      })
      .eq("id", runId);

    return { runId, text: reply, proposalId, toolCalls, ms: Date.now() - started };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    await supabase
      .from("agent_runs")
      .update({ status: "failed", error: message, ended_at: new Date().toISOString() })
      .eq("id", runId);

    // The traveler gets a sentence, not a stack trace, and it is written into
    // the thread so a reload does not lose the fact that they asked.
    const apology =
      message.includes("GROQ_API_KEY")
        ? "I can't reach my planning tools right now — the office has been told."
        : "Something went wrong on my side and I couldn't work that out. Try me again in a moment?";

    await supabase.from("messages").insert({
      trip_id: tripId,
      thread_key: conciergeThread(tripId),
      direction: "outbound",
      from_role: "agent",
      body: apology,
      structured: { failed: true, error: message },
    });

    return { runId, text: apology, proposalId: null, toolCalls: 0, ms: Date.now() - started };
  }
}

async function fallbackText(
  supabase: ReturnType<typeof createAdminClient>,
  proposalId: string | null
): Promise<string> {
  if (!proposalId) {
    return "I'm not sure how to help with that one — could you say it another way?";
  }
  const { data } = await supabase
    .from("replan_proposals")
    .select("rationale")
    .eq("id", proposalId)
    .maybeSingle();

  const rationale = (data as { rationale: string | null } | null)?.rationale ?? "";
  return (
    rationale.split("\n\n").join(" ").trim() ||
    "Here's what I'd suggest — have a look and tell me if it works."
  );
}

/** The tail of the thread, as plain conversation. Tool calls are deliberately
 *  left out: replaying them would cost tokens to re-establish a state the brief
 *  already describes, and describes more accurately after a change lands. */
async function recentTurns(tripId: string): Promise<ChatMessage[]> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("messages")
    .select("from_role, body")
    .eq("thread_key", conciergeThread(tripId))
    .order("sent_at", { ascending: false })
    .limit(HISTORY_TURNS);

  const rows = ((data ?? []) as { from_role: string; body: string }[]).reverse();
  return rows.map((row) => ({
    role: row.from_role === "traveler" ? ("user" as const) : ("assistant" as const),
    content: row.body,
  }));
}

/**
 * Everything Vela needs, up front.
 *
 * The re-planner's brief exists to stop it re-deriving a deterministic
 * assessment. This one exists for latency: an itinerary of fifteen stops and a
 * catalogue of eighteen options is a few hundred tokens, and sending them costs
 * far less than the two extra round trips it takes to fetch them. Most requests
 * therefore need exactly one inference call and one tool call.
 */
function briefFor(
  trip: Trip,
  items: ItineraryItem[],
  bookings: Awaited<ReturnType<typeof getBookings>>,
  inventory: Awaited<ReturnType<typeof getInventory>>
): string {
  const live = items.filter(
    (i) => i.status !== "cancelled" && i.status !== "replaced"
  );
  const titleById = new Map(items.map((i) => [i.id, i.title]));
  const { total, penaltyIfCancelled } = summarize(items, bookings);

  const today = new Date().toLocaleDateString("en-CA", { timeZone: TRIP_TZ });
  const dayNumber = trip.starts_on
    ? Math.floor(
        (new Date(`${today}T00:00:00Z`).getTime() -
          new Date(`${trip.starts_on}T00:00:00Z`).getTime()) /
          86_400_000
      ) + 1
    : null;

  const lines: string[] = [];

  lines.push(`TRIP: ${trip.title}`);
  lines.push(
    `${trip.party_size} traveller(s) · ${trip.starts_on} to ${trip.ends_on}` +
      (trip.budget ? ` · budget ${formatMoney(Number(trip.budget), trip.currency)}` : "")
  );
  lines.push(
    `Today is ${today}` +
      (dayNumber && dayNumber >= 1 ? ` — day ${dayNumber} of the trip.` : ".") +
      ` All times are local (${TRIP_TZ}).`
  );

  const prefs = [
    trip.prefs.pace && `${trip.prefs.pace} pace`,
    trip.prefs.style,
    ...(trip.prefs.interests ?? []),
    ...(trip.prefs.dietary ?? []),
    trip.prefs.mobility,
  ].filter(Boolean);
  if (prefs.length) lines.push(`They like: ${prefs.join(", ")}.`);

  lines.push("");
  lines.push("ITINERARY:");
  for (const item of live) {
    const needs = item.depends_on
      .map((id) => titleById.get(id))
      .filter(Boolean)
      .join(", ");
    lines.push(
      `- [${item.id}] day ${item.day} · ${formatTime(item.starts_at)} · ` +
        `${item.title} · ${formatMoney(Number(item.cost), trip.currency)} · ${item.status}` +
        (needs ? ` · needs: ${needs}` : "") +
        (item.lock_reason ? ` · LOCKED: ${item.lock_reason}` : "")
    );
  }

  const onTrip = new Set(
    live.map((i) => i.inventory_id).filter((id): id is string => Boolean(id))
  );
  const spare = inventory.filter((option) => !onTrip.has(option.id));

  if (spare.length) {
    lines.push("");
    lines.push("BOOKABLE, not yet on the itinerary:");
    for (const option of spare) {
      lines.push(
        `- [${option.id}] ${option.title} · ${option.type} · ` +
          `${formatMoney(Number(option.base_cost), trip.currency)} · ${option.duration_min}min` +
          ((option.tags ?? []).length ? ` · ${(option.tags ?? []).join(",")}` : "")
      );
    }
    lines.push("No seat counts here — call search_catalogue if availability matters.");
  }

  lines.push("");
  lines.push(
    `Booked: ${formatMoney(total, trip.currency)}. Non-refundable today: ` +
      `${formatMoney(penaltyIfCancelled, trip.currency)}.` +
      (trip.starts_on ? ` Day 1 is ${dateOfDay(trip.starts_on, 1)}.` : "")
  );

  return lines.join("\n");
}
