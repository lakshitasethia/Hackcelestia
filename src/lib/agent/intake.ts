import "server-only";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { getInterestTags } from "@/lib/db/queries";
import { CHAT_MODEL, resolveModel, withRateLimitRetry } from "./runtime";
import { activeProvider, clientFor } from "./providers";
import { TRIP_TZ, now } from "@/lib/format";
import type { LodgingTier } from "@/lib/db/types";

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
  currency: z.string().nullish(),
  starts_on: z.string().nullish(),
  ends_on: z.string().nullish(),
  /** Where they are travelling FROM, if they said. Not a destination. */
  origin: z.string().nullish(),
  /** Places named, in the traveler's words. Order here is not meaningful — the
   *  composer decides the route; this is only what they asked for. */
  destinations: z.array(z.string()).nullish(),
  /** Things they said were non-negotiable, verbatim. The composer places these
   *  before anything else and reports any it could not honour. */
  must_do: z.array(z.string()).nullish(),
  transport: z.string().nullish(),
  interests: z.array(z.string()).nullish(),
  pace: z.enum(["relaxed", "moderate", "packed"]).nullish(),
  dietary: z.array(z.string()).nullish(),
  mobility: z.string().nullish(),
  style: z.string().nullish(),
  /** Where they want to sleep, in the four brackets the catalogue is graded
   *  in. A free-text answer would not match anything, so this is an enum. */
  lodging: z.enum(["budget", "midrange", "boutique", "luxury"]).nullish(),
  /** What it could not work out, so the form can say so rather than guessing. */
  unclear: z.array(z.string()).nullish(),
});

export type TripSpec = {
  title: string | null;
  partySize: number | null;
  budget: number | null;
  currency: string;
  startsOn: string | null;
  endsOn: string | null;
  origin: string | null;
  destinations: string[];
  mustDo: string[];
  transport: string | null;
  interests: string[];
  pace: "relaxed" | "moderate" | "packed" | null;
  dietary: string[];
  mobility: string | null;
  style: string | null;
  lodging: LodgingTier | null;
  unclear: string[];
};

export async function extractTripSpec(
  description: string,
  /** Who asked, so the run is theirs to read and nobody else's. */
  travelerId?: string | null
): Promise<TripSpec> {
  const prose = description.trim();
  if (!prose) throw new Error("Describe the trip first.");
  if (prose.length > 2000) {
    throw new Error("That is longer than I can read — a paragraph or two is plenty.");
  }

  const supabase = createAdminClient();
  const tags = await getInterestTags();
  // Relative dates in a prompt ("next Tuesday", "in three weeks") resolve
  // against the day the rest of the application believes it is.
  const today = now().toLocaleDateString("en-CA", { timeZone: TRIP_TZ });

  const { data: run } = await supabase
    .from("agent_runs")
    .insert({
      kind: "intake",
      status: "running",
      traveler_id: travelerId ?? null,
      input: { description: prose, model: CHAT_MODEL },
    })
    .select("id")
    .single();
  const runId = (run as { id: string } | null)?.id ?? null;

  try {
    const completion = await withRateLimitRetry(() => {
      // Resolved per attempt so a mid-call failover is picked up. Intake is on
      // the demo path — /plan calls it before anything else exists — so it is
      // the worst single call in the product to lose to a spent budget.
      const provider = activeProvider();
      return clientFor(provider).chat.completions.create({
        model: resolveModel(provider, CHAT_MODEL),
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
 "currency":"INR"|"EUR"|"USD"|"GBP"|"CHF"|"JPY"|"AUD"|"CAD"|"SGD"|"AED"|"THB"|null,
 "starts_on":"YYYY-MM-DD"|null,"ends_on":"YYYY-MM-DD"|null,
 "origin":string|null,"destinations":string[],"must_do":string[],
 "transport":string|null,
 "interests":string[],"pace":"relaxed"|"moderate"|"packed"|null,
 "dietary":string[],"mobility":string|null,"style":string|null,
 "lodging":"budget"|"midrange"|"boutique"|"luxury"|null,
 "unclear":string[]}

interests MUST be chosen from exactly this list, and may be empty:
${tags.join(", ")}

origin is where they are STARTING FROM, and it is never a destination.
"a trip from India to Switzerland" is origin "India", destinations
["Switzerland"] — planning days in Delhi for that traveler would be a
straightforward misreading of the sentence. Only fill it when they actually
say where they are leaving from; "flying out of Mumbai" is an origin,
"a trip around Kerala" is not.

destinations is every place they want to GO, one per entry, spelling corrected
("Rishikesh", not "rishikeshh"). A country counts: "Switzerland" is a perfectly
good destination and the planner will work out which towns. Do NOT reorder them,
do NOT invent any, and never repeat the origin here. If they said they do not
know the order, that is not an entry in unclear — deciding the order is the
planner's job, not theirs.

must_do is everything they called compulsory, non-negotiable, or said they
"want to" or "need to" do, in their own words: "river rafting in Rishikesh",
"stay in tents in Chopta". These are commitments, not preferences.

transport is how they want to travel between places — "trains", "flights",
"road" — or null.

budget is a total number, digits only, and currency says which currency it is
in. Read the SYMBOL or word they used, not the destination: ₹ or "rs" or "lakh"
means INR even for a trip to Zurich, because that is the money they are
counting in. "about 5k" is 5000, "2 lakh" is 200000.
For a RANGE like "30000 to 35000", take the UPPER number — it is their ceiling.
A budget you can read is never an entry in unclear.

party_size counts people, so "me and my wife" is 2; if they say nothing, leave
it null rather than assuming 1. Only fill dates they actually gave; "next
spring" is not a date, it is an entry in unclear. Dates without a year mean the
next such date in the future.
Put anything you genuinely could not pin down in unclear, in their own words.

pace, mobility and dietary are stated in passing, never as labels, and all
three are easy to read straight past. "Nothing rushed" or "take it slow" is
pace relaxed; "we want to see everything" is packed. "She can't manage steep
steps" is mobility, in their own words. "No meat for two of us" is a dietary
entry. Fill each one whenever they said something about it.

lodging is where they want to sleep, and only when they said: "hostel" or
"cheap" is budget, "a decent hotel" is midrange, "somewhere with character" is
boutique, "five star" or "splurge" is luxury. A budget figure is not a lodging
preference, and null is the right answer when they did not mention a room.`,
          },
          { role: "user", content: prose },
        ],
        // gpt-oss's reasoning knob; Mistral rejects it outright.
        ...(provider.drop.includes("reasoning_effort")
          ? { reasoning_effort: undefined }
          : {}),
      });
    });

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
      // The catalogue is priced in one currency per region; anything the model
      // did not recognise falls back to INR rather than silently being read as
      // euros, which is the bug this replaced.
      currency: normaliseCurrency(value.currency),
      // A date it invented is worse than no date, and the form defaults are
      // sensible; so anything unparseable is dropped rather than passed on.
      startsOn: isDate(value.starts_on) ? value.starts_on! : null,
      endsOn: isDate(value.ends_on) ? value.ends_on! : null,
      origin: value.origin?.trim() || null,
      // Belt and braces on the prompt's "never repeat the origin here": a
      // destination list that still contains "India" sends the research pass
      // looking for Swiss towns in the wrong country.
      destinations: dedupe(value.destinations ?? []).filter(
        (d) => d.toLowerCase() !== value.origin?.trim().toLowerCase()
      ),
      mustDo: (value.must_do ?? []).map((m) => m.trim()).filter(Boolean),
      transport: value.transport?.trim() || null,
      // Belt and braces on the tag list: the prompt constrains it, this makes
      // it true.
      interests: (value.interests ?? []).filter((tag) => allowed.has(tag)),
      pace: value.pace ?? null,
      dietary: (value.dietary ?? []).map((d) => d.trim()).filter(Boolean),
      mobility: value.mobility?.trim() || null,
      style: value.style?.trim() || null,
      lodging: value.lodging ?? null,
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

/**
 * The currencies a budget can be stated in.
 *
 * Was four, which quietly read a Swiss trip's CHF budget as rupees — the
 * fallback below is deliberate and was right when every trip was Indian, and
 * silently wrong the moment one was not. This is the traveler's *budget*
 * currency, which is not the destination's: somebody in Delhi planning
 * Switzerland thinks in rupees and pays in francs, and the research pass
 * reports its own currency separately for exactly that reason.
 */
const CURRENCIES = new Set([
  "INR", "EUR", "USD", "GBP", "CHF", "JPY", "AUD", "CAD", "SGD", "AED", "THB",
]);

function normaliseCurrency(value: string | null | undefined): string {
  const code = value?.trim().toUpperCase();
  return code && CURRENCIES.has(code) ? code : "INR";
}

/** Case-insensitive, order-preserving. "Delhi" and "delhi" are one place. */
function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = raw.trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function isDate(value: string | null | undefined): boolean {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)));
}
