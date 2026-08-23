import { createAdminClient } from "@/lib/supabase/admin";
import type {
  AffectedItem,
  Booking,
  Disruption,
  ItineraryItem,
  Trip,
} from "./types";

/**
 * Server-side reads for the traveler and operator surfaces.
 *
 * These run through the admin client for now because auth does not exist yet —
 * there is no signed-in user for RLS to key off, so every read would return
 * nothing. Once auth lands, the traveler and coordinator paths move to the
 * cookie-scoped server client and let RLS do the filtering; only the agent
 * routes and the injector keep the admin client. Marked so that swap is easy
 * to find.
 */

export const DEMO_TRIP_ID = "7a000000-0000-4000-a000-000000000001";

export async function getTrip(tripId: string): Promise<Trip | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("trips")
    .select("*")
    .eq("id", tripId)
    .maybeSingle();

  if (error) throw new Error(`getTrip: ${error.message}`);
  return data as Trip | null;
}

export async function getItems(tripId: string): Promise<ItineraryItem[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("itinerary_items")
    .select("*")
    .eq("trip_id", tripId)
    .order("day")
    .order("starts_at");

  if (error) throw new Error(`getItems: ${error.message}`);
  return (data ?? []) as ItineraryItem[];
}

export async function getBookings(tripId: string): Promise<Booking[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("bookings")
    .select("*")
    .eq("trip_id", tripId);

  if (error) throw new Error(`getBookings: ${error.message}`);
  return (data ?? []) as Booking[];
}

export async function getOpenDisruptions(tripId: string): Promise<Disruption[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("disruptions")
    .select("*")
    .eq("trip_id", tripId)
    .eq("state", "open")
    .order("detected_at", { ascending: false });

  if (error) throw new Error(`getOpenDisruptions: ${error.message}`);
  return (data ?? []) as Disruption[];
}

/**
 * Everything downstream of a broken item, nearest first.
 *
 * The traversal itself is the `blast_radius` SQL function — doing it in
 * Postgres rather than by pulling the whole trip and walking it in JS keeps one
 * implementation of the rule, which both this UI and the re-planner agent call.
 */
export async function getBlastRadius(itemId: string): Promise<AffectedItem[]> {
  const supabase = createAdminClient();

  const { data: radius, error } = await supabase.rpc("blast_radius", {
    root: itemId,
  });
  if (error) throw new Error(`getBlastRadius: ${error.message}`);

  const rows = (radius ?? []) as { item_id: string; depth: number }[];
  if (rows.length === 0) return [];

  const depthById = new Map(rows.map((r) => [r.item_id, r.depth]));
  const { data: items, error: itemsError } = await supabase
    .from("itinerary_items")
    .select("*")
    .in("id", [...depthById.keys()]);

  if (itemsError) throw new Error(`getBlastRadius items: ${itemsError.message}`);

  return ((items ?? []) as ItineraryItem[])
    .map((item) => ({ ...item, depth: depthById.get(item.id) ?? 0 }))
    .sort((a, b) => a.depth - b.depth || a.starts_at.localeCompare(b.starts_at));
}

/** Items grouped into days, each day ordered by start time. */
export function groupByDay(items: ItineraryItem[]): Map<number, ItineraryItem[]> {
  const days = new Map<number, ItineraryItem[]>();
  for (const item of items) {
    if (!days.has(item.day)) days.set(item.day, []);
    days.get(item.day)!.push(item);
  }
  for (const list of days.values()) {
    list.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  }
  return new Map([...days].sort((a, b) => a[0] - b[0]));
}

/**
 * What the trip costs, and what walking away from it would cost.
 *
 * `atRisk` is deliberately separate from the total: an item can be threatened
 * without being cancelled, and the traveler needs to see the difference between
 * "this might change" and "this has changed".
 */
export function summarize(items: ItineraryItem[], bookings: Booking[]) {
  const live = items.filter((i) => i.status !== "cancelled" && i.status !== "replaced");

  const total = live.reduce((sum, i) => sum + Number(i.cost), 0);
  const atRisk = live
    .filter((i) => i.status === "at_risk")
    .reduce((sum, i) => sum + Number(i.cost), 0);
  const confirmed = live.filter((i) => i.status === "confirmed").length;
  const penaltyIfCancelled = bookings
    .filter((b) => b.state === "confirmed" || b.state === "held")
    .reduce((sum, b) => sum + Number(b.penalty), 0);

  return { total, atRisk, confirmed, count: live.length, penaltyIfCancelled };
}
