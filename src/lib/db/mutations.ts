import "server-only";
import { randomUUID } from "node:crypto";
import { serviceRoleClient } from "./client";
import { TRIP_TZ, zonedTime } from "@/lib/format";
import type { FieldState, ItineraryItem, ReplanOp, TripPrefs } from "./types";

/**
 * Writes for the traveler planner.
 *
 * The interesting part is dependency wiring. A user adding "lunch on Capri"
 * should not have to declare that it needs the boat that gets them there — but
 * something has to, or the DAG is a flat list and impact analysis has nothing
 * to traverse. So a new stop is chained to whatever precedes it that day, and
 * the user can rewire it afterwards.
 *
 * ---
 *
 * Every write here runs as the service role, and that is deliberate rather
 * than left over. `applyProposal` cancels vendor bookings and moves
 * `availability.slots_taken` — catalogue rows that no user-facing policy
 * grants a write on, correctly, because a traveler must not be able to edit
 * inventory directly. Writing these through RLS would mean opening those
 * tables to travelers to let one code path move a seat.
 *
 * The consequence is that these functions do not check who is calling. They
 * take a trip id and act on it. **Authorization happens in the server action
 * above them**, which calls `assertTripAccess(tripId)` — an RLS-scoped read
 * that returns nothing unless the signed-in user owns, operates or is running
 * that trip. A new mutating action without that call is a hole; there is no
 * second line of defence down here.
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
  /**
   * Who the trip belongs to. Not optional in practice: `trips_read` is
   * `traveler_id = auth.uid() or ...`, so a trip created with this null is
   * invisible to the person who just created it. The planner action passes the
   * signed-in viewer; the seed leaves it null on purpose and `seed-auth.mjs`
   * fills it in afterwards.
   */
  travelerId?: string | null;
}): Promise<string> {
  const supabase = serviceRoleClient();

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
      traveler_id: input.travelerId ?? null,
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
  const supabase = serviceRoleClient();

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

  const { dependsOn, seq } = await chainInto(
    supabase,
    input.tripId,
    input.day,
    startsAt.toISOString()
  );

  const { data, error } = await supabase
    .from("itinerary_items")
    .insert({
      trip_id: input.tripId,
      day: input.day,
      seq,
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
 * Add a place the catalogue has never heard of.
 *
 * `addItem` needs an `inventoryId`, and the concierge's validator rejects an id
 * it cannot find. That rule is why a model cannot invent a "Schweizer
 * Schokolade Factory Tour" and put it on a holiday, and it is not relaxed here.
 * What it also blocked, though, was a *person* adding a real place they knew
 * about — a reindeer farm outside Rovaniemi that no catalogue in this database
 * has ever listed. A model inventing a place is a hallucination; a traveler
 * naming one is research, and the two deserve different answers.
 *
 * So this mints a real row from facts a human supplied and then does nothing
 * clever: it calls the same `addItem` as the manual builder, so the stop chains
 * into the DAG, the blast radius walks it, the compare screen prices it and the
 * PDF prints it with no special cases anywhere downstream.
 *
 * Three properties are deliberate:
 *
 * - **`added_for_trip` is set**, so the row is never *offered* on another trip.
 *   One traveler's guess must not become the substitute a re-planner suggests
 *   to somebody else at 2am.
 * - **The vendor is `manual`**, so `confirmTrip` holds the stop rather than
 *   reserving it. Nothing a traveler typed in gets auto-booked; a human has to
 *   ring somebody. This is the same treatment researched rows get.
 * - **`provisional` is true**, so every surface that already distinguishes a
 *   checked row from an unchecked one keeps doing so without being taught a
 *   third category.
 */
export async function addCustomStop(input: {
  tripId: string;
  day: number;
  localTime: string; // "HH:MM" in the trip's timezone
  timeZone: string;
  title: string;
  type: ItineraryItem["type"];
  /** The town it is in. Without it the transit guard cannot place the stop. */
  city: string | null;
  durationMin: number;
  cost: number;
  /** So a storm knows to rule it out, the way it rules out the boat. */
  weatherSensitive: boolean;
  /** Where the traveler read about it, when they have a link. */
  sourceUrl?: string | null;
}): Promise<ItineraryItem> {
  const supabase = serviceRoleClient();

  const { data: trip } = await supabase
    .from("trips")
    .select("operator_id")
    .eq("id", input.tripId)
    .single();

  if (!trip) throw new Error("addCustomStop: no such trip");

  /**
   * Whose books it lands on.
   *
   * A trip a traveler composed for themselves may not have an operator yet —
   * one is assigned when the proposal is accepted. A vendor row needs one
   * regardless, so fall back to the oldest operator, which is the same answer
   * `houseAssignment` gives and the same one the deployment was seeded around.
   */
  let operatorId = (trip as { operator_id: string | null }).operator_id;
  if (!operatorId) {
    const { data: fallback } = await supabase
      .from("operators")
      .select("id")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    operatorId = (fallback as { id: string } | null)?.id ?? null;
  }
  if (!operatorId) throw new Error("addCustomStop: no operator to attach to");

  /**
   * One vendor per operator, reused. It exists to carry `channel = 'manual'`
   * through to `confirmTrip` and to give the operator's board an honest label
   * for the row — not to pretend a business has been contacted.
   */
  const VENDOR_NAME = "Added by traveler";
  const { data: existingVendor } = await supabase
    .from("vendors")
    .select("id")
    .eq("operator_id", operatorId)
    .eq("name", VENDOR_NAME)
    .maybeSingle();

  let vendorId = (existingVendor as { id: string } | null)?.id ?? null;
  if (!vendorId) {
    const { data: created, error: vendorError } = await supabase
      .from("vendors")
      .insert({
        operator_id: operatorId,
        name: VENDOR_NAME,
        type: input.type === "transport" ? "transport" : "activity",
        channel: "manual",
        // Nobody has judged this supplier, because there may not be one yet.
        reliability: 0.5,
      })
      .select("id")
      .single();

    if (vendorError) throw new Error(`addCustomStop: ${vendorError.message}`);
    vendorId = (created as { id: string }).id;
  }

  const { data: inventory, error: inventoryError } = await supabase
    .from("inventory")
    .insert({
      vendor_id: vendorId,
      title: input.title,
      type: input.type,
      duration_min: input.durationMin,
      base_cost: input.cost,
      city: input.city,
      weather_sensitive: input.weatherSensitive,
      provisional: true,
      added_for_trip: input.tripId,
      source_url: input.sourceUrl ?? null,
      time_zone: input.timeZone,
    })
    .select("id")
    .single();

  if (inventoryError) throw new Error(`addCustomStop: ${inventoryError.message}`);
  const inventoryId = (inventory as { id: string }).id;

  /**
   * A slot, so the stop behaves like every other one.
   *
   * Without an `availability` row the compare screen and the re-planner's
   * candidate search — both of which read `availability` and join inventory —
   * would simply never see it, and a stop that cannot be compared or replaced
   * is a hole in the graph rather than a member of it. Computed with the same
   * `zonedTime` call `addItem` makes, from the same inputs, so the two agree.
   */
  const startsAt = zonedTime(
    (
      await supabase
        .from("trips")
        .select("starts_on")
        .eq("id", input.tripId)
        .single()
    ).data!.starts_on as string,
    input.day,
    input.localTime,
    input.timeZone
  );

  const { error: availabilityError } = await supabase.from("availability").insert({
    inventory_id: inventoryId,
    date: startsAt.toISOString().slice(0, 10),
    starts_at: startsAt.toISOString(),
    slots_total: 1,
    slots_taken: 0,
    price: input.cost,
  });

  if (availabilityError) {
    throw new Error(`addCustomStop: ${availabilityError.message}`);
  }

  return addItem({
    tripId: input.tripId,
    day: input.day,
    inventoryId,
    localTime: input.localTime,
    timeZone: input.timeZone,
  });
}

/**
 * Write a whole composed itinerary in one round trip.
 *
 * `addItem` is the right shape for adding one stop to a trip somebody is
 * editing: it re-reads the trip, re-reads the inventory row, and asks the
 * database what the new stop should hang off. For a composed itinerary that is
 * the wrong shape entirely — a 52-stop plan ran it 52 times, four queries each,
 * against a hosted Postgres, and took the better part of a minute while the
 * traveler watched a button say "Building the trip…".
 *
 * Nothing about that work needs the database round trip. The stops arrive in
 * chronological order, so `chainInto`'s two cases — hang off the earlier stop
 * today, else off the last stop of a previous day — both resolve to *the
 * preceding stop in the list*. And ids do not have to be discovered: Postgres
 * defaults them, but we can generate them, which means the whole dependency
 * graph can be built in memory before a single row is written.
 *
 * So: one read for the trip, one for the inventory, one insert. The resulting
 * rows are byte-for-byte what the loop produced — same seq, same depends_on,
 * same DAG for the blast radius to walk.
 */
export async function addItems(input: {
  tripId: string;
  timeZone: string;
  stops: { day: number; inventoryId: string; localTime: string }[];
}): Promise<number> {
  if (!input.stops.length) return 0;

  const supabase = serviceRoleClient();

  const [{ data: trip }, { data: inventory }] = await Promise.all([
    supabase.from("trips").select("starts_on").eq("id", input.tripId).single(),
    supabase
      .from("inventory")
      .select("id, title, type, duration_min, base_cost, lat, lng, vendors(id)")
      .in("id", [...new Set(input.stops.map((s) => s.inventoryId))]),
  ]);

  if (!trip) throw new Error("addItems: trip missing");

  type Inv = {
    id: string;
    title: string;
    type: ItineraryItem["type"];
    duration_min: number;
    base_cost: number;
    lat: number | null;
    lng: number | null;
    vendors: { id: string } | null;
  };
  const byId = new Map(((inventory ?? []) as unknown as Inv[]).map((i) => [i.id, i]));

  const startsOn = (trip as { starts_on: string }).starts_on;

  // Chronological, because the chain below assumes it. The composer already
  // sorts, but a caller that did not would otherwise build a graph that points
  // backwards in time — silently, and only visible when a disruption walks it.
  const stops = [...input.stops].sort((a, b) =>
    a.day === b.day ? a.localTime.localeCompare(b.localTime) : a.day - b.day
  );

  const perDay = new Map<number, number>();
  const rows: Record<string, unknown>[] = [];
  let previousId: string | null = null;

  for (const stop of stops) {
    const inv = byId.get(stop.inventoryId);
    if (!inv) continue;

    const startsAt = zonedTime(startsOn, stop.day, stop.localTime, input.timeZone);
    const endsAt = new Date(startsAt.getTime() + inv.duration_min * 60_000);

    const seq = (perDay.get(stop.day) ?? 0) + 1;
    perDay.set(stop.day, seq);

    const id = randomUUID();
    rows.push({
      id,
      trip_id: input.tripId,
      day: stop.day,
      seq,
      inventory_id: inv.id,
      vendor_id: inv.vendors?.id ?? null,
      title: inv.title,
      type: inv.type,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      lat: inv.lat,
      lng: inv.lng,
      cost: inv.base_cost,
      status: "planned",
      // The whole chain: every stop hangs off the one before it, and the first
      // hangs off nothing. Identical to what `chainInto` computes one query at
      // a time, because the list is in time order.
      depends_on: previousId ? [previousId] : [],
    });
    previousId = id;
  }

  const { error } = await supabase.from("itinerary_items").insert(rows as never);
  if (error) throw new Error(`addItems: ${error.message}`);

  return rows.length;
}

/**
 * Remove a stop, healing the chain rather than orphaning it.
 *
 * Anything that depended on the removed stop inherits its dependencies —
 * otherwise deleting a middle link would silently sever the graph and shrink
 * every future blast radius without anyone noticing.
 */
export async function removeItem(itemId: string): Promise<void> {
  const supabase = serviceRoleClient();

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
  const supabase = serviceRoleClient();

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

type Client = ReturnType<typeof serviceRoleClient>;

/** The calendar day a stop falls on where the trip is, which is the unit
 *  availability is published in. "YYYY-MM-DD", matching the SQL side. */
function localDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: TRIP_TZ });
}

/**
 * Where a new stop hangs in the graph, and where it sits in the day.
 *
 * A user adding "lunch on Capri" should not have to declare that it needs the
 * boat that gets them there — but something has to, or the DAG is a flat list
 * and impact analysis has nothing to traverse. So a new stop is chained to
 * whatever precedes it, and the user can rewire it afterwards.
 *
 * This is shared by the manual planner and by an accepted `add` operation, and
 * that sharing is the point. An added stop that declared no dependencies was an
 * orphan: nothing upstream reached it, so every later blast radius quietly got
 * smaller and the `trip root reaches every item` invariant in verify.sql failed.
 * The manual path had always chained; the agent path had not.
 */
async function chainInto(
  supabase: Client,
  tripId: string,
  day: number,
  startsAtIso: string
): Promise<{ dependsOn: string[]; seq: number }> {
  const startsAt = new Date(startsAtIso);

  const { data: existing } = await supabase
    .from("itinerary_items")
    .select("id, starts_at")
    .eq("trip_id", tripId)
    .eq("day", day)
    .order("starts_at");

  const sameDay = (existing ?? []) as { id: string; starts_at: string }[];
  const priorSameDay = sameDay
    .filter((i) => new Date(i.starts_at) <= startsAt)
    .pop();

  const seq = sameDay.length + 1;
  if (priorSameDay) return { dependsOn: [priorSameDay.id], seq };

  // Nothing earlier today — hang it off the last stop of a previous day, so a
  // day-one disruption still reaches day two.
  const { data: earlier } = await supabase
    .from("itinerary_items")
    .select("id")
    .eq("trip_id", tripId)
    .lt("day", day)
    .order("starts_at", { ascending: false })
    .limit(1);

  const previous = (earlier ?? []) as { id: string }[];
  return { dependsOn: previous.length ? [previous[0].id] : [], seq };
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
  const supabase = serviceRoleClient();

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
    trip_id: string | null;
    disruptions: { id: string; trip_id: string } | null;
  };

  // A proposal is owned by a disruption (the re-planner) or by a trip
  // directly (the concierge). Both are applied identically — the difference is
  // only what else has to be tidied up afterwards.
  const tripId = row.trip_id ?? row.disruptions?.trip_id ?? null;
  if (!tripId) throw new Error("applyProposal: orphaned proposal");
  if (row.state === "accepted") return { applied: 0, tripId };

  const disruption = row.disruptions;

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
    // A draft is checked when it is written and again here, because the
    // itinerary can move in between — most easily in the concierge, where a
    // suggestion can sit in a chat thread while something else changes the
    // stop it names. Applying an operation against a stop that is already gone
    // would cancel a second booking or fail halfway.
    if (op.op !== "add") {
      const { data: target } = await supabase
        .from("itinerary_items")
        .select("title, status")
        .eq("id", op.item_id)
        .maybeSingle();

      const stop = target as { title: string; status: string } | null;
      if (!stop) {
        problems.push(`operation ${idx} names a stop that is no longer on the itinerary`);
        continue;
      }
      if (stop.status === "cancelled" || stop.status === "replaced") {
        problems.push(
          `operation ${idx} changes "${stop.title}", which is already ${stop.status}`
        );
        continue;
      }
    }

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

      // A stop that declares no prerequisites is an orphan the blast radius can
      // never reach, which silently shrinks every future impact assessment. The
      // model is not asked to get this right — the itinerary already knows what
      // comes before a 15:00 stop on day three.
      const chain = await chainInto(supabase, tripId, op.day, op.starts_at);
      const dependsOn = op.depends_on?.length ? op.depends_on : chain.dependsOn;

      const { data: added, error: addError } = await supabase
        .from("itinerary_items")
        .insert({
          trip_id: tripId,
          day: op.day,
          seq: chain.seq,
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
          depends_on: dependsOn,
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

  await supabase
    .from("replan_proposals")
    .update({ state: "accepted", decided_at: new Date().toISOString() })
    .eq("id", proposalId);

  // Everything below closes out a disruption, and a concierge change has none.
  // Scoping it matters rather than being tidy: clearing `at_risk` across the
  // whole trip after a traveler added a wine tasting would silently un-flag an
  // unrelated storm that nobody had dealt with yet.
  if (disruption) {
    // Anything still flagged survived the disruption untouched, so clear it.
    await supabase
      .from("itinerary_items")
      .update({ status: "confirmed" })
      .eq("trip_id", tripId)
      .eq("status", "at_risk");

    await Promise.all([
      // Competing options are superseded, not deleted — the operator should be
      // able to see what else was on the table when this call was made.
      supabase
        .from("replan_proposals")
        .update({ state: "superseded" })
        .eq("disruption_id", disruption.id)
        .neq("id", proposalId)
        .eq("state", "draft"),
      supabase
        .from("disruptions")
        .update({ state: "resolved", resolved_at: new Date().toISOString() })
        .eq("id", disruption.id),
    ]);
  }

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
  const supabase = serviceRoleClient();

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
  const supabase = serviceRoleClient();
  const { data } = await supabase
    .from("disruptions")
    .select("id")
    .eq("root_item_id", itemId)
    .eq("state", "open")
    .limit(1)
    .maybeSingle();

  return (data as { id: string } | null)?.id ?? null;
}

/**
 * Swap one stop for a catalogue option the traveler has compared it against.
 *
 * The whole body of this is deliberately a detour. It would be four lines to
 * update `itinerary_items.inventory_id` and be done; instead it builds a
 * one-operation plan, sends it through `validateOps`, records it as a
 * `replan_proposals` row and hands it to `applyProposal`.
 *
 * That is the same road an operator's storm re-plan travels, and it is the
 * only road that does the things a swap actually needs: rewiring the
 * dependency edges so whatever came after the old stop now follows the new
 * one, cancelling the old booking, making the new one, and moving the
 * availability seats atomically. Every one of those is a way for a shortcut to
 * leave the itinerary and the bookings disagreeing, and none of them is
 * visible in the UI until a group turns up somewhere with no reservation.
 *
 * Authorization is the caller's job — see the note at the top of this file.
 * `switchStopAction` calls `assertTripAccess` before it gets here.
 */
export async function switchStop(input: {
  tripId: string;
  itemId: string;
  inventoryId: string;
  startsAt: string;
}): Promise<{ proposalId: string; costDelta: number; applied: number }> {
  const { validateOps } = await import("@/lib/agent/plan");
  const supabase = serviceRoleClient();

  const { data: itemRow } = await supabase
    .from("itinerary_items")
    .select("id, trip_id, title")
    .eq("id", input.itemId)
    .maybeSingle();

  const item = itemRow as { id: string; trip_id: string; title: string } | null;
  // Both ids arrive from a form. The guard above proved the *trip* is the
  // caller's; this proves the stop belongs to that trip, which is the half a
  // trip-scoped check cannot see.
  if (!item || item.trip_id !== input.tripId) {
    throw new Error("That stop is not on this trip.");
  }

  const { data: invRow } = await supabase
    .from("inventory")
    .select("duration_min, title")
    .eq("id", input.inventoryId)
    .maybeSingle();

  const inventory = invRow as { duration_min: number; title: string } | null;
  if (!inventory) throw new Error("That option is no longer in the catalogue.");

  const endsAt = new Date(
    Date.parse(input.startsAt) + inventory.duration_min * 60_000
  ).toISOString();

  const { errors, normalised, costDelta } = await validateOps(
    input.tripId,
    [
      {
        op: "replace",
        item_id: input.itemId,
        with_inventory_id: input.inventoryId,
        starts_at: input.startsAt,
        ends_at: endsAt,
        reason: "traveler compared and switched",
      },
    ],
    /**
     * A traveler may not switch a stop an operator is mid-way through
     * re-planning. Applying it would set the stop back to `confirmed` and
     * quietly un-flag a live problem — the same trap the concierge is held
     * away from, and the reason `refuseAtRisk` exists at all.
     */
    { refuseAtRisk: true }
  );

  if (errors.length) throw new Error(errors[0]);

  const { data: proposalRow, error } = await supabase
    .from("replan_proposals")
    .insert({
      trip_id: input.tripId,
      source: "traveler",
      plan: normalised,
      cost_delta: costDelta,
      rationale: `Traveler switched "${item.title}" to "${inventory.title}" after comparing alternatives.`,
      state: "draft",
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);

  const proposalId = (proposalRow as { id: string }).id;
  const { applied } = await applyProposal(proposalId);

  return { proposalId, costDelta, applied };
}

// --------------------------------------------------------------- payments --

/**
 * Write down money that moved.
 *
 * A ledger entry, not a charge. Nothing here talks to a payment processor and
 * the product does not claim it does — what an operator gets is the ability to
 * see and record what a group owes and has paid, which is the "payments" in
 * PS-7's list of things they must manage centrally.
 *
 * Sign lives in `kind`, so a refund is a positive amount. See
 * `summarizePayments` for the arithmetic and the migration for why.
 */
export async function recordPayment(input: {
  tripId: string;
  kind: "deposit" | "balance" | "refund" | "adjustment";
  amount: number;
  method?: "bank_transfer" | "card" | "cash" | "upi" | "other";
  reference?: string | null;
  note?: string | null;
  recordedBy?: string | null;
}): Promise<string> {
  if (!(input.amount > 0)) {
    throw new Error("A payment has to be more than zero.");
  }

  const supabase = serviceRoleClient();

  // Denominated in the trip's own currency. Storing it on the row rather than
  // joining for it means a historic payment still reads correctly if the trip
  // is ever re-priced.
  const { data: tripRow } = await supabase
    .from("trips")
    .select("currency")
    .eq("id", input.tripId)
    .single();

  const { data, error } = await supabase
    .from("payments")
    .insert({
      trip_id: input.tripId,
      kind: input.kind,
      amount: input.amount,
      currency: (tripRow as { currency: string } | null)?.currency ?? "INR",
      method: input.method ?? "bank_transfer",
      reference: input.reference ?? null,
      note: input.note ?? null,
      recorded_by: input.recordedBy ?? null,
    })
    .select("id")
    .single();

  if (error) throw new Error(`recordPayment: ${error.message}`);
  return (data as { id: string }).id;
}

// ------------------------------------------------------ complete & review --

/**
 * Close a trip out.
 *
 * `trips.status` has carried a 'completed' value since the first migration and
 * nothing ever set it, which meant the last two stages of the lifecycle in the
 * brief — Complete, then Review — had no way to begin. This is that door.
 *
 * It refuses to close a trip that is still running, because a completed trip
 * is what unlocks reviewing and a group cannot rate a dinner they have not
 * eaten. It does not refuse on an unpaid balance: chasing money is a separate
 * job from admitting the trip is over, and conflating them means an operator
 * cannot close their books on a group that still owes them.
 */
export async function completeTrip(tripId: string): Promise<void> {
  const supabase = serviceRoleClient();

  const { data: tripRow } = await supabase
    .from("trips")
    .select("status, ends_on")
    .eq("id", tripId)
    .single();

  const trip = tripRow as { status: string; ends_on: string | null } | null;
  if (!trip) throw new Error("completeTrip: no such trip");
  if (trip.status === "completed") return;
  if (trip.status === "draft" || trip.status === "quoted") {
    throw new Error("A trip that was never confirmed cannot be completed.");
  }

  const today = new Date().toISOString().slice(0, 10);
  if (trip.ends_on && trip.ends_on > today) {
    throw new Error(
      `This trip runs until ${trip.ends_on}. You can close it out once it has finished.`
    );
  }

  await supabase
    .from("trips")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("id", tripId);
}

/**
 * Rate the trip, or one stop on it.
 *
 * `itemId: null` is the trip-level review — the Review stage in the brief.
 * Per-stop rows are what make it useful to an operator, because "the group
 * rated the Chopta camp 2" is a conversation with a vendor and "the group
 * enjoyed themselves" is not.
 *
 * Re-rating replaces rather than stacks, so a traveler changing their mind
 * does not count twice against a vendor.
 */
export async function saveReview(input: {
  tripId: string;
  itemId?: string | null;
  authorId: string | null;
  rating: number;
  comment?: string | null;
}): Promise<void> {
  const rating = Math.round(input.rating);
  if (rating < 1 || rating > 5) throw new Error("Ratings run from 1 to 5.");

  const supabase = serviceRoleClient();

  /**
   * Matched by hand rather than with `upsert`.
   *
   * The unique index is on `coalesce(item_id, <zero uuid>)`, because SQL treats
   * two nulls as distinct and a plain unique index would have let one person
   * leave any number of trip-level reviews. PostgREST cannot name an expression
   * index as a conflict target, so a read-then-write is what makes the
   * constraint reachable from here.
   */
  const base = supabase.from("reviews").select("id").eq("trip_id", input.tripId);

  // Both of these are nullable, and `.eq(col, null)` does not match a null —
  // it compares against the string "null" and quietly finds nothing, which is
  // how re-rating started inserting a second row instead of updating the
  // first. Each has to branch to `.is()` when absent.
  const byAuthor = input.authorId
    ? base.eq("author_id", input.authorId)
    : base.is("author_id", null);

  const existing = await (input.itemId
    ? byAuthor.eq("item_id", input.itemId)
    : byAuthor.is("item_id", null)
  ).maybeSingle();

  const row = existing.data as { id: string } | null;

  if (row) {
    const { error } = await supabase
      .from("reviews")
      .update({
        rating,
        comment: input.comment ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    if (error) throw new Error(`saveReview: ${error.message}`);
    return;
  }

  const { error } = await supabase.from("reviews").insert({
    trip_id: input.tripId,
    item_id: input.itemId ?? null,
    author_id: input.authorId,
    rating,
    comment: input.comment ?? null,
  });
  if (error) throw new Error(`saveReview: ${error.message}`);
}
