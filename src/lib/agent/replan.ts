import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { assessDisruption } from "@/lib/disruption/engine";
import { buildTools } from "./tools";
import { MODEL, runToolLoop, type ChatMessage } from "./runtime";
import type { StepRecorder } from "./tool";
import { TRIP_TZ, formatTime } from "@/lib/format";

/**
 * The re-planning agent.
 *
 * This is the flagship: a genuine tool-using loop whose depth is decided at
 * runtime, over a disruption a deterministic engine has already assessed. It
 * reads that assessment, calls tools that existed and were tested before it
 * did, and writes drafts. It cannot change a live booking — `propose_replan`
 * inserts into `replan_proposals` and a human accepts. So the worst failure
 * mode is a bad suggestion, not a traveler stranded in Positano.
 *
 * The loop itself lives in `runtime.ts`, shared with the concierge and the
 * copilot. What is here is what is specific to re-planning: the prompt, the
 * brief built from the assessment, and the two guardrails below.
 */

/** Guards against a model that keeps calling tools and never concludes. Each
 *  iteration is one inference call plus its tool results. */
const MAX_ITERATIONS = 6;

/**
 * Groq's free tier allows 8000 tokens per minute, and an agent loop resends its
 * whole history every iteration — so cumulative spend, not any single request,
 * is what breaches it. Two things keep the run inside the budget: the brief
 * carries the deterministic findings so fewer round trips are needed, and older
 * tool results are dropped once they have been acted on.
 *
 * Keeping the last few exchanges is safe here because anything durable (ids,
 * prices) has by then been written into a proposal, not held in the transcript.
 */
const KEEP_RECENT_EXCHANGES = 6;

const SYSTEM = `You re-plan disrupted tour itineraries for a human operator to approve.

Method: the brief already gives you everything — what broke, what it costs,
which replacements survive, and the net EUR change for each. Do not re-derive
any of it. Go straight to propose_replan, once per distinct option (2-3 total,
with genuinely different trade-offs: one protecting budget, one protecting the
experience). Use price_option or check_vendor only if something is genuinely
missing.

Hard rules:
- Never move or drop a LOCKED item. Work around it and say why.
- A forfeited deposit is real money; a cheap swap that loses a big one is worse.
- Only use ids your tools or the brief returned. Never invent one.
- Times are ISO 8601 UTC and MUST fall on the trip dates given in the brief.
  Never invent a date; copy the date from the item you are replacing.

Batch independent calls into one turn — price several candidates together
rather than one per turn. The token budget is tight and every extra turn resends
the whole conversation.

A prose answer records nothing. Only propose_replan saves a plan, so every
option you intend to offer must go through it. Once they are recorded, stop
calling tools and reply with two sentences.`;

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
    const tools = buildTools(assessment, record);

    const messages: ChatMessage[] = [
      { role: "system", content: SYSTEM },
      { role: "user", content: briefFor(assessment) },
    ];

    // Two failure modes seen in testing, both handled here. Left to itself the
    // model either answers in prose (recording nothing) or prices every
    // candidate until the iteration budget is gone without ever committing. So
    // the first turn and the last two are pinned to the only tool that actually
    // saves anything, and finishing with nothing recorded earns one nudge.
    let nudged = false;

    const { text: summary, inputTokens, outputTokens } = await runToolLoop({
      model: MODEL,
      messages,
      tools,
      maxIterations: MAX_ITERATIONS,
      keepRecent: KEEP_RECENT_EXCHANGES,
      pin: (iteration) =>
        iteration === 0 || iteration >= MAX_ITERATIONS - 2
          ? "propose_replan"
          : null,
      onIdle: async () => {
        if (nudged) return null;
        if ((await countProposals(supabase, disruptionId)) > 0) return null;
        nudged = true;
        return "You have not recorded anything. Call propose_replan now for each option you described. Nothing is saved until you do.";
      },
    });

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

async function countProposals(
  supabase: ReturnType<typeof createAdminClient>,
  disruptionId: string
): Promise<number> {
  const { count } = await supabase
    .from("replan_proposals")
    .select("id", { count: "exact", head: true })
    .eq("disruption_id", disruptionId);
  return count ?? 0;
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
  lines.push(`Broken item date: ${a.root!.starts_at.slice(0, 10)} (UTC)`);
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
    lines.push(`REPLACEMENTS that survive this disruption (already filtered):`);
    // Inlined rather than left behind search_availability: these are computed
    // deterministically before the model runs, so making it spend a round trip
    // to fetch what we already have wastes a scarce token budget.
    for (const c of a.candidates.slice(0, 6)) {
      const delta = c.netDelta >= 0 ? `+${c.netDelta}` : `${c.netDelta}`;
      lines.push(
        `- [${c.inventory.id}] ${c.inventory.title} · ${c.price} EUR · ` +
          `net ${delta} EUR vs the broken item · ${c.startsAt} · ` +
          `${c.distanceKm}km · ${c.channel} · ${(c.inventory.tags ?? []).join(",")}`
      );
    }
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
