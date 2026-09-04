import "server-only";
import { z } from "zod";
import type Groq from "groq-sdk";

/**
 * How a tool is described, validated and traced — shared by every agent.
 *
 * Definitions are provider-neutral on purpose: a name, a description, a JSON
 * Schema, and a function. Schemas are declared in Zod and emitted as JSON
 * Schema, so arguments are still validated locally whichever vendor is driving
 * the loop — and swapping vendors touches the loop, never a tool.
 *
 * This lived inside the re-planner until there was a second agent. Nothing here
 * changed in the move; it is the same code, addressable by more than one caller.
 */

export interface AgentTool {
  name: string;
  description: string;
  /** JSON Schema, the format every current provider accepts. */
  parameters: Record<string, unknown>;
  run: (input: unknown) => Promise<string>;
}

/** Validates against the Zod schema, then hands off to the implementation. */
export function defineTool<S extends z.ZodType>(spec: {
  name: string;
  description: string;
  inputSchema: S;
  run: (input: z.infer<S>) => Promise<string>;
}): AgentTool {
  // `$schema` is a URL no provider reads, resent with every tool on every turn
  // of a loop metered by the token. Dropping it costs nothing and buys back
  // about 150 tokens a call across the re-planner's five tools.
  const { $schema: _discard, ...parameters } = z.toJSONSchema(
    spec.inputSchema
  ) as Record<string, unknown>;

  return {
    name: spec.name,
    description: spec.description,
    parameters,
    run: async (raw) => {
      const parsed = spec.inputSchema.safeParse(raw);
      if (!parsed.success) {
        // Returned, not thrown — a malformed call is usually recoverable if the
        // model is told precisely what was wrong with it.
        return JSON.stringify({
          error: "Invalid arguments",
          issues: parsed.error.issues.map(
            (i) => `${i.path.join(".") || "(root)"}: ${i.message}`
          ),
        });
      }
      return spec.run(parsed.data);
    },
  };
}

export type StepRecorder = (step: {
  tool: string;
  input: unknown;
  output: unknown;
  ms: number;
}) => Promise<void>;

/** A recorder that keeps nothing — for a call whose trace nobody will read. */
export const noTrace: StepRecorder = async () => {};

/** Wraps a tool body so every call is timed and recorded, including failures —
 *  a tool that threw is exactly the kind of thing you want in the trace. */
export function traced<I, O>(
  name: string,
  record: StepRecorder,
  fn: (input: I) => Promise<O>
) {
  return async (input: I): Promise<string> => {
    const started = Date.now();
    try {
      const output = await fn(input);
      await record({ tool: name, input, output, ms: Date.now() - started });
      return JSON.stringify(output);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await record({
        tool: name,
        input,
        output: { error: message },
        ms: Date.now() - started,
      });
      // Handed back as a result, not thrown: the model can often recover by
      // trying different arguments, and killing the run loses the whole trace.
      return JSON.stringify({ error: message });
    }
  };
}

export function toGroqTool(tool: AgentTool): Groq.Chat.ChatCompletionTool {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}
