import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ItineraryItem, TripPrefs } from "./types";

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
    .select("id, trip_id, depends_on")
    .eq("id", itemId)
    .single();

  if (!item) return;
  const doomed = item as { id: string; trip_id: string; depends_on: string[] };

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

  const { error } = await supabase
    .from("itinerary_items")
    .delete()
    .eq("id", itemId);
  if (error) throw new Error(`removeItem: ${error.message}`);
}

export async function setTripStatus(
  tripId: string,
  status: "draft" | "confirmed" | "in_progress"
): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("trips")
    .update({ status })
    .eq("id", tripId);
  if (error) throw new Error(`setTripStatus: ${error.message}`);
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
