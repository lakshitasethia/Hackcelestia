import "server-only";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { CHAT_MODEL, resolveModel, withRateLimitRetry } from "./runtime";
import { activeProvider, clientFor } from "./providers";
import type { OpInput } from "./plan";

/**
 * The other half of a vendor conversation.
 *
 * `check_vendor` has always written the outbound message — "Can you take the
 * boat at 09:00 on the 14th?" — so the operator can see what the agent did
 * rather than finding an unexplained booking change. Nothing ever read a reply.
 * The `messages` table was built for both directions from the first migration:
 * `direction`, `from_role` and a `structured` jsonb column whose comment says
 * "Parsed shape of an inbound reply (can_accommodate, alternative_time, ...)".
 * That column has been null for the life of the project.
 *
 * This closes it. A vendor writes back in the way vendors actually write —
 * "sorry, 9 is gone, we could do 2pm, same price, but only 6 people" — and it
 * becomes structured fact, and then, when it changes the plan, an operation the
 * operator can accept.
 *
 * **The extraction is not the interesting part; the mapping is.** A parsed reply
 * that lands in a jsonb column is a nicer log. What makes this the coordination
 * feature the plan called for is that "we can do 2pm not 9am" turns into a
 * `move` op, goes through the same `validateOps`, and is applied by the same
 * `applyProposal` a re-planner's proposal is. One write path, still. The vendor
 * gets no more authority over the itinerary than the model does — a person
 * presses the button either way.
 */

/**
 * What we try to get out of a sentence somebody typed on a phone.
 *
 * Everything is nullable and nothing is inferred. A vendor who does not mention
 * price has not offered a new one, and `price: 0` would be a very expensive way
 * to record "they didn't say". The same rule the intake prompt lives by: a
 * wrong figure is worse than a blank one.
 */
const ReplySchema = z.object({
  can_accommodate: z.boolean().nullish(),
  /** "HH:MM", 24-hour, in the vendor's own local time. */
  alternative_time: z.string().regex(/^\d{2}:\d{2}$/).nullish(),
  alternative_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  price: z.number().nonnegative().nullish(),
  max_party_size: z.number().int().positive().nullish(),
  conditions: z.array(z.string()).nullish(),
  notes: z.string().nullish(),
});

export interface VendorReply {
  canAccommodate: boolean | null;
  alternativeTime: string | null;
  alternativeDate: string | null;
  price: number | null;
  maxPartySize: number | null;
  conditions: string[];
  notes: string | null;
}

const EMPTY: VendorReply = {
  canAccommodate: null,
  alternativeTime: null,
  alternativeDate: null,
  price: null,
  maxPartySize: null,
  conditions: [],
  notes: null,
};

/**
 * Free text to structured fact.
 *
 * The build plan sketched this with Anthropic's `messages.parse` and a zod
 * output format. This project talks to Groq over the OpenAI-compatible chat
 * API, and `intake.ts` already extracts a far larger object that way — JSON
 * response format, temperature 0, then a zod parse of what comes back — so this
 * follows that rather than introducing a second provider and a second style of
 * structured call for one small schema.
 *
 * Temperature 0 because the same message must give the same reading twice: an
 * operator who re-reads a thread and sees a different answer will stop trusting
 * the feature, and rightly.
 */
export async function parseVendorReply(text: string): Promise<VendorReply> {
  const body = text.trim();
  if (!body) return EMPTY;

  const completion = await withRateLimitRetry(() => {
    const provider = activeProvider();
    return clientFor(provider).chat.completions.create({
      model: resolveModel(provider, CHAT_MODEL),
      temperature: 0,
      max_tokens: 400,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `A tour operator asked a supplier whether they can take a booking.
Read the supplier's reply and return ONLY this JSON object:

{"can_accommodate":true|false|null,
 "alternative_time":"HH:MM"|null,
 "alternative_date":"YYYY-MM-DD"|null,
 "price":number|null,
 "max_party_size":number|null,
 "conditions":string[],
 "notes":string|null}

Rules, and they matter more than completeness:

- null means they did not say. Never guess. A supplier who does not mention a
  price has not quoted one, and inventing a number would put a wrong figure in
  front of a customer.
- can_accommodate is true only for a clear yes at the time that was asked
  about. "Not at 9 but we could do 2" is FALSE with an alternative_time of
  "14:00" — they cannot do what was asked.
- alternative_time is 24-hour. "2pm" is "14:00". "half two" is "14:30".
- conditions are short phrases for anything that limits the offer: a deposit,
  a minimum number, weather dependence, a cancellation window.
- notes is one plain sentence for anything a person should read that does not
  fit the fields above. null if there is nothing.`,
        },
        { role: "user", content: body },
      ],
      ...(provider.drop.includes("reasoning_effort")
        ? { reasoning_effort: undefined }
        : { reasoning_effort: "low" }),
    });
  });

  const raw = completion.choices[0]?.message?.content ?? "{}";

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // A reply we cannot read is still a reply. It gets filed as text with no
    // structure rather than throwing away what the vendor said.
    return { ...EMPTY, notes: null };
  }

  const result = ReplySchema.safeParse(parsed);
  if (!result.success) return { ...EMPTY, notes: null };

  const value = result.data;
  return {
    canAccommodate: value.can_accommodate ?? null,
    alternativeTime: value.alternative_time ?? null,
    alternativeDate: value.alternative_date ?? null,
    price: value.price ?? null,
    maxPartySize: value.max_party_size ?? null,
    conditions: (value.conditions ?? []).filter(Boolean),
    notes: value.notes?.trim() || null,
  };
}

/**
 * File a reply against the thread it answers, parsed.
 *
 * The thread key is whatever the outbound message used — `replan:<disruption>`
 * for the re-planner's approaches — so the two halves sit together in one
 * ordered conversation rather than in two unrelated tables.
 */
export async function recordVendorReply(input: {
  threadKey: string;
  body: string;
  tripId?: string | null;
  vendorId?: string | null;
}): Promise<{ id: string; parsed: VendorReply }> {
  const supabase = createAdminClient();
  const parsed = await parseVendorReply(input.body);

  const { data, error } = await supabase
    .from("messages")
    .insert({
      trip_id: input.tripId ?? null,
      vendor_id: input.vendorId ?? null,
      thread_key: input.threadKey,
      direction: "inbound",
      from_role: "vendor",
      body: input.body.trim(),
      structured: parsed as unknown as Record<string, unknown>,
    })
    .select("id")
    .single();

  if (error) throw new Error(`recordVendorReply: ${error.message}`);
  return { id: (data as { id: string }).id, parsed };
}

/**
 * What a reply means for the itinerary, as an operation.
 *
 * Returns an empty list when the reply changes nothing that can be acted on —
 * a flat no, or a yes at the hour already booked. That is the common case and
 * it deliberately produces no proposal: an operator should not be asked to
 * approve "nothing happens".
 *
 * **It emits a wall-clock time, not an instant, and that is the whole point of
 * this function's shape.** The first version built an ISO timestamp here by
 * setting UTC hours — so a supplier in Positano offering "2pm" produced 14:00Z,
 * which is four in the afternoon on the terrace. `validateOps` already converts
 * `local_time` plus a day using the trip's own zone, in the same helper the
 * manual planner uses, and its comment describes exactly that bug happening to
 * the model. One implementation of that rule is the correct number; two is how
 * they drift apart.
 *
 * Two deliberate limits. Only `move` is generated: a supplier offering a
 * different hour is answering the question they were asked, while one
 * volunteering a different *service* is a new option that has to be priced and
 * compared, which is `search_availability`'s job and not a sentence in an
 * email's. And a different *date* is not turned into an operation either — it
 * is recorded, and shown to the operator, because moving a stop across days
 * changes what it depends on and that is a re-plan rather than a reschedule.
 */
export function replyToOps(
  reply: VendorReply,
  item: {
    id: string;
    /** Which day of the trip the stop sits on. */
    day: number;
    /** The stop's current start, as "HH:MM" in the trip's own zone. */
    localTime: string;
  }
): OpInput[] {
  if (!reply.alternativeTime) return [];

  // Same hour it already sits at is not a move, whatever the supplier wrote.
  if (reply.alternativeTime === item.localTime) return [];

  // A new date is a re-plan, not a reschedule. Say nothing rather than move the
  // stop to the right hour on the wrong day.
  if (reply.alternativeDate) return [];

  const because = [
    reply.canAccommodate === false ? "cannot take the original time" : null,
    reply.price !== null ? `quoted ${reply.price}` : null,
    ...reply.conditions,
  ].filter(Boolean);

  return [
    {
      op: "move",
      item_id: item.id,
      day: item.day,
      local_time: reply.alternativeTime,
      reason: `Vendor offered ${reply.alternativeTime}${
        because.length ? ` — ${because.join("; ")}` : ""
      }`,
    },
  ];
}
