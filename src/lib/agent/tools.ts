import "server-only";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { getBlastRadius } from "@/lib/db/queries";
import { findCandidates } from "@/lib/disruption/engine";
import { formatTime } from "@/lib/format";
import { defineTool, traced, type AgentTool, type StepRecorder } from "./tool";
import { opSchema, validateOps } from "./plan";
import type { Assessment, Candidate } from "@/lib/disruption/engine";

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
 *
 * The tool *plumbing* — validation, tracing, JSON Schema emission — lives in
 * `tool.ts`, and the plan validator in `plan.ts`, because the concierge holds
 * itself to the same rules. What is left here is only what is specific to
 * re-planning around a break.
 */

export function buildTools(
  assessment: Assessment,
  record: StepRecorder
): AgentTool[] {
  const tripId = assessment.disruption.trip_id;

  const getBlastRadiusTool = defineTool({
    name: "get_blast_radius",
    description:
      "Items affected by a break, with dependency depth. Depth 0 is the break itself. Anything absent is unaffected — do not touch it.",
    inputSchema: z.object({
      item_id: z.string().describe("The itinerary item that broke"),
    }),
    run: traced("get_blast_radius", record, async ({ item_id }) => {
      const items = await getBlastRadius(item_id);
      // Fields are chosen for what changes a decision. Every extra key here is
      // resent on every later iteration and this run has 8000 tokens a minute.
      return items.map((i) => ({
        item_id: i.id,
        title: i.title,
        depth: i.depth,
        starts_at: i.starts_at,
        cost: Number(i.cost),
        ...(i.lock_reason ? { locked: i.lock_reason } : {}),
      }));
    }),
  });

  const searchAvailabilityTool = defineTool({
    name: "search_availability",
    description:
      "Replacements for a broken item, same date. Already excludes options that cannot survive the cause and anything already on the itinerary.",
    inputSchema: z.object({
      item_id: z.string().describe("The item you are replacing"),
      max_results: z.number().optional().describe("Default 4"),
    }),
    run: traced("search_availability", record, async ({ item_id, max_results }) => {
      const root =
        assessment.affected.find((i) => i.id === item_id) ?? assessment.root;
      if (!root) return { error: "Unknown item_id" };

      const candidates = await findCandidates(root, assessment.disruption.source);
      return candidates.slice(0, max_results ?? 4).map(describeCandidate);
    }),
  });

  const priceOptionTool = defineTool({
    name: "price_option",
    description:
      "Net cost of a swap, including the forfeited deposit. Positive means the traveler pays more.",
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

  const checkVendorTool = defineTool({
    name: "check_vendor",
    description:
      "Check a vendor can take a slot. 'auto' confirms instantly; 'manual' needs an operator to phone, so that plan cannot complete unattended.",
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

  /**
   * The real bookable slot for each candidate, from the availability search.
   *
   * Handed to the shared validator so a `replace` the model left timeless is
   * filled in with a slot that actually exists, rather than bounced back over a
   * field it can only guess at.
   */
  const slotHints = new Map(
    assessment.candidates.map((c) => [c.inventory.id, c.startsAt])
  );

  const proposeReplanTool = defineTool({
    name: "propose_replan",
    description:
      "Record one alternative plan as a DRAFT for a human to accept. Call once per distinct option. Never changes the live itinerary.",
    inputSchema: z.object({
      summary: z.string().describe("one line naming the trade-off"),
      rationale: z.string().describe("max 2 short sentences"),
      cost_delta: z.number().describe("net EUR change, negative if cheaper"),
      operations: z.array(opSchema).min(1),
    }),
    run: traced("propose_replan", record, async (input) => {
      const supabase = createAdminClient();

      const { errors, normalised, costDelta } = await validateOps(
        tripId,
        input.operations,
        { slotHints }
      );
      if (errors.length) {
        // Rejected, not stored. Returning the specific problems lets the model
        // fix them; storing them would put wrong dates in front of an operator.
        return {
          rejected: true,
          errors,
          hint: "Fix these and call propose_replan again.",
        };
      }

      const { data, error } = await supabase
        .from("replan_proposals")
        .insert({
          disruption_id: assessment.disruption.id,
          // Denormalised alongside the disruption so every surface can find a
          // proposal by trip, whether or not a break is what caused it.
          trip_id: tripId,
          source: "replan",
          plan: normalised,
          // The computed figure, not the model's claim.
          cost_delta: costDelta,
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
        // Surfaced so the model can correct its summary when its own maths was
        // off, rather than narrating a number the operator will not see.
        cost_delta_computed: costDelta,
        ...(Math.abs(costDelta - input.cost_delta) > 1
          ? {
              note: `Your cost_delta of ${input.cost_delta} was wrong; the recorded figure is ${costDelta}. Use it in your summary.`,
            }
          : {}),
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
    vendor: c.vendorName,
    channel: c.channel,
    starts_at: c.startsAt,
    duration_min: c.inventory.duration_min,
    price: c.price,
    distance_km: c.distanceKm,
    tags: c.inventory.tags,
  };
}
