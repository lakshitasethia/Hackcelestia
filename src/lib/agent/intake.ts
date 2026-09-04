import "server-only";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { getInterestTags } from "@/lib/db/queries";
import { CHAT_MODEL, groqClient, withRateLimitRetry } from "./runtime";
import { TRIP_TZ } from "@/lib/format";

/**
 * Intake — prose in, a structured trip spec out.
 *
 * The plan called for this on day 5 and it did not get built; the form on
 * `/plan` collected the same fields directly and the README said so plainly.
 * This is the smallest of the agents and the only one that is not a loop: one
 * call, one structured answer, no tools and nothing written to the database.
 * It fills a form in front of someone who can see every value before it is
 * submitted, which is the same consent boundary as everywhere else here — the
 * model proposes, a person confirms.
 *
 * Interests are constrained to tags that actually exist in the catalogue. A
 * model left to invent them returns "wine" and "hiking" for a catalogue that
 * files those under "food" and "scenic", and the trip is then built around
 * preferences nothing can match.
 */

const SpecSchema = z.object({
  title: z.string().nullish(),
  party_size: z.number().int().min(1).max(40).nullish(),
  budget: z.number().min(0).nullish(),
  starts_on: z.string().nullish(),
  ends_on: z.string().nullish(),
  interests: z.array(z.string()).nullish(),
  pace: z.enum(["relaxed", "moderate", "packed"]).nullish(),
  dietary: z.array(z.string()).nullish(),
  mobility: z.string().nullish(),
  style: z.string().nullish(),
  /** What it could not work out, so the form can say so rather than guessing. */
  unclear: z.array(z.string()).nullish(),
});

export type TripSpec = {
  title: string | null;
  partySize: number | null;
  budget: number | null;
  startsOn: string | null;
  endsOn: string | null;
  interests: string[];
  pace: "relaxed" | "moderate" | "packed" | null;
  dietary: string[];
  mobility: string | null;
  style: string | null;
  unclear: string[];
};

export async function extractTripSpec(description: string): Promise<TripSpec> {
  const prose = description.trim();
  if (!prose) throw new Error("Describe the trip first.");
  if (prose.length > 2000) {
    throw new Error("That is longer than I can read — a paragraph or two is plenty.");
  }

  const supabase = createAdminClient();
  const tags = await getInterestTags();
  const today = new Date().toLocaleDateString("en-CA", { timeZone: TRIP_TZ });

  const { data: run } = await supabase
    .from("agent_runs")
    .insert({
      kind: "intake",
      status: "running",
      input: { description: prose, model: CHAT_MODEL },
    })
    .select("id")
    .single();
  const runId = (run as { id: string } | null)?.id ?? null;

  try {
    const groq = groqClient();

    const completion = await withRateLimitRetry(() =>
      groq.chat.completions.create({
        model: CHAT_MODEL,
        // Extraction is not a judgement call: the same paragraph should give the
        // same spec twice.
        temperature: 0,
        max_tokens: 700,
        reasoning_effort: "low",
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `Turn a traveler's description of a trip into JSON. Today is ${today}.

Return ONLY this object, with null for anything they did not say. Never guess:
a wrong budget is worse than a blank one.

{"title":string|null,"party_size":number|null,"budget":number|null,
 "starts_on":"YYYY-MM-DD"|null,"ends_on":"YYYY-MM-DD"|null,
 "interests":string[],"pace":"relaxed"|"moderate"|"packed"|null,
 "dietary":string[],"mobility":string|null,"style":string|null,
 "unclear":string[]}

interests MUST be chosen from exactly this list, and may be empty:
${tags.join(", ")}

budget is a total number in EUR, digits only — "about 5k" is 5000, "£3,000" is
3000. party_size counts people, so "me and my wife" is 2. Only fill dates they
actually gave; "next spring" is not a date, it is an entry in unclear.
Put anything you could not pin down in unclear, in the traveler's own words.`,
          },
          { role: "user", content: prose },
        ],
      })
    );

    const raw = completion.choices[0]?.message?.content ?? "{}";

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("I could not read that — try describing the trip again.");
    }

    const result = SpecSchema.safeParse(parsed);
    if (!result.success) {
      throw new Error("I could not read that — try describing the trip again.");
    }

    const value = result.data;
    const allowed = new Set(tags);

    const spec: TripSpec = {
      title: value.title?.trim() || null,
      partySize: value.party_size ?? null,
      budget: value.budget ?? null,
      // A date it invented is worse than no date, and the form defaults are
      // sensible; so anything unparseable is dropped rather than passed on.
      startsOn: isDate(value.starts_on) ? value.starts_on! : null,
      endsOn: isDate(value.ends_on) ? value.ends_on! : null,
      // Belt and braces on the tag list: the prompt constrains it, this makes
      // it true.
      interests: (value.interests ?? []).filter((tag) => allowed.has(tag)),
      pace: value.pace ?? null,
      dietary: (value.dietary ?? []).map((d) => d.trim()).filter(Boolean),
      mobility: value.mobility?.trim() || null,
      style: value.style?.trim() || null,
      unclear: (value.unclear ?? []).map((u) => u.trim()).filter(Boolean),
    };

    if (runId) {
      await supabase
        .from("agent_runs")
        .update({
          status: "succeeded",
          output: spec as never,
          input_tokens: completion.usage?.prompt_tokens ?? null,
          output_tokens: completion.usage?.completion_tokens ?? null,
          ended_at: new Date().toISOString(),
        })
        .eq("id", runId);
    }

    return spec;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (runId) {
      await supabase
        .from("agent_runs")
        .update({ status: "failed", error: message, ended_at: new Date().toISOString() })
        .eq("id", runId);
    }
    throw error;
  }
}

function isDate(value: string | null | undefined): boolean {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)));
}
