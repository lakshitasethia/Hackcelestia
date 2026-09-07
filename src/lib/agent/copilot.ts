import "server-only";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getAllOpenDisruptions,
  getOperatorTrips,
  getSchedule,
  getVendors,
  operatorTotals,
} from "@/lib/db/queries";
import { CHAT_MODEL, runToolLoop, type ChatMessage } from "./runtime";
import { defineTool, traced, type StepRecorder } from "./tool";
import { formatDate, formatMoney, formatTime, now } from "@/lib/format";
import type { ThreadMessage } from "./thread-types";

/**
 * The operator's copilot.
 *
 * "Which groups are affected by the rain tomorrow?" is a question an operator
 * answers today by opening four screens. It is also a question the schedule
 * already contains the answer to, which is the whole argument for this: not
 * that a model knows anything about the business, but that it can turn a
 * sentence into the query somebody would otherwise write by hand.
 *
 * Every tool here is read-only, and that is a property of the tool set rather
 * than of the prompt. The copilot has no way to write to a booking, a trip or a
 * proposal, so the worst outcome is a wrong answer on a screen that also shows
 * the underlying board. Changing anything is still the re-planner's job, behind
 * the accept flow.
 */

const MAX_ITERATIONS = 3;
const HISTORY_TURNS = 4;

/** No sign-in, so no operator to key the thread to; there is exactly one. */
export const COPILOT_THREAD = "copilot:console";

const SYSTEM = `You are the operations copilot for a small Amalfi Coast tour operator,
talking to the operator at their console.

Answer like a good dispatcher: short, specific, and led by the number or the
name they need. Two or three sentences. Never pad, never apologise.

You can only READ. You cannot change a booking, a trip or an itinerary, and you
must never imply otherwise. If they want something changed, tell them which
screen does it — a disruption is re-planned from its own page, and a traveler's
itinerary is edited from the trip page.

- The brief has today's board. Answer from it without a tool call when you can.
- The schedule in the brief covers 72 hours only. For anything beyond it, or
  any "when is X", call search_schedule rather than inferring from what you see.
- Use list_vendors when you need a supplier's phone number.
- Name groups and vendors, never ids. Give times as local clock times.
- If the data does not answer the question, say exactly what is missing.`;

export async function askCopilot(question: string): Promise<{
  runId: string;
  text: string;
  toolCalls: number;
  ms: number;
}> {
  const started = Date.now();
  const supabase = createAdminClient();

  const asked = question.trim();
  if (!asked) throw new Error("askCopilot: nothing was asked");

  const [brief, history] = await Promise.all([briefForConsole(), recentTurns()]);

  await supabase.from("messages").insert({
    thread_key: COPILOT_THREAD,
    direction: "inbound",
    from_role: "operator",
    body: asked,
  });

  const { data: run, error: runError } = await supabase
    .from("agent_runs")
    .insert({
      kind: "copilot",
      status: "running",
      input: { question: asked, model: CHAT_MODEL },
    })
    .select("id")
    .single();

  if (runError) throw new Error(`agent run: ${runError.message}`);
  const runId = (run as { id: string }).id;

  let seq = 0;
  const record: StepRecorder = async (step) => {
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
      { role: "user", content: brief },
      ...history,
      { role: "user", content: asked },
    ];

    const { text, toolCalls, inputTokens, outputTokens } = await runToolLoop({
      model: CHAT_MODEL,
      messages,
      tools: buildCopilotTools(record),
      maxIterations: MAX_ITERATIONS,
      keepRecent: 12,
      temperature: 0.3,
      maxTokens: 1200,
      reasoningEffort: "low",
    });

    const reply = text || "I could not work that out from the board.";

    await supabase.from("messages").insert({
      thread_key: COPILOT_THREAD,
      direction: "outbound",
      from_role: "agent",
      body: reply,
    });

    await supabase
      .from("agent_runs")
      .update({
        status: "succeeded",
        output: { text: reply, model: CHAT_MODEL },
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        ended_at: new Date().toISOString(),
      })
      .eq("id", runId);

    return { runId, text: reply, toolCalls, ms: Date.now() - started };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await supabase
      .from("agent_runs")
      .update({ status: "failed", error: message, ended_at: new Date().toISOString() })
      .eq("id", runId);

    const apology = "I could not reach the board just then — try me again.";
    await supabase.from("messages").insert({
      thread_key: COPILOT_THREAD,
      direction: "outbound",
      from_role: "agent",
      body: apology,
      structured: { failed: true, error: message },
    });

    return { runId, text: apology, toolCalls: 0, ms: Date.now() - started };
  }
}

function buildCopilotTools(record: StepRecorder) {
  const searchSchedule = defineTool({
    name: "search_schedule",
    description:
      "Every movement across every group in the next N days, with the group it belongs to and the vendor running it.",
    inputSchema: z.object({
      days: z.number().describe("How far ahead to look, from today"),
      query: z
        .string()
        .optional()
        .describe("Words to match against stop title, group or vendor"),
    }),
    run: traced("search_schedule", record, async ({ days, query }) => {
      const schedule = await getSchedule(Math.min(Math.max(days, 1), 14));
      const terms = (query ?? "")
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean);

      return schedule
        .filter((entry) => {
          if (terms.length === 0) return true;
          const haystack = [
            entry.title,
            entry.trips?.title ?? "",
            entry.vendors?.name ?? "",
            entry.type,
            entry.status,
          ]
            .join(" ")
            .toLowerCase();
          return terms.some((term) => haystack.includes(term));
        })
        .map((entry) => ({
          group: entry.trips?.title,
          party_size: entry.trips?.party_size,
          stop: entry.title,
          when: `${formatDate(entry.starts_at)} ${formatTime(entry.starts_at)}`,
          type: entry.type,
          status: entry.status,
          field_state: entry.field_state,
          vendor: entry.vendors?.name,
          reachable: entry.vendors?.channel,
          cost: Number(entry.cost),
        }));
    }),
  });

  const listVendors = defineTool({
    name: "list_vendors",
    description:
      "Suppliers, how they are reached and how reliable they have been. 'manual' means somebody has to phone them.",
    inputSchema: z.object({
      query: z.string().optional().describe("Words to match against name or type"),
    }),
    run: traced("list_vendors", record, async ({ query }) => {
      const vendors = await getVendors();
      const terms = (query ?? "")
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean);

      return vendors
        .filter((vendor) =>
          terms.length === 0
            ? true
            : terms.some((term) =>
                `${vendor.name} ${vendor.type}`.toLowerCase().includes(term)
              )
        )
        .map((vendor) => ({
          name: vendor.name,
          type: vendor.type,
          reachable: vendor.channel,
          reliability: Number(vendor.reliability),
          phone: vendor.phone,
        }));
    }),
  });

  return [searchSchedule, listVendors];
}

/** Today's board, in the order an operator reads it: what is on fire, then who
 *  is travelling, then what is moving. */
async function briefForConsole(): Promise<string> {
  const [trips, schedule, disruptions, vendors] = await Promise.all([
    getOperatorTrips(),
    getSchedule(3),
    getAllOpenDisruptions(),
    getVendors(),
  ]);

  const totals = operatorTotals(trips, schedule);
  const lines: string[] = [];

  lines.push(
    `CONSOLE — ${totals.liveTrips} live group(s), ${totals.travellers} travellers, ` +
      `${formatMoney(totals.booked)} booked, ${totals.atRisk} stop(s) at risk.`
  );
  // The application's day, so the copilot and the board it reads agree.
  lines.push(`Today is ${now().toISOString().slice(0, 10)}.`);

  lines.push("");
  lines.push("GROUPS:");
  for (const trip of trips) {
    lines.push(
      `- ${trip.title} · ${trip.status} · ${trip.party_size} pax · ` +
        `${trip.starts_on} to ${trip.ends_on}` +
        (trip.coordinator_name ? ` · guide: ${trip.coordinator_name}` : "")
    );
  }

  if (disruptions.length) {
    lines.push("");
    lines.push("OPEN DISRUPTIONS:");
    for (const disruption of disruptions) {
      lines.push(
        `- ${disruption.headline} · ${disruption.trips?.title ?? "unknown group"} · ` +
          `${disruption.source}, ${disruption.severity} severity`
      );
    }
  } else {
    lines.push("");
    lines.push("No open disruptions.");
  }

  /**
   * The full supplier list, not just the ones appearing this week.
   *
   * Left out, the copilot answered "which vendors need a phone call?" with
   * "none" — because the only vendors it could see were the five running the
   * next three days, and all of those happen to be automatic. It was a fair
   * inference from a partial view, which is why the fix is the view and not the
   * prompt. Six rows is cheaper to send than to be wrong about.
   */
  lines.push("");
  lines.push("ALL VENDORS:");
  for (const vendor of vendors) {
    lines.push(
      `- ${vendor.name} · ${vendor.type} · ` +
        `${vendor.channel === "auto" ? "books automatically" : "MANUAL — needs a phone call"} · ` +
        `reliability ${Number(vendor.reliability)}`
    );
  }

  lines.push("");
  lines.push("NEXT 72 HOURS (this window only — not the whole season):");
  for (const entry of schedule.slice(0, 20)) {
    lines.push(
      `- ${formatDate(entry.starts_at)} ${formatTime(entry.starts_at)} · ` +
        `${entry.title} · ${entry.trips?.title ?? "?"} · ${entry.status}` +
        (entry.vendors ? ` · ${entry.vendors.name} (${entry.vendors.channel})` : "")
    );
  }

  return lines.join("\n");
}

async function recentTurns(): Promise<ChatMessage[]> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("messages")
    .select("from_role, body")
    .eq("thread_key", COPILOT_THREAD)
    .order("sent_at", { ascending: false })
    .limit(HISTORY_TURNS);

  return ((data ?? []) as { from_role: string; body: string }[])
    .reverse()
    .map((row) => ({
      role: row.from_role === "operator" ? ("user" as const) : ("assistant" as const),
      content: row.body,
    }));
}

/** The console thread, in the shape the chat panel renders. No proposals: the
 *  copilot has nothing to offer, only things to tell you. */
export async function getCopilotThread(): Promise<ThreadMessage[]> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("messages")
    .select("id, from_role, body, sent_at, structured")
    .eq("thread_key", COPILOT_THREAD)
    .order("sent_at");

  return ((data ?? []) as {
    id: string;
    from_role: string;
    body: string;
    sent_at: string;
    structured: { failed?: boolean } | null;
  }[]).map((row) => ({
    id: row.id,
    // The panel styles "traveler" as the person asking; here that is the
    // operator. The role is about which side of the conversation it is on.
    role: row.from_role === "agent" ? "agent" : "traveler",
    body: row.body,
    sentAt: row.sent_at,
    proposal: null,
    ...(row.structured?.failed ? { failed: true } : {}),
  }));
}
