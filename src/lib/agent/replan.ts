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

/**
 * Overridable so a weaker or stronger model can be tried without a deploy.
 *
 * Trimmed and emptiness-checked rather than `??`, which only falls back on
 * undefined — a declared-but-empty `GROQ_MODEL=` in an env file otherwise wins
 * and sends `model: ""`, which fails as an unhelpful 404 model_not_found.
 *
 * The default is chosen from what `GET /v1/models` actually returns, not from
 * the docs: Groq's tool-use page still lists llama-3.3-70b-versatile, which no
 * longer exists on the platform. `groq/compound*` is excluded deliberately —
 * those support only Groq's built-in tools, not custom function calling.
 */
const MODEL = process.env.GROQ_MODEL?.trim() || "openai/gpt-oss-120b";

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
    const groq = new Groq({ apiKey: requireKey() });
    const tools = buildTools(assessment, record);
    const byName = new Map(tools.map((tool) => [tool.name, tool]));

    const messages: Groq.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: SYSTEM },
      { role: "user", content: briefFor(assessment) },
    ];

    let summary = "";
    let nudged = false;
    let inputTokens = 0;
    let outputTokens = 0;

    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
      pruneHistory(messages);

      const completion = await withRateLimitRetry(() =>
        groq.chat.completions.create({
          model: MODEL,
          // A proposal with five operations serialises to well over 2k, and a
          // truncated tool call comes back as a 400 tool_use_failed with the
          // half-written JSON attached — the output cap has to clear the
          // largest single tool call, not the average one.
          max_tokens: 4096,
          temperature: 0.4,
          messages,
          tools: tools.map(toGroqTool),
          // Two failure modes seen in testing, both fixed here. Left to
          // itself the model either answers in prose (recording nothing) or
          // prices every candidate until the iteration budget is gone without
          // ever committing. So the first turn and the last two are pinned to
          // the only tool that actually saves anything.
          tool_choice:
            iteration === 0 || iteration >= MAX_ITERATIONS - 2
              ? { type: "function", function: { name: "propose_replan" } }
              : "auto",
        })
      );

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
        // gpt-oss returns its prose in `reasoning` and leaves `content` null,
        // so reading only content yields an empty summary on every clean finish.
        const text =
          message.content ??
          (message as { reasoning?: string }).reasoning ??
          "";
        summary = text.trim();

        // Finishing without a single proposal is a failed run, not a quiet
        // success — nudge once before accepting it.
        if (!nudged && (await countProposals(supabase, disruptionId)) === 0) {
          nudged = true;
          messages.push({
            role: "user",
            content:
              "You have not recorded anything. Call propose_replan now for each option you described. Nothing is saved until you do.",
          });
          continue;
        }
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

/**
 * Drop the middle of the transcript, keeping the system prompt, the brief, and
 * the most recent exchanges.
 *
 * An assistant message carrying tool_calls must keep its matching tool results
 * or the next request is rejected, so the cut point is moved back to a clean
 * boundary rather than taken literally.
 */
function pruneHistory(messages: Groq.Chat.ChatCompletionMessageParam[]): void {
  const PRESERVED = 2; // system + opening brief
  const budget = PRESERVED + KEEP_RECENT_EXCHANGES;
  if (messages.length <= budget) return;

  let cut = messages.length - KEEP_RECENT_EXCHANGES;
  // Never begin the kept window on an orphaned tool result.
  while (cut < messages.length && messages[cut].role === "tool") cut++;

  messages.splice(PRESERVED, cut - PRESERVED);
}

/**
 * Wait out a token-per-minute breach instead of failing the run.
 *
 * Groq's free tier has two independent windows and they reset on wildly
 * different clocks: tokens refill in seconds, requests in ~16 minutes. A
 * `retry-after` header reflects the slower one, so honouring it blindly turned
 * a 4-second token pause into a 9-minute sleep — twice — and made a 30-second
 * run take 19 minutes. Prefer the token-reset header, and cap the wait
 * regardless, because a run that gives up is better than one nobody watches.
 */
const MAX_BACKOFF_MS = 30_000;

/** Groq formats durations as "3.682s", "1m30s", "550ms". */
function parseDuration(value: string | undefined): number | null {
  if (!value) return null;
  const match = value.match(
    /^(?:(\d+(?:\.\d+)?)m)?(?:(\d+(?:\.\d+)?)s)?(?:(\d+(?:\.\d+)?)ms)?$/
  );
  if (!match || !match.slice(1).some(Boolean)) {
    const seconds = Number(value);
    return Number.isFinite(seconds) ? seconds * 1000 : null;
  }
  const [, m, sec, ms] = match;
  return (
    (m ? Number(m) * 60_000 : 0) +
    (sec ? Number(sec) * 1000 : 0) +
    (ms ? Number(ms) : 0)
  );
}

async function withRateLimitRetry<T>(
  call: () => Promise<T>,
  attempts = 4
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await call();
    } catch (error) {
      const status = (error as { status?: number })?.status;
      const body = String((error as { message?: string })?.message ?? "");
      const isRateLimit = status === 429 || status === 413;
      // A malformed tool call is a one-off generation glitch; retrying costs a
      // little budget and usually succeeds.
      const isBadGeneration = status === 400 && body.includes("tool_use_failed");
      if ((!isRateLimit && !isBadGeneration) || attempt >= attempts - 1) throw error;

      if (isBadGeneration) continue;

      const headers = (error as { headers?: Record<string, string> })?.headers ?? {};
      const tokenReset = parseDuration(headers["x-ratelimit-reset-tokens"]);
      const wait = Math.min(
        tokenReset ?? 5_000 * (attempt + 1),
        MAX_BACKOFF_MS
      );
      // A little headroom past the stated reset, since the window is a moving
      // average rather than a hard tick.
      await new Promise((resolve) => setTimeout(resolve, wait + 1_000));
    }
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
