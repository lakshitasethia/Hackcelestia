import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getBlastRadius } from "@/lib/db/queries";
import type {
  AffectedItem,
  Disruption,
  DisruptionSource,
  Inventory,
  ItineraryItem,
  Severity,
} from "@/lib/db/types";

/**
 * The deterministic half of dynamic re-planning.
 *
 * Everything here is rules and SQL — no model. That separation is deliberate:
 * the agent on top of this needs a source of truth it can be checked against,
 * and if impact analysis lived inside the prompt there would be no way to tell
 * a bad re-plan from a bad graph walk. These same functions become the agent's
 * tools tomorrow, so a tool returning nonsense is a bug we can catch with a
 * test rather than a re-run.
 */

export interface Candidate {
  inventory: Inventory;
  vendorName: string;
  /** 'auto' vendors can be rebooked by the comms agent unattended. */
  channel: "auto" | "manual";
  startsAt: string;
  price: number;
  slotsFree: number;
  /** Straight-line-ish km from the item being replaced. */
  distanceKm: number | null;
  /**
   * Net EUR change if this replaces the broken item, including the deposit
   * forfeited on cancellation. Negative is cheaper.
   *
   * Precomputed because it is pure arithmetic over data we already hold, and
   * an agent asked to derive it will spend its whole iteration budget calling
   * a pricing tool once per candidate instead of deciding anything.
   */
  netDelta: number;
}

export interface Assessment {
  disruption: Disruption;
  root: ItineraryItem | null;
  /** Root plus everything downstream, nearest hop first. */
  affected: AffectedItem[];
  /** Affected items the re-planner may not touch, and why. */
  locked: AffectedItem[];
  /** Total value of the affected items. */
  exposure: number;
  /** What cancelling them today actually costs — the non-refundable part. */
  sunk: number;
  /** Replacements that survive the cause of the disruption. */
  candidates: Candidate[];
}

/** Rough road distance, mirroring the travel_km() SQL helper. */
function distanceKm(
  aLat: number | null,
  aLng: number | null,
  bLat: number | null,
  bLng: number | null
): number | null {
  if (aLat === null || aLng === null || bLat === null || bLng === null) return null;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const h =
    Math.sin(toRad(bLat - aLat) / 2) ** 2 +
    Math.cos(toRad(aLat)) *
      Math.cos(toRad(bLat)) *
      Math.sin(toRad(bLng - aLng) / 2) ** 2;
  return Math.round(1.3 * 6371 * 2 * Math.asin(Math.sqrt(h)) * 10) / 10;
}

/**
 * Create a disruption and flag everything it threatens.
 *
 * Marking the blast radius `at_risk` rather than `cancelled` is the important
 * bit: nothing is destroyed until a human accepts a re-plan. The traveler sees
 * "this might change", the operator sees a decision waiting, and both views
 * come from the same status column.
 */
export async function injectDisruption(opts: {
  tripId: string;
  rootItemId: string;
  source: DisruptionSource;
  severity?: Severity;
  headline: string;
  payload?: Record<string, unknown>;
}): Promise<Disruption> {
  const supabase = createAdminClient();

  const { data: disruption, error } = await supabase
    .from("disruptions")
    .insert({
      trip_id: opts.tripId,
      root_item_id: opts.rootItemId,
      source: opts.source,
      severity: opts.severity ?? "high",
      headline: opts.headline,
      payload: opts.payload ?? {},
      state: "open",
    })
    .select()
    .single();

  if (error) throw new Error(`injectDisruption: ${error.message}`);

  const affected = await getBlastRadius(opts.rootItemId);
  const flaggable = affected
    .filter((item) => item.status !== "cancelled" && item.status !== "replaced")
    .map((item) => item.id);

  if (flaggable.length > 0) {
    const { error: flagError } = await supabase
      .from("itinerary_items")
      .update({ status: "at_risk" })
      .in("id", flaggable);
    if (flagError) throw new Error(`injectDisruption flag: ${flagError.message}`);
  }

  return disruption as Disruption;
}

/**
 * How far a replacement may sit from the thing it replaces.
 *
 * Generous on purpose — Pompeii is a legitimate wet-weather answer to a boat
 * day off Positano at ~30km, and Wagah is 30km from Amritsar — while still
 * ruling out the other end of the country.
 */
const MAX_SUBSTITUTE_KM = 200;

/**
 * Substitutes that survive whatever caused the disruption.
 *
 * A weather event rules out anything `weather_sensitive` — replacing a rained-off
 * boat trip with a different boat trip is the obvious failure mode, and it is
 * worth excluding in code rather than hoping a model notices.
 */
export async function findCandidates(
  root: ItineraryItem,
  source: DisruptionSource
): Promise<Candidate[]> {
  const supabase = createAdminClient();
  const date = root.starts_at.slice(0, 10);

  const { data: rootBooking } = await supabase
    .from("bookings")
    .select("penalty")
    .eq("item_id", root.id)
    .maybeSingle();
  const penalty = Number((rootBooking as { penalty: number } | null)?.penalty ?? 0);

  const [{ data, error }, { data: booked }] = await Promise.all([
    supabase
      .from("availability")
      .select("*, inventory(*, vendors(name, channel))")
      .eq("date", date),
    // Anything already on this itinerary is not a replacement for anything
    // else on it — including, in the worst case, an item the same disruption
    // just broke being offered as its own fix.
    supabase
      .from("itinerary_items")
      .select("inventory_id")
      .eq("trip_id", root.trip_id)
      .not("inventory_id", "is", null),
  ]);

  if (error) throw new Error(`findCandidates: ${error.message}`);

  const alreadyPlanned = new Set(
    ((booked ?? []) as { inventory_id: string | null }[])
      .map((b) => b.inventory_id)
      .filter((id): id is string => Boolean(id))
  );

  type Row = {
    starts_at: string;
    price: number | null;
    slots_total: number;
    slots_taken: number;
    inventory:
      | (Inventory & { vendors: { name: string; channel: "auto" | "manual" } | null })
      | null;
  };

  return ((data ?? []) as unknown as Row[])
    .filter((row) => {
      const inv = row.inventory;
      if (!inv) return false;
      if (inv.id === root.inventory_id) return false; // the thing that broke
      if (alreadyPlanned.has(inv.id)) return false; // already on this itinerary
      if (row.slots_total - row.slots_taken <= 0) return false;
      if (source === "weather" && inv.weather_sensitive) return false;

      // A substitute has to be somewhere the group can actually get to that
      // day. This was free when the catalogue was one stretch of coast; the
      // moment a second region existed, a storm in Positano started offering
      // the Golden Temple in Amritsar as a replacement — correctly weather-proof,
      // correctly available, and six thousand kilometres away. Rows with no
      // coordinates are kept: unknown is not the same as far.
      const km = distanceKm(root.lat, root.lng, inv.lat, inv.lng);
      if (km !== null && km > MAX_SUBSTITUTE_KM) return false;

      // Replace like with like: a boat day is an experience, not a hotel bed.
      return inv.type === "activity" || inv.type === "guide";
    })
    .map((row) => {
      const inv = row.inventory!;
      const price = Number(row.price ?? inv.base_cost);
      return {
        inventory: inv,
        vendorName: inv.vendors?.name ?? "Unknown vendor",
        channel: inv.vendors?.channel ?? "manual",
        startsAt: row.starts_at,
        price,
        slotsFree: row.slots_total - row.slots_taken,
        distanceKm: distanceKm(root.lat, root.lng, inv.lat, inv.lng),
        netDelta:
          Math.round((price - Number(root.cost) + penalty) * 100) / 100,
      };
    })
    .sort((a, b) => (a.distanceKm ?? 999) - (b.distanceKm ?? 999));
}

/** Full deterministic picture of one disruption. */
export async function assessDisruption(
  disruptionId: string
): Promise<Assessment | null> {
  const supabase = createAdminClient();

  const { data: disruption, error } = await supabase
    .from("disruptions")
    .select("*")
    .eq("id", disruptionId)
    .maybeSingle();

  if (error) throw new Error(`assessDisruption: ${error.message}`);
  if (!disruption) return null;

  const typed = disruption as Disruption;
  if (!typed.root_item_id) {
    return {
      disruption: typed,
      root: null,
      affected: [],
      locked: [],
      exposure: 0,
      sunk: 0,
      candidates: [],
    };
  }

  const affected = await getBlastRadius(typed.root_item_id);
  const root = affected.find((i) => i.id === typed.root_item_id) ?? null;

  const { data: bookings } = await supabase
    .from("bookings")
    .select("item_id, penalty")
    .in("item_id", affected.map((i) => i.id));

  const penaltyByItem = new Map(
    ((bookings ?? []) as { item_id: string | null; penalty: number }[])
      .filter((b) => b.item_id)
      .map((b) => [b.item_id as string, Number(b.penalty)])
  );

  const exposure = affected.reduce((sum, i) => sum + Number(i.cost), 0);
  const sunk = affected.reduce(
    (sum, i) => sum + (penaltyByItem.get(i.id) ?? 0),
    0
  );

  return {
    disruption: typed,
    root,
    affected,
    locked: affected.filter((i) => i.lock_reason),
    exposure,
    sunk,
    candidates: root ? await findCandidates(root, typed.source) : [],
  };
}

/**
 * Put the trip back the way it was.
 *
 * A demo gets rehearsed a dozen times, and re-seeding the whole database
 * between runs is slow and loses anything else in flight. This resets only what
 * a disruption touched.
 */
export async function clearDisruptions(tripId: string): Promise<number> {
  const supabase = createAdminClient();

  const { data: cleared, error } = await supabase
    .from("disruptions")
    .delete()
    .eq("trip_id", tripId)
    .select("id");

  if (error) throw new Error(`clearDisruptions: ${error.message}`);

  const { error: resetError } = await supabase
    .from("itinerary_items")
    .update({ status: "confirmed" })
    .eq("trip_id", tripId)
    .eq("status", "at_risk");

  if (resetError) throw new Error(`clearDisruptions reset: ${resetError.message}`);

  // Anything the coordinator flagged goes back to unreported too. A reset that
  // left "Flagged on the ground" sitting on the run sheet would have the guide
  // and the office disagreeing on the second rehearsal.
  const { error: fieldError } = await supabase
    .from("itinerary_items")
    .update({ field_state: "pending", field_note: null })
    .eq("trip_id", tripId)
    .neq("field_state", "pending");

  if (fieldError) throw new Error(`clearDisruptions field: ${fieldError.message}`);

  // The concierge conversation goes with them, for the same reason. A reset
  // that left yesterday's chat on screen would replay it as history on the next
  // question, and the second rehearsal would start mid-sentence.
  //
  // Undecided drafts go too. An accepted one does not: it is a real change to
  // the itinerary, and deleting the record of a decision somebody made is not
  // what "reset the demo" should mean.
  await supabase
    .from("messages")
    .delete()
    .eq("thread_key", `concierge:${tripId}`);

  await supabase
    .from("replan_proposals")
    .delete()
    .eq("trip_id", tripId)
    .eq("source", "concierge")
    .in("state", ["draft", "rejected"]);

  return (cleared ?? []).length;
}
