import { createAdminClient } from "@/lib/supabase/admin";
import { relativeDayLabel, startOfLocalDay } from "@/lib/format";
import type {
  AffectedItem,
  AgentRun,
  AgentStep,
  Booking,
  Disruption,
  Inventory,
  ItineraryItem,
  Operator,
  ReplanProposal,
  Trip,
  Vendor,
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

// --------------------------------------------------------------- operator --

/** Every trip this operator runs, soonest first. */
export async function getOperatorTrips(): Promise<Trip[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("trips")
    .select("*")
    .order("starts_on", { ascending: true });

  if (error) throw new Error(`getOperatorTrips: ${error.message}`);
  return (data ?? []) as Trip[];
}

export async function getVendors(): Promise<Vendor[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("vendors")
    .select("*")
    .order("type")
    .order("name");

  if (error) throw new Error(`getVendors: ${error.message}`);
  return (data ?? []) as Vendor[];
}

/**
 * Every item happening between now and `days` ahead, across all trips —
 * the operator's actual working view. Joined to the trip so each row can say
 * which group it belongs to, since that is the first thing a coordinator asks.
 */
export async function getSchedule(days = 3): Promise<ScheduleEntry[]> {
  const supabase = createAdminClient();

  const from = new Date();
  from.setHours(0, 0, 0, 0);
  const to = new Date(from);
  to.setDate(to.getDate() + days);

  const { data, error } = await supabase
    .from("itinerary_items")
    .select("*, trips(title, contact_name, party_size), vendors(name, channel)")
    .gte("starts_at", from.toISOString())
    .lt("starts_at", to.toISOString())
    .order("starts_at");

  if (error) throw new Error(`getSchedule: ${error.message}`);
  return (data ?? []) as unknown as ScheduleEntry[];
}

export type ScheduleEntry = ItineraryItem & {
  trips: { title: string; contact_name: string | null; party_size: number } | null;
  vendors: { name: string; channel: "auto" | "manual" } | null;
};

/** Open disruptions across every trip, worst first. */
export async function getAllOpenDisruptions(): Promise<
  (Disruption & { trips: { title: string } | null })[]
> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("disruptions")
    .select("*, trips(title)")
    .eq("state", "open")
    .order("detected_at", { ascending: false });

  if (error) throw new Error(`getAllOpenDisruptions: ${error.message}`);
  return (data ?? []) as unknown as (Disruption & {
    trips: { title: string } | null;
  })[];
}

/** Headline numbers for the operator dashboard. */
export function operatorTotals(trips: Trip[], schedule: ScheduleEntry[]) {
  const live = trips.filter(
    (t) => t.status === "in_progress" || t.status === "confirmed"
  );
  const travellers = live.reduce((sum, t) => sum + t.party_size, 0);
  const booked = trips.reduce((sum, t) => sum + Number(t.budget ?? 0), 0);
  const atRisk = schedule.filter((s) => s.status === "at_risk").length;

  return { liveTrips: live.length, travellers, booked, atRisk };
}

// -------------------------------------------------------------- catalogue --

export type InventoryOption = Inventory & {
  vendors: { id: string; name: string; channel: "auto" | "manual" } | null;
};

/** Everything bookable, for the traveler's picker. */
export async function getInventory(): Promise<InventoryOption[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("inventory")
    .select("*, vendors(id, name, channel)")
    .order("type")
    .order("title");

  if (error) throw new Error(`getInventory: ${error.message}`);
  return (data ?? []) as unknown as InventoryOption[];
}

/** Distinct interest tags across the catalogue, so the trip form offers what
 *  actually exists rather than a hard-coded list that drifts from inventory. */
export async function getInterestTags(): Promise<string[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.from("inventory").select("tags");
  if (error) throw new Error(`getInterestTags: ${error.message}`);

  const tags = new Set<string>();
  for (const row of (data ?? []) as { tags: string[] }[]) {
    for (const tag of row.tags ?? []) tags.add(tag);
  }
  return [...tags].sort();
}

export async function getOperators(): Promise<Operator[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.from("operators").select("*").order("name");
  if (error) throw new Error(`getOperators: ${error.message}`);
  return (data ?? []) as Operator[];
}

// ------------------------------------------------------------------ agent --

export interface AgentRunWithSteps extends AgentRun {
  agent_steps: AgentStep[];
}

/** Runs for a disruption, newest first, with their full tool trace. */
export async function getAgentRuns(
  disruptionId: string
): Promise<AgentRunWithSteps[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("agent_runs")
    .select("*, agent_steps(*)")
    .eq("input->>disruption_id", disruptionId)
    .order("started_at", { ascending: false });

  if (error) throw new Error(`getAgentRuns: ${error.message}`);

  return ((data ?? []) as unknown as AgentRunWithSteps[]).map((run) => ({
    ...run,
    agent_steps: [...(run.agent_steps ?? [])].sort((a, b) => a.seq - b.seq),
  }));
}

export async function getProposals(
  disruptionId: string
): Promise<ReplanProposal[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("replan_proposals")
    .select("*")
    .eq("disruption_id", disruptionId)
    .order("cost_delta");

  if (error) throw new Error(`getProposals: ${error.message}`);
  return (data ?? []) as ReplanProposal[];
}

// ----------------------------------------------------------- coordinator --

/**
 * The groups this coordinator is running.
 *
 * With no sign-in there is no `auth.uid()` to match against `coordinator_id`,
 * so this falls back to "every live group that has a coordinator assigned" —
 * which for the seeded operator is exactly one. The filter that replaces it is
 * a single `.eq("coordinator_id", user.id)`, marked here so it is easy to find.
 */
export async function getCoordinatorTrips(): Promise<Trip[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("trips")
    .select("*")
    .not("coordinator_name", "is", null)
    .in("status", ["confirmed", "in_progress"])
    .order("starts_on");

  if (error) throw new Error(`getCoordinatorTrips: ${error.message}`);
  return (data ?? []) as Trip[];
}

/**
 * The run sheet: what this group is doing between now and `days` out.
 *
 * The window opens at local midnight rather than "now" so a stop that started
 * an hour ago is still on screen — the guide standing in it needs to be able to
 * mark it done. It runs past today for the same reason a paper run sheet does:
 * tomorrow's 09:00 departure is tonight's problem, and it is also where a
 * disruption lands first.
 */
export async function getRunSheet(
  tripId: string,
  days = 2
): Promise<ItineraryItem[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("itinerary_items")
    .select("*")
    .eq("trip_id", tripId)
    .gte("starts_at", startOfLocalDay(0).toISOString())
    .lt("starts_at", startOfLocalDay(days).toISOString())
    .neq("status", "replaced")
    .order("starts_at");

  if (error) throw new Error(`getRunSheet: ${error.message}`);
  return (data ?? []) as ItineraryItem[];
}

/** Run-sheet items split into local days, each labelled Today / Tomorrow. */
export function groupByLocalDay(
  items: ItineraryItem[]
): { label: string; items: ItineraryItem[] }[] {
  const days = new Map<string, ItineraryItem[]>();
  for (const item of items) {
    const key = relativeDayLabel(item.starts_at);
    if (!days.has(key)) days.set(key, []);
    days.get(key)!.push(item);
  }
  return [...days].map(([label, list]) => ({ label, items: list }));
}
