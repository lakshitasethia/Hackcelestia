import "server-only";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { TRIP_TZ, zonedTime } from "@/lib/format";
import type { ReplanOp } from "@/lib/db/types";

/**
 * The deterministic gate on anything a model proposes.
 *
 * A 20B-class open model produces structurally valid but factually wrong
 * plans — in testing it invented dates three years off, put an inventory id in
 * an item_id field, and named the wrong day. None of that is fixable by asking
 * nicely in a prompt, and all of it would have been applied silently. So a plan
 * is checked against the real itinerary before it is stored, and failures come
 * back as errors the model can correct on its next turn.
 *
 * Shared by the re-planner and the concierge. That is the point of it living
 * here: a traveler asking for a change and an agent recovering from a storm
 * write to the same table and are applied by the same code, so they must be
 * held to the same standard. A second copy of this is how the two drift.
 */

/** Descriptions are terse because this schema is nested inside the propose
 *  tool and therefore resent on every iteration of a token-capped loop. */
export const opSchema = z.object({
  op: z.enum(["drop", "move", "replace", "add"]),
  item_id: z.string().optional().describe("itinerary item; drop/move/replace"),
  with_inventory_id: z.string().optional().describe("catalogue item; replace/add"),
  day: z.number().optional().describe("trip day; add"),
  starts_at: z.string().optional().describe("ISO UTC; move/replace/add"),
  ends_at: z.string().optional().describe("ISO UTC; move/replace/add"),
  local_time: z
    .string()
    .optional()
    .describe("HH:MM local. Preferred over starts_at; give day too."),
  depends_on: z.array(z.string()).optional().describe("prerequisite item ids; add"),
  reason: z.string().describe("max 12 words"),
});

export type OpInput = z.infer<typeof opSchema>;

export interface ValidatedPlan {
  errors: string[];
  normalised: ReplanOp[];
  /** Recomputed, never taken from the model. */
  costDelta: number;
}

export interface ValidateOptions {
  /**
   * Real bookable start times by inventory id, from whatever availability
   * search produced the candidates. Used to fill in a `replace` the model left
   * timeless; absent for callers that did no such search.
   */
  slotHints?: Map<string, string>;
  /**
   * Refuse to touch a stop that is already flagged `at_risk`.
   *
   * The re-planner must be able to: an at-risk stop is precisely what it was
   * called to fix. The concierge must not. A traveler moving a dinner that a
   * storm has already threatened would set it back to `confirmed` on the way
   * through and quietly un-flag a problem nobody had dealt with — and the
   * operator would find out when the group arrived.
   */
  refuseAtRisk?: boolean;
}

export async function validateOps(
  tripId: string,
  ops: OpInput[],
  options: ValidateOptions = {}
): Promise<ValidatedPlan> {
  const slotHints = options.slotHints ?? new Map<string, string>();
  const supabase = createAdminClient();
  const errors: string[] = [];

  const [{ data: items }, { data: inventory }, { data: trip }, { data: bookings }] =
    await Promise.all([
      supabase
        .from("itinerary_items")
        .select("id, day, cost, starts_at, ends_at, status, title, lock_reason")
        .eq("trip_id", tripId),
      supabase.from("inventory").select("id, base_cost, duration_min"),
      supabase.from("trips").select("starts_on, ends_on").eq("id", tripId).single(),
      supabase.from("bookings").select("item_id, penalty").eq("trip_id", tripId),
    ]);

  const itemRows = (items ?? []) as {
    id: string;
    day: number;
    cost: number;
    starts_at: string;
    ends_at: string;
    status: string;
    title: string;
    lock_reason: string | null;
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
  const itemById = new Map(itemRows.map((i) => [i.id, i]));
  const priceOf = new Map(inventoryRows.map((i) => [i.id, Number(i.base_cost)]));
  const durationOf = new Map(
    inventoryRows.map((i) => [i.id, Number(i.duration_min)])
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
   * In testing it reported +280 EUR on a plan that actually came to -390 — a
   * 670 EUR error, shown to an operator as fact. Cancelling refunds the item
   * and forfeits its deposit; a swap pays the difference plus that deposit; an
   * addition is its own price.
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
      } else {
        const target = itemById.get(op.item_id)!;
        // A stop that is already gone cannot be dropped, moved or swapped
        // again. Left unchecked this stored a plan that looked fine on screen
        // and then either failed at apply time or cancelled a second booking.
        if (target.status === "cancelled" || target.status === "replaced") {
          errors.push(
            `op ${idx}: "${target.title}" is already ${target.status} and cannot be changed again.`
          );
        }
        if (options.refuseAtRisk && target.status === "at_risk") {
          errors.push(
            `op ${idx}: "${target.title}" is at risk — the operator is already working on it. ` +
              `Tell them the office is dealing with that stop; do not propose a change to it.`
          );
        }
        // The lock is the whole reason a prepaid hotel survives a re-plan. The
        // prompt says so too; this is what makes it true rather than hoped for.
        //
        // A `move` is deliberately still allowed. A lock records money that
        // cannot be recovered — "four nights prepaid, non-refundable" — and
        // shifting a stop in time forfeits none of it. Dropping or swapping it
        // does, which is exactly what has to be refused.
        if (target.lock_reason && op.op !== "move") {
          errors.push(
            `op ${idx}: "${target.title}" is locked (${target.lock_reason}). Work around it.`
          );
        }
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
     * A replace has an unambiguous correct answer — the substitute goes in its
     * real bookable slot, or failing that where the broken stop sat, and runs
     * for the catalogue duration. Bouncing the plan back over a field the model
     * can only guess at costs a round trip against an 8000 token-per-minute
     * budget, and it guesses dates badly: that is what the window check above
     * exists to catch.
     *
     * A `move` or an `add` gets no such default. For those the time *is* the
     * decision, and inventing one would be putting a number in front of a
     * person that nobody chose.
     */
    const resolveWindow = (): { startsAt?: string; endsAt?: string } => {
      const invId = op.with_inventory_id ?? op.item_id;
      let startsAt = op.starts_at;

      /**
       * A wall-clock time is the one a model can actually get right.
       *
       * Asked for ISO UTC it has to do timezone arithmetic in its head, and on
       * the Amalfi Coast in August that is a two-hour offset it routinely
       * dropped — a lunch "at 13:00" arriving as 13:00Z, which is 15:00 on the
       * terrace. So `local_time` plus a day is the preferred input and the
       * conversion happens here, in the same function the manual planner uses.
       */
      if (!startsAt && op.local_time && window) {
        const day =
          op.day ?? (op.item_id ? itemById.get(op.item_id)?.day : undefined);
        if (day === undefined) {
          errors.push(`op ${idx}: local_time needs day (which day of the trip).`);
        } else if (!/^\d{1,2}:\d{2}$/.test(op.local_time)) {
          errors.push(`op ${idx}: local_time "${op.local_time}" is not HH:MM.`);
        } else {
          startsAt = zonedTime(
            window.starts_on,
            day,
            op.local_time,
            TRIP_TZ
          ).toISOString();
        }
      }

      if (!startsAt && op.op === "replace") {
        startsAt = slotHints.get(invId ?? "") ?? startOf.get(op.item_id ?? "");
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

    // Whatever we could not resolve is a hard error. Storing an operation with
    // no time produced a proposal that looked fine on screen and then failed at
    // apply time, leaving the itinerary with a replaced stop and nothing in its
    // place.
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
        // Left empty on purpose when the model does not say. `applyProposal`
        // chains a new stop to whatever precedes it that day, the same way the
        // manual planner does — a guess made from the itinerary is better than
        // one made from a prompt, and an unchained stop is an orphan the blast
        // radius can never reach.
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
}
