/**
 * The agents survive Groq running out of budget.
 *
 * npm run test:failover
 *
 * Groq's free tier is 200,000 tokens a day *per organization*, and when it is
 * gone it 429s until a rolling window creeps open tens of minutes later. That
 * is the single most likely way for this demo to die on stage, and until now it
 * killed the run outright — the re-planner is the demo, and "come back in
 * twenty minutes" is not something you can say to a judge.
 *
 * So there is a provider chain. This proves the parts of it that are cheap to
 * prove offline, and then spends a few hundred real tokens proving the part
 * that is not: that a tool-using loop actually completes on the fallback.
 */
import fs from "node:fs";
for (const l of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const t = l.trim(); if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("="); if (i > 0) process.env[t.slice(0, i).trim()] ||= t.slice(i + 1).trim();
}

const {
  providers, activeProvider, demoteProvider, resetProvider, normalizeToolCallIds,
} = await import("../src/lib/agent/providers.js");
const { resolveModel, runToolLoop, MODEL, CHAT_MODEL } =
  await import("../src/lib/agent/runtime.js");

let failures = 0;
const check = (ok: boolean, label: string, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} — ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

// ------------------------------------------------------------- the chain --

console.log("\n\x1b[1m1. The chain\x1b[0m");

const chain = providers();
check(chain.length >= 2,
  "there is somewhere to fail over to", `${chain.length} providers: ${chain.map(p => p.id).join(" → ")}`);
check(chain[0]?.id === "groq",
  "Groq stays the primary — the prompts are tuned against gpt-oss");
check(chain.every((p) => Boolean(p.apiKey)),
  "a provider with no key is never in the chain, because it is a second failure not a fallback");

resetProvider();
check(activeProvider().id === "groq", "a fresh process starts on the primary");

// ------------------------------------------------------- model resolution --

console.log("\n\x1b[1m2. Model names do not survive a failover; roles do\x1b[0m");

const groq = chain.find((p) => p.id === "groq")!;
const mistral = chain.find((p) => p.id === "mistral");

check(resolveModel(groq, MODEL) === MODEL,
  "on Groq, the caller's model is used as-is", MODEL);

if (mistral) {
  check(resolveModel(mistral, MODEL) === mistral.model,
    "on Mistral, the Groq model name is replaced rather than sent", `${MODEL} → ${resolveModel(mistral, MODEL)}`);
  check(resolveModel(mistral, MODEL) !== MODEL,
    "because openai/gpt-oss-120b is a 404 at Mistral and that is not a fallback");
  check(resolveModel(mistral, CHAT_MODEL) === mistral.chatModel,
    "the chat role still resolves to the chat model — somebody is watching a cursor blink");
  check(mistral.drop.includes("reasoning_effort"),
    "gpt-oss's reasoning knob is not forwarded to a provider that 400s on it");
}

// ------------------------------------------------- the transcript handover --

console.log("\n\x1b[1m3. The transcript survives the handover\x1b[0m");

/**
 * Mistral requires tool_call_id to be exactly nine alphanumeric characters and
 * Groq's are longer, so a conversation that had already called a tool would be
 * rejected as malformed on the first request after the switch. Surviving the
 * budget and dying on the handover is the same lost demo by another route.
 */
const transcript: unknown[] = [
  { role: "system", content: "…" },
  { role: "assistant", content: "", tool_calls: [
    { id: "call_01H8XYZABCDEFGHIJKLMNOP", type: "function", function: { name: "blast_radius", arguments: "{}" } },
    { id: "call_01H8XYZ222222222222222", type: "function", function: { name: "find_alternatives", arguments: "{}" } },
  ] },
  { role: "tool", tool_call_id: "call_01H8XYZABCDEFGHIJKLMNOP", content: "{}" },
  { role: "tool", tool_call_id: "call_01H8XYZ222222222222222", content: "{}" },
];

normalizeToolCallIds(transcript);

const assistant = transcript[1] as { tool_calls: { id: string }[] };
const results = transcript.slice(2) as { tool_call_id: string }[];
const ids = assistant.tool_calls.map((c) => c.id);

check(ids.every((id) => /^[A-Za-z0-9]{9}$/.test(id)),
  "every rewritten id is nine alphanumeric characters", ids.join(", "));
check(ids[0] === results[0].tool_call_id && ids[1] === results[1].tool_call_id,
  "an assistant's call and its matching result still agree after the rewrite");
check(new Set(ids).size === ids.length,
  "two different calls do not collapse onto one id");

// --------------------------------------------------- the part that is real --

console.log("\n\x1b[1m4. A tool loop actually completes on the fallback\x1b[0m");

if (!mistral) {
  console.log("SKIP — no MISTRAL_API_KEY configured");
} else {
  // Force the failover rather than waiting for a real budget to run out.
  demoteProvider("test: pretending Groq's daily budget is spent");
  check(activeProvider().id === "mistral",
    "demoting moves off the primary and stays there", activeProvider().model);

  let sawArgs: { day?: number } = {};
  const result = await runToolLoop({
    model: CHAT_MODEL,
    maxIterations: 3,
    maxTokens: 300,
    messages: [
      { role: "system", content: "You change trip itineraries. Use the tool, then say what you did in one sentence." },
      { role: "user", content: "Drop the boat trip on day 2 — the swell is too high." },
    ],
    tools: [{
      name: "propose_change",
      description: "Record a proposed change to the itinerary.",
      parameters: {
        type: "object",
        properties: {
          op: { type: "string", enum: ["drop", "move", "replace", "add"] },
          day: { type: "number", description: "The day number affected." },
        },
        required: ["op", "day"],
      },
      run: async (args: unknown) => {
        sawArgs = args as { day?: number };
        return JSON.stringify({ recorded: true });
      },
    }],
  });

  check(result.toolCalls > 0,
    "the fallback model called the tool", `${result.toolCalls} call(s)`);
  check(sawArgs.day === 2,
    "and the arguments arrived intact through the loop", `day=${sawArgs.day}`);
  check(result.inputTokens > 0,
    "usage came back, so the loop is reading a real response", `${result.inputTokens} in / ${result.outputTokens} out`);
  check(!result.exhausted,
    "the model finished on its own rather than hitting the iteration cap");
}

resetProvider();

console.log(
  failures === 0
    ? "\n\x1b[32mAll checks passed.\x1b[0m Groq running dry no longer ends a run."
    : `\n\x1b[31m${failures} FAILED\x1b[0m`
);
process.exit(failures === 0 ? 0 : 1);
