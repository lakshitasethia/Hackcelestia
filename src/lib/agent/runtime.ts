import "server-only";
import Groq from "groq-sdk";
import { toGroqTool, type AgentTool } from "./tool";

/**
 * The agent loop, and the plumbing around it every agent shares.
 *
 * There are three agents now — the re-planner, the traveler's concierge and the
 * operator's copilot — and they differ in their tools and their prompt, not in
 * how a conversation with a tool-using model is driven. Keeping one loop means
 * the rate-limit handling, the transcript pruning and the malformed-call
 * recovery are fixed once. Every one of those behaviours was learned the hard
 * way from a run that failed on stage-adjacent conditions, and they are
 * documented where they are implemented rather than rediscovered per agent.
 *
 * The loop is hand-written rather than an SDK helper, which is what a plain
 * `/chat/completions` API gives you — and it means the iteration cap, the
 * trace and the recovery behaviour are all ours to control.
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
export const MODEL = process.env.GROQ_MODEL?.trim() || "openai/gpt-oss-120b";

/**
 * The model behind anything a person is waiting on.
 *
 * A re-plan is watched: it runs behind a trace panel, it is narrated, and 60
 * seconds of it is a feature. A chat reply is not — someone typing "add a wine
 * tasting on day three" abandons the conversation long before that. Same
 * default as the re-planner today, kept separate so the chat surfaces can be
 * moved to a smaller model without touching the one decision that has to be
 * right.
 */
export const CHAT_MODEL =
  process.env.GROQ_CHAT_MODEL?.trim() || "openai/gpt-oss-20b";

/**
 * The model that is allowed to touch the internet.
 *
 * This is the one place `groq/compound*` is the right answer rather than the
 * wrong one. Everywhere else in this project those models are excluded because
 * they support only Groq's built-in tools and not our custom function calling —
 * but the research pass wants exactly one of Groq's built-in tools, `web_search`,
 * and wants no custom ones at all. Groq runs the search server-side and attaches
 * the pages it read to the response, so a researched price arrives with its
 * source and no second vendor or API key is involved.
 *
 * `compound-mini` rather than `compound`: it takes one tool call per turn where
 * the larger one iterates, which is both faster and, on the free tier, the
 * difference between a request that runs and a 413. Someone is watching this.
 *
 * Two things about this model are worth knowing before changing it, because
 * both were learned by breaking them:
 *
 * 1. Its context is small, and Groq injects whole fetched pages into it before
 *    the model answers. Three searches in one request overflows, and the reply
 *    is a 413 `request_too_large` *after* the searching has happened. That is
 *    why `research.ts` asks for one search per pass and degrades instead of
 *    retrying — see `trySearch`.
 * 2. It is built on `openai/gpt-oss-120b`, and everything it spends counts
 *    against that model's daily allowance — 200,000 tokens on the free tier.
 *    So a 120b call made elsewhere can rate-limit the research agent, and vice
 *    versa. The structuring calls deliberately run on the 20b for that reason.
 *
 * The alternative — `openai/gpt-oss-120b` with Groq's `browser_search` tool —
 * reads pages far better and has the context to hold them, but bills the
 * fetched page content to you: one "what is there to do in Lucerne" came to
 * 153,000 prompt tokens, three quarters of a day's allowance for one question.
 * It is the right answer on a paid tier and unusable on this one.
 */
export const RESEARCH_MODEL =
  process.env.GROQ_RESEARCH_MODEL?.trim() || "groq/compound-mini";

export function requireKey(): string {
  // `.trim()` because a variable that exists and is blank is not a key, and a
  // hosting dashboard makes those two states look identical.
  const key = process.env.GROQ_API_KEY?.trim();
  if (!key) {
    throw new Error(
      "GROQ_API_KEY is not set. Add it to .env.local locally, or to the " +
        "hosting environment for a deployed build — a free key is at console.groq.com."
    );
  }
  return key;
}

export function groqClient(): Groq {
  return new Groq({ apiKey: requireKey() });
}

export type ChatMessage = Groq.Chat.ChatCompletionMessageParam;

// ------------------------------------------------------------ rate limits --

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
const MAX_BACKOFF_MS = 75_000;

/**
 * Read one header off an error, whichever shape the SDK hands back.
 *
 * This existed as `headers[name]` and was silently always undefined, because
 * the SDK returns a `Headers` instance and indexing one gives you nothing. The
 * symptom was not an error: the code fell through to its 5/10/15s fallback,
 * gave up after thirty seconds, and printed "remaining tokens: ?" — a run that
 * failed for want of a wait it had been told the length of.
 */
function header(headers: unknown, name: string): string | undefined {
  if (!headers) return undefined;
  if (typeof (headers as Headers).get === "function") {
    return (headers as Headers).get(name) ?? undefined;
  }
  const record = headers as Record<string, string | undefined>;
  return record[name] ?? record[name.toLowerCase()];
}

/** Groq formats durations as "3.682s", "1m30s", "550ms". */
export function parseDuration(value: string | undefined): number | null {
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

export async function withRateLimitRetry<T>(
  call: (relaxed: boolean) => Promise<T>,
  attempts = 4
): Promise<T> {
  // Once the pinned tool has been refused, stay relaxed for the rest of this
  // call. Flipping back would just reproduce the rejection.
  let relaxed = false;

  for (let attempt = 0; ; attempt++) {
    try {
      return await call(relaxed);
    } catch (error) {
      const status = (error as { status?: number })?.status;
      const body = String((error as { message?: string })?.message ?? "");
      const isRateLimit = status === 429 || status === 413;
      // A malformed tool call is a one-off generation glitch; retrying costs a
      // little budget and usually succeeds.
      const isBadGeneration = status === 400 && body.includes("tool_use_failed");
      if ((!isRateLimit && !isBadGeneration) || attempt >= attempts - 1) throw error;

      if (isBadGeneration) {
        /**
         * Distinguish "the model emitted broken JSON" — worth retrying as-is —
         * from "the pin is the problem", where the request itself has to
         * change or every retry fails identically.
         *
         * Matched with a regex rather than `includes("tool_choice")`, which
         * was too literal by exactly one space and one capital letter. Groq
         * returns at least two phrasings for the same situation:
         *
         *   "...tool_choice..."                                    (pin refused)
         *   "Tool choice is required, but model did not call a tool"
         *
         * Only the first matched, so the second retried the identical pinned
         * request four times and threw — after the agent had already done its
         * work and simply wanted to answer in prose. That is a re-plan lost on
         * the last step, which is the worst possible moment to lose one.
         */
        if (/tool[_ ]choice/i.test(body)) relaxed = true;
        continue;
      }

      const headers = (error as { headers?: unknown })?.headers;
      const tokenReset = parseDuration(header(headers, "x-ratelimit-reset-tokens"));

      /**
       * What the error itself says to wait, which beats the header.
       *
       * The headers describe the model you *called*; the limit that actually
       * refused you can belong to another one. `groq/compound-mini` runs on
       * `openai/gpt-oss-120b`, so a compound request returns compound's own
       * comfortable "reset in 0.9s" while being blocked by the 120b's 8,000
       * tokens a minute. Honouring the header meant retrying nine hundred
       * milliseconds into a twelve-second wait, three times, and then reporting
       * the price as unverifiable — which is how a run checked sixteen prices
       * and confirmed one.
       *
       * The body carries the real number. Take whichever is longer.
       */
      const stated = parseDuration(
        body.match(/try again in ([\d.]+\s*(?:m)?[\d.]*\s*m?s)/i)?.[1]
      );

      /**
       * The cap still matters even now the header is readable. A burst that
       * eats the whole token budget resets in up to a minute, which is worth
       * waiting out — but `retry-after` on this tier can quote the *request*
       * window at sixteen minutes, and nobody is watching a demo for that long.
       */
      const wait = Math.min(
        Math.max(stated ?? 0, tokenReset ?? 5_000 * (attempt + 1)),
        MAX_BACKOFF_MS
      );
      // Logged because a slow run is otherwise indistinguishable from a slow
      // model, and the answer to those two is not the same.
      const remaining = header(headers, "x-ratelimit-remaining-tokens") ?? "?";
      /**
       * Groq says which limit was hit, and the two cases need opposite
       * responses. "Rate limit reached" clears on its own. "Request too large"
       * never does — one request exceeding the per-minute ceiling will be
       * refused identically forever, and retrying it is time spent losing. So
       * say so and stop rather than sleeping three times for nothing.
       */
      if (/too large/i.test(body)) {
        throw new Error(
          `The request itself exceeds Groq's per-minute token ceiling, so no ` +
            `amount of waiting will get it through. Shorten the brief, or ` +
            `raise the limit. Groq said: ${body.slice(0, 300)}`
        );
      }

      /**
       * Tokens *per day* is a different animal from tokens per minute, and
       * conflating them wastes the only thing you have less of than tokens.
       * The per-minute window refills in seconds; the daily one is 200k on the
       * free tier and, once spent, is spent — the "try again in 20m" it quotes
       * is a rolling window creeping open, not a pause worth sitting through
       * inside a request somebody is waiting on.
       *
       * The number in that message is the useful part, so it goes through
       * intact rather than being flattened into "rate limited".
       */
      if (/per day|TPD/i.test(body)) {
        const detail = body.match(/Limit (\d+), Used (\d+)[^.]*\. Please try again in ([^"]+?)\./);
        throw new Error(
          detail
            ? `Groq's daily token budget for this model is spent: ${detail[2]} of ` +
                `${detail[1]} used, and it frees up in ${detail[3]}. This is a ` +
                `budget, not a queue — waiting inside the request will not help. ` +
                `Either pause, or raise the cap at console.groq.com/settings/billing.`
            : `Groq's daily token budget for this model is spent. ${body.slice(0, 300)}`
        );
      }

      console.warn(
        `[agent] rate limited (${status}); waiting ${(wait / 1000).toFixed(1)}s ` +
          `— remaining tokens: ${remaining}; ${body.slice(0, 420)}`
      );
      // A little headroom past the stated reset, since the window is a moving
      // average rather than a hard tick.
      await new Promise((resolve) => setTimeout(resolve, wait + 1_000));
    }
  }
}

// --------------------------------------------------------------- pruning --

/**
 * Drop the middle of the transcript, keeping the system prompt, the opening
 * brief, and the most recent exchanges.
 *
 * Groq's free tier allows 8000 tokens per minute, and an agent loop resends its
 * whole history every iteration — so cumulative spend, not any single request,
 * is what breaches it.
 *
 * An assistant message carrying tool_calls must keep its matching tool results
 * or the next request is rejected, so the cut point is moved back to a clean
 * boundary rather than taken literally.
 */
export function pruneHistory(
  messages: ChatMessage[],
  keepRecent: number,
  preserved = 2 // system + opening brief
): void {
  const budget = preserved + keepRecent;
  if (messages.length <= budget) return;

  let cut = messages.length - keepRecent;
  // Never begin the kept window on an orphaned tool result.
  while (cut < messages.length && messages[cut].role === "tool") cut++;

  messages.splice(preserved, cut - preserved);
}

// ------------------------------------------------------------- the loop --

export interface ToolLoopResult {
  /** The model's closing prose, or "" if it never produced any. */
  text: string;
  toolCalls: number;
  iterations: number;
  inputTokens: number;
  outputTokens: number;
  /** True when the iteration cap stopped it rather than the model finishing. */
  exhausted: boolean;
}

export async function runToolLoop(opts: {
  model?: string;
  /** Seeded transcript, system prompt first. Mutated in place, so a caller
   *  that wants to persist the exchange can read it back afterwards. */
  messages: ChatMessage[];
  tools: AgentTool[];
  maxIterations: number;
  maxTokens?: number;
  temperature?: number;
  /** How many trailing messages survive pruning. */
  keepRecent?: number;
  /** How many leading messages are never pruned (system + brief by default). */
  preserved?: number;
  /**
   * How long the model is allowed to think before answering.
   *
   * gpt-oss reasons before every reply, and on a chat turn that reasoning is
   * most of the wall clock: the same question answered at "low" came back in a
   * third of the time with no worse an answer, because the brief has already
   * done the thinking that mattered. The re-planner leaves this alone — there,
   * the reasoning is the product.
   */
  reasoningEffort?: "low" | "medium" | "high";
  /** Force a specific tool on a given iteration, or null to leave it free. */
  pin?: (iteration: number) => string | null;
  /**
   * Called when the model replies without calling a tool. Return a string to
   * push back as a user turn and keep going, or null to accept the answer.
   * This is how "you described three options but recorded none" is caught.
   */
  onIdle?: (text: string) => Promise<string | null>;
}): Promise<ToolLoopResult> {
  const groq = groqClient();
  const byName = new Map(opts.tools.map((tool) => [tool.name, tool]));
  const wire = opts.tools.map(toGroqTool);

  let text = "";
  let toolCalls = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let iteration = 0;
  let exhausted = true;

  for (; iteration < opts.maxIterations; iteration++) {
    pruneHistory(opts.messages, opts.keepRecent ?? 6, opts.preserved ?? 2);

    const pinned = opts.pin?.(iteration) ?? null;

    const completion = await withRateLimitRetry((relaxed) =>
      groq.chat.completions.create({
        model: opts.model ?? MODEL,
        // A proposal with five operations serialises to well over 2k, and a
        // truncated tool call comes back as a 400 tool_use_failed with the
        // half-written JSON attached — the output cap has to clear the largest
        // single tool call, not the average one.
        max_tokens: opts.maxTokens ?? 4096,
        temperature: opts.temperature ?? 0.4,
        messages: opts.messages,
        tools: wire,
        ...(opts.reasoningEffort
          ? { reasoning_effort: opts.reasoningEffort }
          : {}),
        // `relaxed` lifts the pin. Groq validates tool_choice server-side and
        // rejects the whole request with a 400 when the model reaches for a
        // different tool — so a model that insists on searching first does not
        // get a nudge, it gets a dead run. Retrying the identical request fails
        // identically; letting it have its way once is what actually recovers.
        tool_choice:
          !relaxed && pinned
            ? { type: "function", function: { name: pinned } }
            : "auto",
      })
    );

    inputTokens += completion.usage?.prompt_tokens ?? 0;
    outputTokens += completion.usage?.completion_tokens ?? 0;

    const message = completion.choices[0]?.message;
    if (!message) break;

    opts.messages.push({
      role: "assistant",
      content: message.content ?? "",
      tool_calls: message.tool_calls,
    } as ChatMessage);

    const calls = message.tool_calls ?? [];
    if (calls.length === 0) {
      // gpt-oss returns its prose in `reasoning` and leaves `content` null, so
      // reading only content yields an empty answer on every clean finish.
      text = (
        message.content ??
        (message as { reasoning?: string }).reasoning ??
        ""
      ).trim();

      const nudge = await opts.onIdle?.(text);
      if (nudge) {
        opts.messages.push({ role: "user", content: nudge });
        continue;
      }
      exhausted = false;
      break;
    }

    toolCalls += calls.length;

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

    opts.messages.push(...results);
  }

  return { text, toolCalls, iterations: iteration, inputTokens, outputTokens, exhausted };
}
