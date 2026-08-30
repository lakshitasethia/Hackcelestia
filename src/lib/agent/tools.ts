import "server-only";
import { z } from "zod";
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
 *
 * Definitions are provider-neutral on purpose: a name, a description, a JSON
 * Schema, and a function. Schemas are declared in Zod and emitted as JSON
 * Schema, so arguments are still validated locally whichever vendor is driving
 * the loop — and swapping vendors touches the loop, never these.
 */

export interface AgentTool {
  name: string;
  description: string;
  /** JSON Schema, the format every current provider accepts. */
  parameters: Record<string, unknown>;
  run: (input: unknown) => Promise<string>;
}

/** Validates against the Zod schema, then hands off to the implementation. */
function defineTool<S extends z.ZodType>(spec: {
  name: string;
  description: string;
  inputSchema: S;
  run: (input: z.infer<S>) => Promise<string>;
}): AgentTool {
  return {
    name: spec.name,
    description: spec.description,
    parameters: z.toJSONSchema(spec.inputSchema) as Record<string, unknown>,
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

/** Descriptions are terse because this schema is nested inside propose_replan
 *  and therefore resent on every iteration of a token-capped loop. */
const opSchema = z.object({
  op: z.enum(["drop", "move", "replace", "add"]),
  item_id: z.string().optional().describe("itinerary item; drop/move/replace"),
  with_inventory_id: z.string().optional().describe("catalogue item; replace/add"),
  day: z.number().optional().describe("trip day; add"),
  starts_at: z.string().optional().describe("ISO UTC; move/replace/add"),
  ends_at: z.string().optional().describe("ISO UTC; move/replace/add"),
  depends_on: z.array(z.string()).optional().describe("prerequisite item ids; add"),
  reason: z.string().describe("max 12 words"),
});

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
   * Deterministic gate on the model's output.
   *
   * A 20B-class open model produces structurally valid but factually wrong
   * plans — in testing it invented dates three years off, put an inventory id
   * in an item_id field, and named the wrong day. None of that is fixable by
   * asking nicely in a prompt, and all of it would have been applied silently.
   * So the plan is checked against the real itinerary before it is stored, and
   * failures come back as errors the model can correct on its next turn.
   */
  const validateOps = async (
    ops: z.infer<typeof opSchema>[]
  ): Promise<{ errors: string[]; normalised: ReplanOp[]; costDelta: number }> => {
    const supabase = createAdminClient();
    const errors: string[] = [];

    const [{ data: items }, { data: inventory }, { data: trip }, { data: bookings }] =
      await Promise.all([
        supabase
          .from("itinerary_items")
          .select("id, day, cost, starts_at, ends_at")
          .eq("trip_id", tripId),
        supabase.from("inventory").select("id, base_cost, duration_min"),
        supabase.from("trips").select("starts_on, ends_on").eq("id", tripId).single(),
        supabase.from("bookings").select("item_id, penalty").eq("trip_id", tripId),
      ]);

    const itemRows = (items ?? []) as {
      id: string;
      cost: number;
      starts_at: string;
      ends_at: string;
    }[];
    const inventoryRows = (inventory ?? []) as {
      id: string;
      base_cost: number;
      duration_min: number;
    }[];
    const itemIds = new Set(itemRows.map((i) => i.id));
    const inventoryIds = new Set(inventoryRows.map((i) => i.id));

    const costOf = new Map(itemRows.map((i) => [i.id, Number(i.cost)]));
    const startOf = new Map(itemRows.map((i) => [i.id, i.starts_at]));
    const priceOf = new Map(inventoryRows.map((i) => [i.id, Number(i.base_cost)]));
    const durationOf = new Map(
      inventoryRows.map((i) => [i.id, Number(i.duration_min)])
    );
    /** The real bookable slot for a candidate, from the availability search. */
    const slotOf = new Map(
      assessment.candidates.map((c) => [c.inventory.id, c.startsAt])
    );
    const penaltyOf = new Map(
      ((bookings ?? []) as { item_id: string | null; penalty: number }[])
        .filter((b) => b.item_id)
        .map((b) => [b.item_id as string, Number(b.penalty)])
    );
    const window = trip as { starts_on: string; ends_on: string } | null;

    // One day either side, so an overnight stop at the edge is not rejected.
    const from = window ? new Date(`${window.starts_on}T00:00:00Z`).getTime() - 86_400_000 : 0;
    const to = window ? new Date(`${window.ends_on}T00:00:00Z`).getTime() + 2 * 86_400_000 : Infinity;

    const inWindow = (iso: string | undefined, label: string, idx: number) => {
      if (!iso) return;
      const t = new Date(iso).getTime();
      if (Number.isNaN(t)) {
        errors.push(`op ${idx}: ${label} "${iso}" is not a valid ISO 8601 timestamp.`);
      } else if (t < from || t > to) {
        errors.push(
          `op ${idx}: ${label} "${iso}" is outside the trip (${window?.starts_on} to ${window?.ends_on}). Use dates from the brief.`
        );
      }
    };

    const normalised: ReplanOp[] = [];
    /**
     * Recomputed rather than taken from the model.
     *
     * In testing it reported +280 EUR on a plan that actually came to -390 —
     * a 670 EUR error, shown to an operator as fact. Cancelling refunds the
     * item and forfeits its deposit; a swap pays the difference plus that
     * deposit; an addition is its own price.
     */
    let costDelta = 0;

    ops.forEach((op, idx) => {
      inWindow(op.starts_at, "starts_at", idx);
      inWindow(op.ends_at, "ends_at", idx);

      if (op.op === "drop" || op.op === "move" || op.op === "replace") {
        if (!op.item_id) {
          errors.push(`op ${idx}: "${op.op}" needs item_id.`);
        } else if (!itemIds.has(op.item_id)) {
          errors.push(`op ${idx}: item_id "${op.item_id}" is not on this itinerary.`);
        }
      }

      if (op.op === "replace" || op.op === "add") {
        // The model routinely puts the catalogue id in the wrong field, so
        // accept either and normalise rather than rejecting on a technicality.
        const invId = op.with_inventory_id ?? op.item_id;
        if (!invId || !inventoryIds.has(invId)) {
          errors.push(
            `op ${idx}: "${op.op}" needs a catalogue id in with_inventory_id. Got "${invId ?? "nothing"}".`
          );
        }
      }

      if (op.op === "add" && op.day === undefined) {
        errors.push(`op ${idx}: "add" needs day.`);
      }

      if (errors.length) return;

      /**
       * Times the model left out, filled in from data rather than rejected.
       *
       * A replace has an unambiguous correct answer — the substitute goes in
       * its real bookable slot, or failing that where the broken stop sat, and
       * runs for the catalogue duration. Bouncing the plan back over a field
       * the model can only guess at costs a round trip against an 8000
       * token-per-minute budget, and it guesses dates badly: that is what the
       * window check above exists to catch.
       *
       * A `move` or an `add` gets no such default. For those the time *is* the
       * decision, and inventing one would be putting a number in front of an
       * operator that nobody chose.
       */
      const resolveWindow = (): { startsAt?: string; endsAt?: string } => {
        const invId = op.with_inventory_id ?? op.item_id;
        let startsAt = op.starts_at;

        if (!startsAt && op.op === "replace") {
          startsAt = slotOf.get(invId ?? "") ?? startOf.get(op.item_id ?? "");
        }
        if (!startsAt) return { startsAt: op.starts_at, endsAt: op.ends_at };

        let endsAt = op.ends_at;
        if (!endsAt) {
          const minutes = durationOf.get(invId ?? "") ?? 60;
          endsAt = new Date(
            new Date(startsAt).getTime() + minutes * 60_000
          ).toISOString();
        }
        return { startsAt, endsAt };
      };

      const { startsAt, endsAt } = resolveWindow();

      // Whatever we could not resolve is a hard error. Storing an operation
      // with no time produced a proposal that looked fine on screen and then
      // failed at apply time, leaving the itinerary with a replaced stop and
      // nothing in its place.
      if (op.op !== "drop") {
        if (!startsAt) errors.push(`op ${idx}: "${op.op}" needs starts_at (ISO 8601 UTC).`);
        if (!endsAt) errors.push(`op ${idx}: "${op.op}" needs ends_at (ISO 8601 UTC).`);
        else if (startsAt && new Date(endsAt) <= new Date(startsAt)) {
          errors.push(`op ${idx}: ends_at must be after starts_at.`);
        }
      }

      if (errors.length) return;

      const penalty = op.item_id ? penaltyOf.get(op.item_id) ?? 0 : 0;
      const oldCost = op.item_id ? costOf.get(op.item_id) ?? 0 : 0;
      const newPrice = priceOf.get(op.with_inventory_id ?? op.item_id ?? "") ?? 0;

      if (op.op === "drop") costDelta += penalty - oldCost;
      else if (op.op === "replace") costDelta += newPrice - oldCost + penalty;
      else if (op.op === "add") costDelta += newPrice;

      if (op.op === "drop") {
        normalised.push({ op: "drop", item_id: op.item_id!, reason: op.reason });
      } else if (op.op === "move") {
        normalised.push({
          op: "move",
          item_id: op.item_id!,
          starts_at: startsAt!,
          ends_at: endsAt!,
          reason: op.reason,
        });
      } else if (op.op === "replace") {
        normalised.push({
          op: "replace",
          item_id: op.item_id!,
          with_inventory_id: (op.with_inventory_id ?? op.item_id)!,
          starts_at: startsAt!,
          ends_at: endsAt!,
          reason: op.reason,
        });
      } else {
        normalised.push({
          op: "add",
          inventory_id: (op.with_inventory_id ?? op.item_id)!,
          day: op.day!,
          starts_at: startsAt!,
          ends_at: endsAt!,
          depends_on: op.depends_on ?? [],
          reason: op.reason,
        });
      }
    });

    return {
      errors,
      normalised,
      costDelta: Math.round(costDelta * 100) / 100,
    };
  };

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

      const { errors, normalised, costDelta } = await validateOps(input.operations);
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
