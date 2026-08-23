import "server-only";
import Groq from "groq-sdk";
import { createAdminClient } from "@/lib/supabase/admin";
import { assessDisruption } from "@/lib/disruption/engine";
import { buildTools, type AgentTool, type StepRecorder } from "./tools";
import { TRIP_TZ, formatTime } from "@/lib/format";

/**
 * The re-planning agent.
 *
 * This is the one place in the product where a model decides anything, and the
 * shape is deliberate: it reads a deterministic assessment, calls tools that
 * already existed and were tested without it, and writes drafts. It cannot
 * change a live booking — `propose_replan` inserts into `replan_proposals` and
 * a human accepts. So the worst failure mode is a bad suggestion, not a
 * traveler stranded in Positano.
 *
 * Runs on Groq. The loop is hand-written rather than an SDK helper, which is
 * what a plain `/chat/completions` API gives you — and it means the iteration
 * cap, the trace, and the recovery behaviour are all ours to control.
 */

/** Overridable so a weaker or stronger model can be tried without a deploy. */
const MODEL = process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile";

/** Guards against a model that keeps calling tools and never concludes. Each
 *  iteration is one inference call plus its tool results. */
const MAX_ITERATIONS = 12;

const SYSTEM = `You are the re-planning agent for Voyage, a tour operations platform.

A booked itinerary has been disrupted. Your job is to propose concrete
alternatives for a human operator to accept or reject.

How to work:
1. Call get_blast_radius on the broken item first. Items not in that list are
   unaffected — never touch them.
2. Use search_availability to find replacements. Price the plausible ones with
   price_option before committing to them.
3. Use check_vendor on anything you intend to book. A plan that depends on a
   'manual' vendor cannot complete unattended; say so in your rationale.
4. Call propose_replan two or three times with genuinely different trade-offs —
   for example one that protects the budget and one that protects the
   experience. Two near-identical plans are worth less than one good one.

Rules you must not break:
- Never move or drop a locked item. Work around it and say why in the rationale.
- Prefer plans that keep the traveler's stated interests intact.
- A cancellation penalty is real money. A cheap replacement that forfeits a
  large deposit is usually worse than a pricier one that does not.
- Times are ISO 8601 UTC. The traveler reads them in the trip's local zone.
- Do not invent ids. Only use ids returned by your tools.

When you have called propose_replan for every option you intend to offer, stop
calling tools and reply with two or three sentences summarising them.`;

export interface ReplanResult {
  runId: string;
  proposals: number;
  steps: number;
  summary: string;
  ms: number;
}

export async function runReplanAgent(disruptionId: string): Promise<ReplanResult> {
  const started = Date.now();
  const supabase = createAdminClient();

  const assessment = await assessDisruption(disruptionId);
  if (!assessment || !assessment.root) {
    throw new Error("Cannot re-plan: the disruption has no root item.");
  }

  const { data: run, error: runError } = await supabase
    .from("agent_runs")
    .insert({
      trip_id: assessment.disruption.trip_id,
      kind: "replan",
      status: "running",
      input: {
        disruption_id: disruptionId,
        headline: assessment.disruption.headline,
        model: MODEL,
      },
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
    const groq = new Groq({ apiKey: requireKey() });
    const tools = buildTools(assessment, record);
    const byName = new Map(tools.map((tool) => [tool.name, tool]));

    const messages: Groq.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: SYSTEM },
      { role: "user", content: briefFor(assessment) },
    ];

    let summary = "";
    let inputTokens = 0;
    let outputTokens = 0;

    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
      const completion = await groq.chat.completions.create({
        model: MODEL,
        max_tokens: 4096,
        temperature: 0.4,
        messages,
        tools: tools.map(toGroqTool),
        tool_choice: "auto",
      });

      inputTokens += completion.usage?.prompt_tokens ?? 0;
      outputTokens += completion.usage?.completion_tokens ?? 0;

      const choice = completion.choices[0];
      const message = choice?.message;
      if (!message) break;

      messages.push({
        role: "assistant",
        content: message.content ?? "",
        tool_calls: message.tool_calls,
      } as Groq.Chat.ChatCompletionMessageParam);

      const calls = message.tool_calls ?? [];
      if (calls.length === 0) {
        summary = (message.content ?? "").trim();
        break;
      }

      // Parallel calls come back in one message and every one of them needs a
      // matching tool result, or the next request is rejected as malformed.
      const results = await Promise.all(
        calls.map(async (call) => {
          const tool = byName.get(call.function.name);
          if (!tool) {
            return {
              role: "tool" as const,
              tool_call_id: call.id,
              content: JSON.stringify({
                error: `No such tool: ${call.function.name}`,
              }),
            };
          }

          let args: unknown = {};
          try {
            // Arguments arrive as a JSON *string*; never pattern-match on it.
            args = call.function.arguments
              ? JSON.parse(call.function.arguments)
              : {};
          } catch {
            return {
              role: "tool" as const,
              tool_call_id: call.id,
              content: JSON.stringify({
                error: "Arguments were not valid JSON. Send a JSON object.",
              }),
            };
          }

          return {
            role: "tool" as const,
            tool_call_id: call.id,
            content: await tool.run(args),
          };
        })
      );

      messages.push(...results);
    }

    const { count } = await supabase
      .from("replan_proposals")
      .select("id", { count: "exact", head: true })
      .eq("disruption_id", disruptionId);

    // Tie proposals back to the run that produced them, so the trace panel can
    // show which reasoning led to which option.
    await supabase
      .from("replan_proposals")
      .update({ run_id: runId })
      .eq("disruption_id", disruptionId)
      .is("run_id", null);

    await supabase
      .from("agent_runs")
      .update({
        status: "succeeded",
        output: { summary, proposals: count ?? 0, model: MODEL },
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        ended_at: new Date().toISOString(),
      })
      .eq("id", runId);

    return {
      runId,
      proposals: count ?? 0,
      steps: seq,
      summary,
      ms: Date.now() - started,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await supabase
      .from("agent_runs")
      .update({
        status: "failed",
        error: message,
        ended_at: new Date().toISOString(),
      })
      .eq("id", runId);
    throw error;
  }
}

function requireKey(): string {
  const key = process.env.GROQ_API_KEY;
  if (!key) {
    throw new Error(
      "GROQ_API_KEY is not set. Get a free key at console.groq.com and add it to .env.local."
    );
  }
  return key;
}

function toGroqTool(tool: AgentTool): Groq.Chat.ChatCompletionTool {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}

/**
 * The opening brief.
 *
 * Everything deterministic goes in up front — what broke, what it costs, what
 * is locked — so the model spends its tool calls on judgement rather than on
 * re-deriving facts we already computed. Times are rendered in the trip's zone
 * alongside the raw ISO, because a model reasoning about "is 18:00 too late for
 * dinner" needs the local clock, not UTC.
 */
function briefFor(a: NonNullable<Awaited<ReturnType<typeof assessDisruption>>>) {
  const lines: string[] = [];

  lines.push(`DISRUPTION: ${a.disruption.headline}`);
  lines.push(`Cause: ${a.disruption.source} (${a.disruption.severity} severity)`);
  if (Object.keys(a.disruption.payload).length) {
    lines.push(`Detail: ${JSON.stringify(a.disruption.payload)}`);
  }
  lines.push("");
  lines.push(`Broken item id: ${a.root!.id}`);
  lines.push(`Trip timezone: ${TRIP_TZ}`);
  lines.push("");
  lines.push(
    `AFFECTED (${a.affected.length} items, ${a.exposure} EUR exposed, ${a.sunk} EUR non-refundable):`
  );

  for (const item of a.affected) {
    lines.push(
      `- [${item.id}] depth ${item.depth} · ${item.title} · ` +
        `${formatTime(item.starts_at)}–${formatTime(item.ends_at)} local · ${item.cost} EUR` +
        (item.lock_reason ? ` · LOCKED: ${item.lock_reason}` : "")
    );
  }

  if (a.candidates.length) {
    lines.push("");
    lines.push(
      `${a.candidates.length} replacements are already known to survive this disruption. Use search_availability for the full detail.`
    );
  } else {
    lines.push("");
    lines.push(
      "No pre-filtered replacements were found. Search anyway, then consider dropping items and rebalancing the day."
    );
  }

  lines.push("");
  lines.push("Propose two or three genuinely different plans.");

  return lines.join("\n");
}
