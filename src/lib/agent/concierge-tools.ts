import "server-only";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { defineTool, traced, type AgentTool, type StepRecorder } from "./tool";
import { opSchema, validateOps } from "./plan";
import { formatMoney, formatTime } from "@/lib/format";
import type { ReplanOp, Trip } from "@/lib/db/types";

/**
 * The concierge's tools.
 *
 * Two of them, and that is deliberate. The opening brief already carries the
 * whole itinerary and the whole catalogue — eighteen rows, cheaper to send than
 * to fetch — so the common request resolves in a single round trip: read the
 * brief, call propose_change, answer. A tool call the model does not have to
 * make is four seconds nobody spends staring at a typing indicator, and this is
 * the one agent a person is actually waiting on.
 *
 * What is left is the thing the brief cannot hold (live seat counts, which turn
 * over) and the thing that has to be written down (the proposal).
 */

/** The calendar date a trip day falls on. Day 1 is the start date. */
export function dateOfDay(startsOn: string, day: number): string {
  const date = new Date(`${startsOn}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + (day - 1));
  return date.toISOString().slice(0, 10);
}

export function buildConciergeTools(
  trip: Trip,
  record: StepRecorder
): AgentTool[] {
  const searchCatalogue = defineTool({
    name: "search_catalogue",
    description:
      "Bookable options with live seat counts for a given day. Use before proposing an addition when you need to know something is actually available.",
    inputSchema: z.object({
      day: z.number().describe("Which day of the trip"),
      query: z
        .string()
        .optional()
        .describe("Words to match against title, type, tags"),
      max_results: z.number().optional().describe("Default 6"),
    }),
    run: traced("search_catalogue", record, async ({ day, query, max_results }) => {
      const supabase = createAdminClient();
      const date = dateOfDay(trip.starts_on ?? "", day);

      const [{ data: rows }, { data: planned }] = await Promise.all([
        supabase
          .from("inventory")
          .select("*, vendors(name, channel)")
          .order("title"),
        // Something already on the itinerary is not something to add to it.
        supabase
          .from("itinerary_items")
          .select("inventory_id")
          .eq("trip_id", trip.id)
          .not("inventory_id", "is", null)
          .not("status", "in", "(cancelled,replaced)"),
      ]);

      const already = new Set(
        ((planned ?? []) as { inventory_id: string | null }[])
          .map((p) => p.inventory_id)
          .filter((id): id is string => Boolean(id))
      );

      type Row = {
        id: string;
        title: string;
        type: string;
        description: string | null;
        duration_min: number;
        base_cost: number;
        opens_at: string | null;
        tags: string[] | null;
        vendors: { name: string; channel: string } | null;
      };

      const terms = (query ?? "")
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean);

      const scored = ((rows ?? []) as unknown as Row[])
        .filter((row) => !already.has(row.id))
        .map((row) => {
          const haystack = [
            row.title,
            row.type,
            row.description ?? "",
            ...(row.tags ?? []),
          ]
            .join(" ")
            .toLowerCase();
          return {
            row,
            score: terms.filter((t) => haystack.includes(t)).length,
          };
        })
        // With no query every option is equally relevant, so nothing is cut.
        .filter((s) => terms.length === 0 || s.score > 0)
        .sort((a, b) => b.score - a.score);

      if (scored.length === 0) {
        return {
          date,
          results: [],
          note: "Nothing in the catalogue matches. Say so plainly rather than inventing an option.",
        };
      }

      const ids = scored.slice(0, max_results ?? 6).map((s) => s.row.id);
      const { data: slots } = await supabase
        .from("availability")
        .select("inventory_id, starts_at, slots_total, slots_taken, price")
        .eq("date", date)
        .in("inventory_id", ids);

      const slotFor = new Map(
        ((slots ?? []) as {
          inventory_id: string;
          starts_at: string;
          slots_total: number;
          slots_taken: number;
          price: number | null;
        }[]).map((s) => [s.inventory_id, s])
      );

      return {
        date,
        results: scored.slice(0, max_results ?? 6).map(({ row }) => {
          const slot = slotFor.get(row.id);
          return {
            inventory_id: row.id,
            title: row.title,
            type: row.type,
            vendor: row.vendors?.name,
            price: Number(slot?.price ?? row.base_cost),
            duration_min: row.duration_min,
            tags: row.tags ?? [],
            // A vendor with no published row for that date is not a refusal —
            // it is a stop the office books by phone, which the operator sees
            // as `held` rather than confirmed.
            seats_free: slot ? slot.slots_total - slot.slots_taken : null,
            usual_start: slot
              ? formatTime(slot.starts_at)
              : row.opens_at?.slice(0, 5) ?? null,
          };
        }),
      };
    }),
  });

  const proposeChange = defineTool({
    name: "propose_change",
    description:
      "Write the change down as a DRAFT for the traveler to accept. Nothing happens to the itinerary until they do. Call this once you know what you would change.",
    inputSchema: z.object({
      summary: z.string().describe("one short line, what changes"),
      rationale: z.string().describe("one or two sentences, why"),
      operations: z.array(opSchema).min(1),
    }),
    run: traced("propose_change", record, async (input) => {
      const supabase = createAdminClient();

      // Same validator the re-planner is held to. A traveler's request and a
      // storm recovery are applied by identical code, so they are checked by
      // identical code.
      const { errors, normalised, costDelta } = await validateOps(
        trip.id,
        input.operations,
        // A stop the operator is mid-way through re-planning is not the
        // traveler's to move out from under them.
        { refuseAtRisk: true }
      );

      if (errors.length) {
        return {
          rejected: true,
          errors,
          hint: "Fix these and call propose_change again. Do not describe the change as done.",
        };
      }

      const { data, error } = await supabase
        .from("replan_proposals")
        .insert({
          // No disruption: nothing broke, the traveler simply asked.
          trip_id: trip.id,
          source: "concierge",
          plan: normalised,
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
        // Handed back so the model quotes the computed figure rather than one
        // it estimated. It is the number the traveler will see on the card.
        cost_delta: costDelta,
        cost_delta_human:
          costDelta === 0
            ? "no change to the total"
            : `${costDelta > 0 ? "adds" : "saves"} ${formatMoney(
                Math.abs(costDelta),
                trip.currency
              )}`,
        awaiting: "the traveler's confirmation",
      };
    }),
  });

  return [searchCatalogue, proposeChange];
}

/**
 * One operation in the words a traveler would use.
 *
 * Lives beside the tools rather than in the component because the chat card,
 * the itinerary card and the tests all have to describe a plan identically —
 * a proposal that reads one way when offered and another when reviewed is how
 * someone accepts a change they did not mean to.
 */
export function describeOp(
  op: ReplanOp,
  itemTitles: Map<string, string>,
  catalogueTitles: Map<string, string>
): string {
  const stop = (id: string) => itemTitles.get(id) ?? "a stop";
  const option = (id: string) => catalogueTitles.get(id) ?? "another option";

  switch (op.op) {
    case "drop":
      return `Remove ${stop(op.item_id)}`;
    case "move":
      return `Move ${stop(op.item_id)} to ${formatTime(op.starts_at)}`;
    case "replace":
      return `Swap ${stop(op.item_id)} for ${option(op.with_inventory_id)}, ${formatTime(op.starts_at)}`;
    case "add":
      return `Add ${option(op.inventory_id)} on day ${op.day}, ${formatTime(op.starts_at)}`;
  }
}
