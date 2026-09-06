import "server-only";
import Groq from "groq-sdk";

/**
 * Where a model call actually goes, and what happens when the first choice is
 * out of budget.
 *
 * Groq's free tier is 200,000 tokens a day **per organization, not per key**,
 * so rotating a key changes nothing and an exhausted budget 429s until a
 * rolling window creeps open tens of minutes later. That is survivable in
 * development and fatal on stage: the re-planner is the demo, and "come back in
 * twenty minutes" is not a thing you can say to a judge.
 *
 * So the runtime has a chain rather than a client. Groq stays the primary
 * because it is the fastest and the prompts are tuned against gpt-oss. When it
 * reports the *daily* budget spent — not a per-minute breach, which
 * `withRateLimitRetry` already waits out — the chain moves to the next provider
 * and stays there for the life of the process.
 *
 * Every provider here speaks the OpenAI `/chat/completions` wire format, which
 * is why one `Groq` SDK client can drive all of them: only `baseURL`, the key
 * and the model name change. That is not a coincidence worth relying on
 * forever, but it is true of all three today and it keeps the loop single-path.
 *
 * Measured on the keys in this checkout, 6 Sep 2026:
 *
 *   groq     openai/gpt-oss-120b     primary; 200k tokens/day per org
 *   mistral  ministral-14b-latest    works, tool calling verified
 *            mistral-small/medium    429 "Rate limit exceeded" — tier-locked,
 *                                    not a burst; six retries over a minute all
 *                                    refused. Do not put them in the chain.
 *   gemini   gemini-3.6-flash        plain generation only. 2.5-flash is closed
 *                                    to new keys. Google Search grounding still
 *                                    429s without billing, so this does NOT
 *                                    close the price-verification gap.
 */

export type ProviderId = "groq" | "mistral" | "gemini";

export interface Provider {
  id: ProviderId;
  /** Human-readable, for the trace panel and the logs. */
  label: string;
  baseURL?: string;
  apiKey: string | undefined;
  /** The model to use when the caller has not pinned one. */
  model: string;
  /** The model for chat surfaces someone is waiting on. */
  chatModel: string;
  /** False when the provider cannot do custom function calling. */
  tools: boolean;
  /**
   * Provider-specific request fields that must NOT be forwarded.
   * `reasoning_effort` is a gpt-oss concept and Mistral 400s on it.
   */
  drop: string[];
}

function env(name: string): string | undefined {
  // Trimmed and emptiness-checked: a declared-but-blank variable in a hosting
  // dashboard is indistinguishable from an absent one until it sends `""`.
  return process.env[name]?.trim() || undefined;
}

export function providers(): Provider[] {
  const all: Provider[] = [
    {
      id: "groq",
      label: "Groq",
      apiKey: env("GROQ_API_KEY"),
      model: env("GROQ_MODEL") || "openai/gpt-oss-120b",
      chatModel: env("GROQ_CHAT_MODEL") || "openai/gpt-oss-20b",
      tools: true,
      drop: [],
    },
    {
      id: "mistral",
      label: "Mistral",
      baseURL: "https://api.mistral.ai/v1",
      apiKey: env("MISTRAL_API_KEY"),
      model: env("MISTRAL_MODEL") || "ministral-14b-latest",
      chatModel: env("MISTRAL_MODEL") || "ministral-14b-latest",
      tools: true,
      // Mistral rejects gpt-oss's reasoning knob outright.
      drop: ["reasoning_effort"],
    },
    {
      id: "gemini",
      label: "Gemini",
      // Google publishes an OpenAI-compatible surface at this path, which is
      // the only reason Gemini can sit in the same chain as the other two.
      baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
      apiKey: env("GEMINI_API_KEY"),
      model: env("GEMINI_MODEL") || "gemini-3.6-flash",
      chatModel: env("GEMINI_MODEL") || "gemini-3.6-flash",
      tools: true,
      drop: ["reasoning_effort"],
    },
  ];

  // A provider with no key is not a fallback, it is a second failure.
  return all.filter((p) => Boolean(p.apiKey));
}

/**
 * What the loop needs from a client, which is one method.
 *
 * Narrow on purpose. The Groq SDK satisfies this structurally, so the primary
 * path keeps using the real SDK — retries, error classes and all — and only the
 * fallbacks go through the shim below.
 */
export interface ChatClient {
  chat: {
    completions: {
      create(body: Record<string, unknown>): Promise<ChatCompletionLike>;
    };
  };
}

export interface ChatCompletionLike {
  choices: {
    message?: {
      role?: string;
      content?: string | null;
      reasoning?: string;
      tool_calls?: {
        id: string;
        type?: string;
        function: { name: string; arguments: string };
      }[];
    };
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/**
 * An error shaped like the SDK's, because `withRateLimitRetry` reads `.status`
 * and `.headers` off whatever it catches. A fallback that threw a bare `Error`
 * would be treated as a permanent failure and skip the retry and the next
 * failover — the recovery path would be the thing that breaks recovery.
 */
class ProviderError extends Error {
  status: number;
  headers: Headers;
  constructor(status: number, message: string, headers: Headers) {
    super(message);
    this.name = "ProviderError";
    this.status = status;
    this.headers = headers;
  }
}

/**
 * A minimal OpenAI-compatible client.
 *
 * The Groq SDK cannot be repointed: it hardcodes the path
 * `/openai/v1/chat/completions` onto whatever `baseURL` it is given, so aiming
 * it at Mistral produces `https://api.mistral.ai/v1/openai/v1/chat/completions`
 * and a 404 from the gateway that reads like a routing bug rather than a
 * mistake in the URL. Thirty lines of `fetch` is the honest fix, and it keeps
 * the agent loop single-path — the shim answers to the same shape.
 */
function shim(provider: Provider): ChatClient {
  return {
    chat: {
      completions: {
        async create(body: Record<string, unknown>) {
          const response = await fetch(`${provider.baseURL}/chat/completions`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${provider.apiKey}`,
            },
            // `undefined` values are dropped by stringify, which is how an
            // unsupported field like `reasoning_effort` disappears rather than
            // becoming an explicit null the provider then rejects.
            body: JSON.stringify(body),
          });

          if (!response.ok) {
            throw new ProviderError(
              response.status,
              await response.text(),
              response.headers
            );
          }
          return (await response.json()) as ChatCompletionLike;
        },
      },
    },
  };
}

export function clientFor(provider: Provider): ChatClient {
  if (provider.id === "groq") {
    return new Groq({ apiKey: provider.apiKey! }) as unknown as ChatClient;
  }
  return shim(provider);
}

/**
 * Which provider the process is currently on.
 *
 * Sticky on purpose. Once Groq has said the day's budget is gone it will say it
 * again for every subsequent call, and re-asking costs a round trip each time
 * to learn something already known. It resets only on a restart, which is the
 * same lifetime as the budget being wrong about.
 */
let active: ProviderId | null = null;

export function activeProvider(): Provider {
  const chain = providers();
  if (chain.length === 0) {
    throw new Error(
      "No model provider is configured. Set GROQ_API_KEY in .env.local " +
        "(a free key is at console.groq.com), or MISTRAL_API_KEY / GEMINI_API_KEY " +
        "as a fallback."
    );
  }
  if (active) {
    const found = chain.find((p) => p.id === active);
    if (found) return found;
  }
  return chain[0];
}

/**
 * Move to the next provider in the chain. Returns null when there is no next
 * one, which is the caller's signal to give up rather than loop.
 */
export function demoteProvider(reason: string): Provider | null {
  const chain = providers();
  const current = activeProvider();
  const index = chain.findIndex((p) => p.id === current.id);
  const next = chain[index + 1];
  if (!next) return null;

  active = next.id;
  console.warn(
    `[agent] ${current.label} is out of budget, failing over to ${next.label} ` +
      `(${next.model}). Reason: ${reason.slice(0, 200)}`
  );
  return next;
}

/** Test seam, and the thing `db:seed`-style resets want. */
export function resetProvider(): void {
  active = null;
}

/**
 * Mistral requires `tool_call_id` to be exactly nine alphanumeric characters,
 * and Groq's are longer. A transcript that began on Groq and fails over
 * mid-run would otherwise be rejected as malformed on the first request after
 * the switch — the agent would survive the budget and die on the handover,
 * which is the same lost demo by a different route.
 *
 * Rewritten deterministically so an assistant's `tool_calls[].id` and the
 * matching `tool` message's `tool_call_id` still agree after the rewrite.
 */
export function normalizeToolCallIds(messages: unknown[]): void {
  const map = new Map<string, string>();
  let n = 0;

  const rename = (id: string): string => {
    const existing = map.get(id);
    if (existing) return existing;
    // Nine chars, alphanumeric, stable within a transcript.
    const short = `t${String(n++).padStart(8, "0")}`;
    map.set(id, short);
    return short;
  };

  for (const message of messages) {
    const m = message as {
      role?: string;
      tool_calls?: { id: string }[];
      tool_call_id?: string;
    };
    if (m.tool_calls) for (const call of m.tool_calls) call.id = rename(call.id);
    if (m.tool_call_id) m.tool_call_id = rename(m.tool_call_id);
  }
}
