import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { TRIP_TZ } from "@/lib/format";
import type { FieldState, ItineraryItem, ReplanOp, TripPrefs } from "./types";

/**
 * Writes for the traveler planner.
 *
 * The interesting part is dependency wiring. A user adding "lunch on Capri"
 * should not have to declare that it needs the boat that gets them there — but
 * something has to, or the DAG is a flat list and impact analysis has nothing
 * to traverse. So a new stop is chained to whatever precedes it that day, and
 * the user can rewire it afterwards.
 */

export async function createTrip(input: {
  title: string;
  contactName: string;
  contactEmail?: string;
  partySize: number;
  budget: number | null;
  startsOn: string;
  endsOn: string;
  prefs: TripPrefs;
  operatorId?: string | null;
}): Promise<string> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("trips")
    .insert({
      title: input.title,
      contact_name: input.contactName,
      contact_email: input.contactEmail || null,
      party_size: input.partySize,
      budget: input.budget,
      starts_on: input.startsOn,
      ends_on: input.endsOn,
      prefs: input.prefs,
      operator_id: input.operatorId ?? null,
      status: "draft",
    })
    .select("id")
    .single();

  if (error) throw new Error(`createTrip: ${error.message}`);
  return (data as { id: string }).id;
}

/**
 * Add a stop, chaining it to the previous stop that day.
 *
 * `startsAt` is derived from the day and the requested local time, so the
 * caller passes a wall-clock time and the trip's zone decides the instant —
 * the same trap that put the seeded boat two hours late.
 */
export async function addItem(input: {
  tripId: string;
  day: number;
  inventoryId: string;
  localTime: string; // "HH:MM" in the trip's timezone
  timeZone: string;
}): Promise<ItineraryItem> {
  const supabase = createAdminClient();

  const [{ data: trip }, { data: inventory }] = await Promise.all([
    supabase.from("trips").select("starts_on").eq("id", input.tripId).single(),
    supabase
      .from("inventory")
      .select("*, vendors(id)")
      .eq("id", input.inventoryId)
      .single(),
  ]);

  if (!trip || !inventory) throw new Error("addItem: trip or inventory missing");

  const inv = inventory as unknown as {
    title: string;
    type: ItineraryItem["type"];
    duration_min: number;
    base_cost: number;
    lat: number | null;
    lng: number | null;
    vendors: { id: string } | null;
  };

  const startsAt = zonedTime(
    (trip as { starts_on: string }).starts_on,
    input.day,
    input.localTime,
    input.timeZone
  );
  const endsAt = new Date(startsAt.getTime() + inv.duration_min * 60_000);

  // Chain to the latest existing stop that day, so the graph stays connected.
  const { data: existing } = await supabase
    .from("itinerary_items")
    .select("id, starts_at, seq")
    .eq("trip_id", input.tripId)
    .eq("day", input.day)
    .order("starts_at");

  const priorSameDay = ((existing ?? []) as { id: string; starts_at: string }[])
    .filter((i) => new Date(i.starts_at) <= startsAt)
    .pop();

  // Nothing earlier today — hang it off the last stop of a previous day, so a
  // day-one disruption still reaches day two.
  let dependsOn: string[] = priorSameDay ? [priorSameDay.id] : [];
  if (!priorSameDay) {
    const { data: earlier } = await supabase
      .from("itinerary_items")
      .select("id")
      .eq("trip_id", input.tripId)
      .lt("day", input.day)
      .order("starts_at", { ascending: false })
      .limit(1);
    const previous = (earlier ?? []) as { id: string }[];
    if (previous.length) dependsOn = [previous[0].id];
  }

  const { data, error } = await supabase
    .from("itinerary_items")
    .insert({
      trip_id: input.tripId,
      day: input.day,
      seq: (existing ?? []).length + 1,
      inventory_id: input.inventoryId,
      vendor_id: inv.vendors?.id ?? null,
      title: inv.title,
      type: inv.type,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      lat: inv.lat,
      lng: inv.lng,
      cost: inv.base_cost,
      status: "planned",
      depends_on: dependsOn,
    })
    .select()
    .single();

  if (error) throw new Error(`addItem: ${error.message}`);
  return data as ItineraryItem;
}

/**
 * Remove a stop, healing the chain rather than orphaning it.
 *
 * Anything that depended on the removed stop inherits its dependencies —
 * otherwise deleting a middle link would silently sever the graph and shrink
 * every future blast radius without anyone noticing.
 */
export async function removeItem(itemId: string): Promise<void> {
  const supabase = createAdminClient();

  const { data: item } = await supabase
    .from("itinerary_items")
    .select("id, trip_id, depends_on, inventory_id, starts_at")
    .eq("id", itemId)
    .single();

  if (!item) return;
  const doomed = item as {
    id: string;
    trip_id: string;
    depends_on: string[];
    inventory_id: string | null;
    starts_at: string;
  };

  const { data: dependents } = await supabase
    .from("itinerary_items")
    .select("id, depends_on")
    .eq("trip_id", doomed.trip_id)
    .contains("depends_on", [itemId]);

  for (const dependent of (dependents ?? []) as {
    id: string;
    depends_on: string[];
  }[]) {
    const rewired = [
      ...dependent.depends_on.filter((id) => id !== itemId),
      ...doomed.depends_on,
    ];
    await supabase
      .from("itinerary_items")
      .update({ depends_on: [...new Set(rewired)] })
      .eq("id", dependent.id);
  }

  // Stand the booking down before the row goes. `bookings.item_id` is ON
  // DELETE SET NULL, so deleting first would leave a confirmed booking with
  // nothing to point at — money held against a stop nobody can find.
  await releaseBooking(supabase, doomed);

  const { error } = await supabase
    .from("itinerary_items")
    .delete()
    .eq("id", itemId);
  if (error) throw new Error(`removeItem: ${error.message}`);
}

/**
 * Confirm a trip the traveler has built, and actually book it.
 *
 * This used to be a status update and nothing else: the stops stayed `planned`,
 * no booking rows existed, and the operator inherited a "confirmed" group with
 * nothing reserved behind it. Confirming is the moment a plan becomes
 * commitments, so it books every planned stop, takes its seat, and returns what
 * still needs a human — the `manual` vendors, which are held rather than
 * confirmed and are exactly the calls the office has to make.
 */
export async function confirmTrip(tripId: string): Promise<{
  confirmed: number;
  held: number;
}> {
  const supabase = createAdminClient();

  const { data: items, error } = await supabase
    .from("itinerary_items")
    .select("id, inventory_id, starts_at, cost, vendor_id, inventory(vendors(channel))")
    .eq("trip_id", tripId)
    .eq("status", "planned");

  if (error) throw new Error(`confirmTrip: ${error.message}`);

  type Row = {
    id: string;
    inventory_id: string | null;
    starts_at: string;
    cost: number;
    vendor_id: string | null;
    inventory: { vendors: { channel: "auto" | "manual" } | null } | null;
  };

  let confirmed = 0;
  let held = 0;

  for (const row of ((items ?? []) as unknown as Row[])) {
    // A stop with no catalogue entry is something the operator added by hand;
    // there is nothing to reserve and no seat to take.
    if (row.inventory_id) {
      const channel = row.inventory?.vendors?.channel ?? "manual";

      // Re-confirming a trip must not book the same stop twice.
      const { data: existing } = await supabase
        .from("bookings")
        .select("id")
        .eq("item_id", row.id)
        .in("state", ["held", "confirmed"])
        .maybeSingle();

      if (!existing) {
        await bookItem(supabase, {
          tripId,
          itemId: row.id,
          inventoryId: row.inventory_id,
          vendorId: row.vendor_id,
          channel,
          amount: Number(row.cost),
          startsAt: row.starts_at,
        });
      }
      if (channel === "auto") confirmed++;
      else held++;
    }

    await supabase
      .from("itinerary_items")
      .update({ status: "confirmed" })
      .eq("id", row.id);
  }

  await supabase.from("trips").update({ status: "confirmed" }).eq("id", tripId);

  return { confirmed, held };
}

/**
 * Build an instant from a wall-clock time in a named zone.
 *
 * `new Date("2026-08-24T09:00")` is parsed in the *server's* zone, which is UTC
 * on Vercel — the same class of bug that shifted the seeded itinerary by two
 * hours. This finds the offset for that date and subtracts it.
 */
function zonedTime(
  startsOn: string,
  day: number,
  localTime: string,
  timeZone: string
): Date {
  const base = new Date(`${startsOn}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + (day - 1));

  const [hours, minutes] = localTime.split(":").map(Number);
  const naive = new Date(base);
  naive.setUTCHours(hours, minutes, 0, 0);

  // How far the target zone sits from UTC on that date (handles DST).
  const asUtc = new Date(
    naive.toLocaleString("en-US", { timeZone: "UTC" })
  ).getTime();
  const asZone = new Date(
    naive.toLocaleString("en-US", { timeZone })
  ).getTime();

  return new Date(naive.getTime() - (asZone - asUtc));
}

type Client = ReturnType<typeof createAdminClient>;

/** The calendar day a stop falls on where the trip is, which is the unit
 *  availability is published in. "YYYY-MM-DD", matching the SQL side. */
function localDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: TRIP_TZ });
}

/**
 * Move the consumed count on the availability row a stop sits in.
 *
 * Delegated to SQL because the increment has to be atomic — PostgREST can set
 * `slots_taken = 3` but not `slots_taken = slots_taken + 1`, and a read-then-
 * write from here races two operators booking the last seat. A stop whose day
 * the catalogue does not publish simply has no row to move, which the function
 * reports as -1 rather than treating as an error.
 */
async function adjustAvailability(
  supabase: Client,
  inventoryId: string | null,
  startsAt: string,
  delta: 1 | -1
): Promise<void> {
  if (!inventoryId) return;
  await supabase.rpc("adjust_availability", {
    p_inventory_id: inventoryId,
    p_starts_at: startsAt,
    p_delta: delta,
  });
}

/**
 * Stand down the booking behind a stop that is no longer happening, and give
 * its seat back to the catalogue.
 *
 * Without this an accepted re-plan left the traveler's summary counting the
 * cancellation penalty of a stop that had already been cancelled — the number
 * the whole "do not just drop it" argument rests on, wrong on screen.
 *
 * The penalty on the released row is left as it was on purpose. It is what the
 * cancellation actually cost, it is already priced into the proposal's
 * cost_delta, and an operator reconciling the month needs to see it.
 */
async function releaseBooking(
  supabase: Client,
  item: { id: string; inventory_id: string | null; starts_at: string }
): Promise<void> {
  const { data: released } = await supabase
    .from("bookings")
    .update({ state: "cancelled" })
    .eq("item_id", item.id)
    .in("state", ["held", "confirmed"])
    .select("id");

  // Only give the seat back if a booking was actually holding it.
  if ((released ?? []).length > 0) {
    await adjustAvailability(supabase, item.inventory_id, item.starts_at, -1);
  }
}

/**
 * Book a stop the re-plan just created, and take its seat.
 *
 * The state is decided by how the vendor is reachable, which the schema
 * already records: an `auto` vendor is one the platform can rebook without a
 * human, so the booking is confirmed outright; a `manual` one is held until
 * somebody in the office calls them. That distinction is the difference
 * between a re-plan that is done and one that still needs a phone call, and
 * the operator has to be able to see which they are looking at.
 */
async function bookItem(
  supabase: Client,
  input: {
    tripId: string;
    itemId: string;
    inventoryId: string;
    vendorId: string | null;
    channel: "auto" | "manual";
    amount: number;
    startsAt: string;
  }
): Promise<void> {
  const { error } = await supabase.from("bookings").insert({
    trip_id: input.tripId,
    item_id: input.itemId,
    vendor_id: input.vendorId,
    state: input.channel === "auto" ? "confirmed" : "held",
    amount: input.amount,
    // Newly booked, so nothing is sunk yet. It grows as the date approaches;
    // that is a vendor policy question this slice does not model.
    penalty: 0,
    external_ref: `RP-${Date.now().toString(36).toUpperCase()}`,
  });

  if (error) {
    throw new Error(
      `Applied the re-plan but could not book the replacement: ${error.message}`
    );
  }

  await adjustAvailability(supabase, input.inventoryId, input.startsAt, 1);
}

/**
 * Apply an accepted re-plan to the live itinerary.
 *
 * This is the only code that turns a proposal into reality, and it is
 * deliberately deterministic — the agent decides *what* to propose, a human
 * decides *whether*, and this decides *how*. Keeping the write path out of the
 * model means a wrong proposal is a bad suggestion someone declined, not a
 * corrupted itinerary.
 */
export async function applyProposal(proposalId: string): Promise<{
  applied: number;
  tripId: string;
}> {
  const supabase = createAdminClient();

  const { data: proposal, error } = await supabase
    .from("replan_proposals")
    .select("*, disruptions(id, trip_id, root_item_id)")
    .eq("id", proposalId)
    .single();

  if (error) throw new Error(`applyProposal: ${error.message}`);

  const row = proposal as unknown as {
    id: string;
    plan: ReplanOp[];
    state: string;
    disruptions: { id: string; trip_id: string } | null;
  };
  if (!row.disruptions) throw new Error("applyProposal: orphaned proposal");
  if (row.state === "accepted") return { applied: 0, tripId: row.disruptions.trip_id };

  const tripId = row.disruptions.trip_id;

  /**
   * Check the whole plan before writing any of it.
   *
   * This function used to apply operations one at a time and ignore the result
   * of the insert. A `replace` whose row was rejected by the database — a
   * missing timestamp was the real case — still went on to mark the original
   * `replaced`, so the trip ended up with the boat cancelled and nothing in its
   * place, and nobody was told. A half-applied re-plan is worse than a refused
   * one: the operator believes the group is covered.
   */
  const problems: string[] = [];
  for (const [idx, op] of row.plan.entries()) {
    if (op.op === "drop") continue;

    if (!op.starts_at || !op.ends_at) {
      problems.push(`operation ${idx} (${op.op}) has no start or end time`);
      continue;
    }
    if (new Date(op.ends_at) <= new Date(op.starts_at)) {
      problems.push(`operation ${idx} (${op.op}) ends before it starts`);
      continue;
    }
    if (op.op === "replace" || op.op === "add") {
      const inventoryId =
        op.op === "replace" ? op.with_inventory_id : op.inventory_id;
      const { data: exists } = await supabase
        .from("inventory")
        .select("id")
        .eq("id", inventoryId)
        .maybeSingle();
      if (!exists) {
        problems.push(`operation ${idx} names inventory ${inventoryId}, which does not exist`);
      }
    }
  }

  if (problems.length > 0) {
    throw new Error(
      `This plan cannot be applied and the itinerary was left untouched:\n` +
        problems.map((p) => `  · ${p}`).join("\n")
    );
  }

  let applied = 0;

  for (const op of row.plan) {
    if (op.op === "drop") {
      // Read before writing: once the row says `cancelled` we can no longer
      // tell which availability day it was holding.
      const { data: doomed } = await supabase
        .from("itinerary_items")
        .select("id, inventory_id, starts_at")
        .eq("id", op.item_id)
        .maybeSingle();

      await supabase
        .from("itinerary_items")
        .update({ status: "cancelled", notes: op.reason })
        .eq("id", op.item_id);

      if (doomed) {
        await releaseBooking(
          supabase,
          doomed as { id: string; inventory_id: string | null; starts_at: string }
        );
      }
      applied++;
    }

    if (op.op === "move") {
      const { data: before } = await supabase
        .from("itinerary_items")
        .select("id, inventory_id, starts_at")
        .eq("id", op.item_id)
        .maybeSingle();

      await supabase
        .from("itinerary_items")
        .update({
          starts_at: op.starts_at,
          ends_at: op.ends_at,
          status: "confirmed",
          notes: op.reason,
        })
        .eq("id", op.item_id);

      // A move that crosses midnight is consuming a different day's capacity.
      // The booking itself is untouched — it is the same stop with the same
      // vendor, just later.
      const previous = before as
        | { inventory_id: string | null; starts_at: string }
        | null;
      if (previous?.inventory_id) {
        const wasDay = localDay(previous.starts_at);
        const nowDay = localDay(op.starts_at);
        if (wasDay !== nowDay) {
          await adjustAvailability(supabase, previous.inventory_id, previous.starts_at, -1);
          await adjustAvailability(supabase, previous.inventory_id, op.starts_at, 1);
        }
      }
      applied++;
    }

    if (op.op === "replace") {
      const [{ data: old }, { data: inv }] = await Promise.all([
        supabase.from("itinerary_items").select("*").eq("id", op.item_id).single(),
        supabase
          .from("inventory")
          .select("*, vendors(id, channel)")
          .eq("id", op.with_inventory_id)
          .single(),
      ]);
      if (!old || !inv) continue;

      const previous = old as unknown as ItineraryItem;
      const replacement = inv as unknown as {
        title: string;
        type: ItineraryItem["type"];
        base_cost: number;
        lat: number | null;
        lng: number | null;
        vendors: { id: string; channel: "auto" | "manual" } | null;
      };

      const { data: inserted, error: insertError } = await supabase
        .from("itinerary_items")
        .insert({
          trip_id: tripId,
          day: previous.day,
          seq: previous.seq,
          inventory_id: op.with_inventory_id,
          vendor_id: replacement.vendors?.id ?? null,
          title: replacement.title,
          type: replacement.type,
          starts_at: op.starts_at,
          ends_at: op.ends_at,
          lat: replacement.lat,
          lng: replacement.lng,
          cost: replacement.base_cost,
          status: "confirmed",
          // The stand-in inherits the position in the graph, so the chain
          // survives the swap.
          depends_on: previous.depends_on,
          notes: op.reason,
        })
        .select("id")
        .single();

      // The original is only stood down once its replacement exists. The
      // pre-flight above should make this unreachable; it stays because the
      // failure it guards against is silent and the cost is a trip with a hole
      // in it.
      if (insertError || !inserted) {
        throw new Error(
          `Could not create the replacement for "${previous.title}" ` +
            `(${insertError?.message ?? "no row returned"}). The original stop ` +
            `was left in place.`
        );
      }

      await supabase
        .from("itinerary_items")
        .update({ status: "replaced", notes: op.reason })
        .eq("id", op.item_id);

      // The swap is only real once the money follows it: the old booking is
      // stood down and its seat returned, and the stand-in gets a booking of
      // its own. Leaving this out is what had the traveler's summary quoting a
      // penalty for a boat that was no longer on the itinerary.
      await releaseBooking(supabase, previous);
      await bookItem(supabase, {
        tripId,
        itemId: (inserted as { id: string }).id,
        inventoryId: op.with_inventory_id,
        vendorId: replacement.vendors?.id ?? null,
        channel: replacement.vendors?.channel ?? "manual",
        amount: Number(replacement.base_cost),
        startsAt: op.starts_at,
      });

      // Anything that needed the old stop now needs the new one, or the
      // downstream chain is quietly orphaned.
      {
        const newId = (inserted as { id: string }).id;
        const { data: dependents } = await supabase
          .from("itinerary_items")
          .select("id, depends_on")
          .eq("trip_id", tripId)
          .contains("depends_on", [op.item_id]);

        for (const dep of (dependents ?? []) as {
          id: string;
          depends_on: string[];
        }[]) {
          await supabase
            .from("itinerary_items")
            .update({
              depends_on: [
                ...new Set([
                  ...dep.depends_on.filter((id) => id !== op.item_id),
                  newId,
                ]),
              ],
            })
            .eq("id", dep.id);
        }
      }
      applied++;
    }

    if (op.op === "add") {
      const { data: inv } = await supabase
        .from("inventory")
        .select("*, vendors(id, channel)")
        .eq("id", op.inventory_id)
        .single();
      if (!inv) continue;

      const addition = inv as unknown as {
        title: string;
        type: ItineraryItem["type"];
        base_cost: number;
        lat: number | null;
        lng: number | null;
        vendors: { id: string; channel: "auto" | "manual" } | null;
      };

      const { data: added, error: addError } = await supabase
        .from("itinerary_items")
        .insert({
        trip_id: tripId,
        day: op.day,
        seq: 99,
        inventory_id: op.inventory_id,
        vendor_id: addition.vendors?.id ?? null,
        title: addition.title,
        type: addition.type,
        starts_at: op.starts_at,
        ends_at: op.ends_at,
        lat: addition.lat,
        lng: addition.lng,
        cost: addition.base_cost,
        status: "confirmed",
        depends_on: op.depends_on ?? [],
        notes: op.reason,
      })
        .select("id")
        .single();

      // Same rule as a replacement: a stop nobody could book is not an
      // addition, it is a promise. Fail loudly rather than quietly.
      if (addError || !added) {
        throw new Error(
          `Could not add "${addition.title}" to the itinerary ` +
            `(${addError?.message ?? "no row returned"}).`
        );
      }

      await bookItem(supabase, {
        tripId,
        itemId: (added as { id: string }).id,
        inventoryId: op.inventory_id,
        vendorId: addition.vendors?.id ?? null,
        channel: addition.vendors?.channel ?? "manual",
        amount: Number(addition.base_cost),
        startsAt: op.starts_at,
      });
      applied++;
    }
  }

  // Anything still flagged survived the disruption untouched, so clear it.
  await supabase
    .from("itinerary_items")
    .update({ status: "confirmed" })
    .eq("trip_id", tripId)
    .eq("status", "at_risk");

  await Promise.all([
    supabase
      .from("replan_proposals")
      .update({ state: "accepted", decided_at: new Date().toISOString() })
      .eq("id", proposalId),
    // Competing options are superseded, not deleted — the operator should be
    // able to see what else was on the table when this call was made.
    supabase
      .from("replan_proposals")
      .update({ state: "superseded" })
      .eq("disruption_id", row.disruptions.id)
      .neq("id", proposalId)
      .eq("state", "draft"),
    supabase
      .from("disruptions")
      .update({ state: "resolved", resolved_at: new Date().toISOString() })
      .eq("id", row.disruptions.id),
  ]);

  return { applied, tripId };
}

// ----------------------------------------------------------- coordinator --

/**
 * The guide reporting on a stop.
 *
 * Writes only the field columns — `status` stays the operator's to set. A stop
 * that the group finished and a booking the office confirmed are different
 * facts, and the schema keeps them apart so neither can overwrite the other.
 */
export async function reportFieldState(
  itemId: string,
  state: FieldState,
  note?: string
): Promise<{ tripId: string; title: string }> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("itinerary_items")
    .update({
      field_state: state,
      // An empty textarea should clear a stale note, not preserve it, but an
      // omitted argument (the plain state buttons) must leave it alone.
      ...(note === undefined ? {} : { field_note: note.trim() || null }),
    })
    .eq("id", itemId)
    .select("trip_id, title")
    .single();

  if (error) throw new Error(`reportFieldState: ${error.message}`);
  const row = data as { trip_id: string; title: string };
  return { tripId: row.trip_id, title: row.title };
}

/** An open disruption already rooted at this item, if there is one. */
export async function findOpenDisruptionFor(
  itemId: string
): Promise<string | null> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("disruptions")
    .select("id")
    .eq("root_item_id", itemId)
    .eq("state", "open")
    .limit(1)
    .maybeSingle();

  return (data as { id: string } | null)?.id ?? null;
}
