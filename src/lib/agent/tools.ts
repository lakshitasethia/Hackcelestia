import "server-only";
import { z } from "zod";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { getBlastRadius } from "@/lib/db/queries";
import { findCandidates } from "@/lib/disruption/engine";
import { formatTime } from "@/lib/format";
import type { Assessment, Candidate } from "@/lib/disruption/engine";
import type { ReplanOp } from "@/lib/db/types";

/**
 * The re-planner's tools.
 *
 * Every one of these wraps a function that already existed and was already
 * tested on Day 4. That is the point: the agent gets no privileged path to the
 * database and cannot invent an itinerary state, so when a proposal is wrong we
 * can tell whether the tools lied or the model misread them.
 *
 * Each call is written to `agent_steps` as it happens, which is what the trace
 * panel renders. The recorder is passed in rather than imported so a run can be
 * traced or not without changing the tools.
 */

export type StepRecorder = (step: {
  tool: string;
  input: unknown;
  output: unknown;
  ms: number;
}) => Promise<void>;

/** Wraps a tool body so every call is timed and recorded, including failures —
 *  a tool that threw is exactly the kind of thing you want in the trace. */
function traced<I, O>(
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

const opSchema = z.object({
  op: z.enum(["drop", "move", "replace", "add"]),
  item_id: z.string().optional().describe("Existing itinerary item, for drop/move/replace"),
  with_inventory_id: z.string().optional().describe("Catalogue item to swap in, for replace/add"),
  day: z.number().optional().describe("Trip day number, for add"),
  starts_at: z.string().optional().describe("ISO 8601 UTC start, for move/replace/add"),
  ends_at: z.string().optional().describe("ISO 8601 UTC end, for move/replace/add"),
  depends_on: z.array(z.string()).optional().describe("Item ids this new stop needs, for add"),
  reason: z.string().describe("Why this operation, in one sentence a traveler would understand"),
});

export function buildTools(assessment: Assessment, record: StepRecorder) {
  const tripId = assessment.disruption.trip_id;

  const getBlastRadiusTool = betaZodTool({
    name: "get_blast_radius",
    description:
      "List every itinerary item affected by a broken item, with how many dependency hops away each one sits. Depth 0 is the broken item itself. Items NOT in this list are unaffected and must not be changed.",
    inputSchema: z.object({
      item_id: z.string().describe("The itinerary item that broke"),
    }),
    run: traced("get_blast_radius", record, async ({ item_id }) => {
      const items = await getBlastRadius(item_id);
      return items.map((i) => ({
        item_id: i.id,
        title: i.title,
        type: i.type,
        depth: i.depth,
        starts_at: i.starts_at,
        ends_at: i.ends_at,
        cost: Number(i.cost),
        locked: Boolean(i.lock_reason),
        lock_reason: i.lock_reason,
      }));
    }),
  });

  const searchAvailabilityTool = betaZodTool({
    name: "search_availability",
    description:
      "Find bookable replacements for a broken item on the same date. Results already exclude options that cannot survive the cause (weather-sensitive options during a weather disruption) and anything already on this itinerary.",
    inputSchema: z.object({
      item_id: z.string().describe("The item you are replacing"),
      max_results: z.number().optional().describe("Default 8"),
    }),
    run: traced("search_availability", record, async ({ item_id, max_results }) => {
      const root =
        assessment.affected.find((i) => i.id === item_id) ?? assessment.root;
      if (!root) return { error: "Unknown item_id" };

      const candidates = await findCandidates(root, assessment.disruption.source);
      return candidates.slice(0, max_results ?? 8).map(describeCandidate);
    }),
  });

  const priceOptionTool = betaZodTool({
    name: "price_option",
    description:
      "Net cost of swapping one itinerary item for a catalogue option, including what is lost on the cancelled booking. A positive delta costs the traveler more.",
    inputSchema: z.object({
      item_id: z.string().describe("Item being replaced"),
      with_inventory_id: z.string().describe("Catalogue item swapping in"),
    }),
    run: traced("price_option", record, async ({ item_id, with_inventory_id }) => {
      const supabase = createAdminClient();

      const [{ data: item }, { data: replacement }, { data: booking }] =
        await Promise.all([
          supabase.from("itinerary_items").select("cost, title").eq("id", item_id).maybeSingle(),
          supabase.from("inventory").select("base_cost, title").eq("id", with_inventory_id).maybeSingle(),
          supabase.from("bookings").select("penalty").eq("item_id", item_id).maybeSingle(),
        ]);

      if (!item || !replacement) return { error: "Unknown item or inventory id" };

      const current = Number((item as { cost: number }).cost);
      const swap = Number((replacement as { base_cost: number }).base_cost);
      const penalty = Number((booking as { penalty: number } | null)?.penalty ?? 0);

      return {
        current_cost: current,
        replacement_cost: swap,
        cancellation_penalty: penalty,
        // Refund what was paid, pay the penalty, pay for the replacement.
        net_delta: Math.round((swap - current + penalty) * 100) / 100,
        note:
          penalty > 0
            ? `Cancelling ${(item as { title: string }).title} forfeits ${penalty}.`
            : "This booking cancels without penalty.",
      };
    }),
  });

  const checkVendorTool = betaZodTool({
    name: "check_vendor",
    description:
      "Ask whether a vendor can take a booking. Vendors on the 'auto' channel confirm instantly; 'manual' vendors need an operator to phone them, so a plan that depends on one cannot complete unattended.",
    inputSchema: z.object({
      inventory_id: z.string(),
      starts_at: z.string().describe("ISO 8601 UTC start time you want"),
    }),
    run: traced("check_vendor", record, async ({ inventory_id, starts_at }) => {
      const supabase = createAdminClient();

      const { data } = await supabase
        .from("inventory")
        .select("title, vendors(id, name, channel, reliability)")
        .eq("id", inventory_id)
        .maybeSingle();

      const row = data as unknown as {
        title: string;
        vendors: { id: string; name: string; channel: string; reliability: number } | null;
      } | null;
      if (!row?.vendors) return { error: "Unknown inventory_id" };

      const date = starts_at.slice(0, 10);
      const { data: slots } = await supabase
        .from("availability")
        .select("slots_total, slots_taken")
        .eq("inventory_id", inventory_id)
        .eq("date", date);

      const free = ((slots ?? []) as { slots_total: number; slots_taken: number }[])
        .reduce((sum, s) => sum + (s.slots_total - s.slots_taken), 0);

      const canAccommodate = free > 0;

      // Record the approach as an outbound message, so the operator sees the
      // agent's contact trail rather than an unexplained booking change.
      await supabase.from("messages").insert({
        trip_id: tripId,
        vendor_id: row.vendors.id,
        thread_key: `replan:${assessment.disruption.id}`,
        direction: "outbound",
        from_role: "agent",
        body: `Can you take ${row.title} at ${formatTime(starts_at)} on ${date}?`,
        structured: { inventory_id, starts_at, free },
      });

      return {
        vendor: row.vendors.name,
        channel: row.vendors.channel,
        reliability: Number(row.vendors.reliability),
        slots_free: free,
        can_accommodate: canAccommodate,
        needs_human: row.vendors.channel === "manual",
      };
    }),
  });

  const proposeReplanTool = betaZodTool({
    name: "propose_replan",
    description:
      "Record one complete alternative plan for a human to accept or reject. Call it more than once to offer genuinely different options. This writes a DRAFT — it never changes the live itinerary.",
    inputSchema: z.object({
      summary: z.string().describe("One line naming the trade-off, e.g. 'Cheapest option, loses the sea day'"),
      rationale: z.string().describe("Two or three sentences a traveler would understand, referencing cost and what was preserved"),
      cost_delta: z.number().describe("Net change in EUR, negative if cheaper"),
      operations: z.array(opSchema).min(1),
    }),
    run: traced("propose_replan", record, async (input) => {
      const supabase = createAdminClient();

      const { data, error } = await supabase
        .from("replan_proposals")
        .insert({
          disruption_id: assessment.disruption.id,
          plan: input.operations as unknown as ReplanOp[],
          cost_delta: input.cost_delta,
          rationale: `${input.summary}\n\n${input.rationale}`,
          state: "draft",
        })
        .select("id")
        .single();

      if (error) return { error: error.message };
      return {
        proposal_id: (data as { id: string }).id,
        recorded: true,
        operations: input.operations.length,
      };
    }),
  });

  return [
    getBlastRadiusTool,
    searchAvailabilityTool,
    priceOptionTool,
    checkVendorTool,
    proposeReplanTool,
  ];
}

function describeCandidate(c: Candidate) {
  return {
    inventory_id: c.inventory.id,
    title: c.inventory.title,
    type: c.inventory.type,
    vendor: c.vendorName,
    channel: c.channel,
    starts_at: c.startsAt,
    duration_min: c.inventory.duration_min,
    price: c.price,
    slots_free: c.slotsFree,
    distance_km: c.distanceKm,
    tags: c.inventory.tags,
  };
}
