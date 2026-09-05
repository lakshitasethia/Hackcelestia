import { readClient } from "./client";
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
  Payment,
  ReplanProposal,
  Review,
  Trip,
  Vendor,
} from "./types";

/**
 * Server-side reads for the traveler, operator and coordinator surfaces.
 *
 * Every one of these goes through `readClient()`, which inside a request is
 * the cookie-scoped client — so RLS is what decides which rows come back, not
 * a filter somebody remembered to write here. `getTrip` is the clearest case:
 * it takes a trip id and applies no ownership condition of its own, because
 * `trips_read` already says `traveler_id = auth.uid() or operator_id =
 * current_operator_id() or coordinator_id = auth.uid()`. Pass someone else's
 * trip id and you get null.
 *
 * That means an empty result is now ambiguous in a way it was not before: it
 * can mean "no rows" or "not yours". Callers that need to tell the difference
 * should say so explicitly rather than inferring it from a length check.
 *
 * Nothing in this file uses the service role. The three places that
 * legitimately do are named in `./client`.
 */

export const DEMO_TRIP_ID = "7a000000-0000-4000-a000-000000000001";

export async function getTrip(tripId: string): Promise<Trip | null> {
  const supabase = await readClient();
  const { data, error } = await supabase
    .from("trips")
    .select("*")
    .eq("id", tripId)
    .maybeSingle();

  if (error) throw new Error(`getTrip: ${error.message}`);
  return data as Trip | null;
}

export async function getItems(tripId: string): Promise<ItineraryItem[]> {
  const supabase = await readClient();
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
  const supabase = await readClient();
  const { data, error } = await supabase
    .from("bookings")
    .select("*")
    .eq("trip_id", tripId);

  if (error) throw new Error(`getBookings: ${error.message}`);
  return (data ?? []) as Booking[];
}

export async function getOpenDisruptions(tripId: string): Promise<Disruption[]> {
  const supabase = await readClient();
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
  const supabase = await readClient();

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
  const supabase = await readClient();
  const { data, error } = await supabase
    .from("trips")
    .select("*")
    .order("starts_on", { ascending: true });

  if (error) throw new Error(`getOperatorTrips: ${error.message}`);
  return (data ?? []) as Trip[];
}

export async function getVendors(): Promise<Vendor[]> {
  const supabase = await readClient();
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
  const supabase = await readClient();

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
  const supabase = await readClient();
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

/**
 * What every group on the board has paid, and what is still owed.
 *
 * The per-trip ledger answers "does this group owe us anything"; an operator
 * managing payments centrally — which is the phrasing in the brief — needs the
 * other question, "how much is outstanding across everything". One query
 * rather than one per trip, because the board renders it in a header.
 *
 * Deliberately reads `trips.budget` as the amount owed rather than summing
 * itinerary rows: the board holds the trip list already, and a second pass
 * over every stop of every trip to render one number is a real cost for an
 * answer that is the same to within rounding.
 */
export async function getOperatorMoney(
  trips: Trip[]
): Promise<{ paid: number; owed: number; outstanding: number }> {
  const ids = trips
    .filter((t) => t.status !== "cancelled")
    .map((t) => t.id);

  if (ids.length === 0) return { paid: 0, owed: 0, outstanding: 0 };

  const supabase = await readClient();
  const { data, error } = await supabase
    .from("payments")
    .select("trip_id, kind, amount")
    .in("trip_id", ids);

  if (error) throw new Error(`getOperatorMoney: ${error.message}`);

  let paid = 0;
  for (const row of (data ?? []) as { kind: string; amount: number }[]) {
    paid += row.kind === "refund" ? -Number(row.amount) : Number(row.amount);
  }

  const owed = trips
    .filter((t) => t.status !== "cancelled" && t.status !== "draft")
    .reduce((sum, t) => sum + Number(t.budget ?? 0), 0);

  return {
    paid,
    owed,
    outstanding: Math.round((owed - paid) * 100) / 100,
  };
}

// -------------------------------------------------------------- catalogue --

export type InventoryOption = Inventory & {
  vendors: { id: string; name: string; channel: "auto" | "manual" } | null;
};

/** Everything bookable, for the traveler's picker. */
export async function getInventory(): Promise<InventoryOption[]> {
  const supabase = await readClient();
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
  const supabase = await readClient();
  const { data, error } = await supabase.from("inventory").select("tags");
  if (error) throw new Error(`getInterestTags: ${error.message}`);

  const tags = new Set<string>();
  for (const row of (data ?? []) as { tags: string[] }[]) {
    for (const tag of row.tags ?? []) tags.add(tag);
  }
  return [...tags].sort();
}

export async function getOperators(): Promise<Operator[]> {
  const supabase = await readClient();
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
  const supabase = await readClient();
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
  const supabase = await readClient();
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
  const supabase = await readClient();
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
  const supabase = await readClient();

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

// ----------------------------------------------------------- alternatives --

export interface Alternative {
  inventory: Inventory;
  vendorName: string;
  /** The bookable slot on the day this stop already sits on. */
  startsAt: string;
  price: number;
  slotsFree: number;
  /** `price` minus what the current stop costs. Negative is cheaper. */
  delta: number;
  /** Why it cannot be switched to, or null when it can. */
  blocked: string | null;
}

/**
 * What else this stop could have been.
 *
 * PS-7 asks that travelers "compare alternatives", and until now the only
 * comparison in the product happened after something broke — the disruption
 * engine's candidate list. That is the same question asked in an emergency,
 * and it answers a different one: `findCandidates` filters by the *cause* of a
 * disruption and deliberately returns only activities and guides, because you
 * do not replace a rained-off boat with a hotel.
 *
 * This is the calm version. Like for like on `type`, so a hotel is compared
 * with hotels and a dinner with dinners; same town, because a comparison you
 * cannot act on is noise; and priced against the stop that is actually booked,
 * so the number on the card is the number the trip total moves by.
 *
 * Reasons a row is *shown but blocked* are deliberate. Hiding a sold-out
 * alternative means a traveler asks why their friend's suggestion is missing;
 * showing it greyed out with "no seats on 14 March" answers that without
 * anyone having to ask.
 */
export async function getAlternatives(
  item: ItineraryItem
): Promise<Alternative[]> {
  const supabase = await readClient();
  const date = item.starts_at.slice(0, 10);

  // Where the current stop is, so the comparison stays in town. Researched
  // rows carry a city and no coordinates, which is why this is by name.
  const { data: currentInv } = item.inventory_id
    ? await supabase
        .from("inventory")
        .select("city, tier")
        .eq("id", item.inventory_id)
        .maybeSingle()
    : { data: null };
  const here = currentInv as { city: string | null; tier: string | null } | null;

  const [{ data, error }, { data: onTrip }] = await Promise.all([
    supabase
      .from("availability")
      .select("*, inventory(*, vendors(name, channel))")
      .eq("date", date),
    supabase
      .from("itinerary_items")
      .select("inventory_id")
      .eq("trip_id", item.trip_id)
      .not("inventory_id", "is", null),
  ]);

  if (error) throw new Error(`getAlternatives: ${error.message}`);

  const alreadyOnTrip = new Set(
    ((onTrip ?? []) as { inventory_id: string | null }[])
      .map((row) => row.inventory_id)
      .filter((id): id is string => Boolean(id))
  );

  type Row = {
    starts_at: string;
    price: number | null;
    slots_total: number;
    slots_taken: number;
    inventory:
      | (Inventory & { vendors: { name: string; channel: string } | null })
      | null;
  };

  const cost = Number(item.cost);

  return ((data ?? []) as unknown as Row[])
    .filter((row) => {
      const inv = row.inventory;
      if (!inv) return false;
      if (inv.id === item.inventory_id) return false; // the one already booked
      if (inv.type !== item.type) return false; // like for like
      // Same town. A row with no city recorded is kept rather than guessed at.
      if (here?.city && inv.city && inv.city !== here.city) return false;
      return true;
    })
    .map((row) => {
      const inv = row.inventory!;
      const price = Number(row.price ?? inv.base_cost);
      const slotsFree = row.slots_total - row.slots_taken;

      return {
        inventory: inv,
        vendorName: inv.vendors?.name ?? "Unknown vendor",
        startsAt: row.starts_at,
        price,
        slotsFree,
        delta: Math.round((price - cost) * 100) / 100,
        blocked: alreadyOnTrip.has(inv.id)
          ? "Already on this trip"
          : slotsFree <= 0
            ? "No seats left that day"
            : null,
      };
    })
    // Cheapest first. A traveler comparing options is usually asking what it
    // would cost to trade up or down, and an ordering by price is the one that
    // makes that legible at a glance.
    .sort((a, b) => a.price - b.price);
}

// --------------------------------------------------------------- payments --

export interface PaymentSummary {
  /** What the live itinerary comes to. The thing being paid for. */
  due: number;
  /** Deposits and balances received, less refunds given back. */
  paid: number;
  /** `due - paid`. Negative means the traveler is owed money. */
  outstanding: number;
  refunded: number;
  /** What cancelling everything today would cost, from the booking penalties. */
  penaltyIfCancelled: number;
  payments: Payment[];
}

export async function getPayments(tripId: string): Promise<Payment[]> {
  const supabase = await readClient();
  const { data, error } = await supabase
    .from("payments")
    .select("*")
    .eq("trip_id", tripId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`getPayments: ${error.message}`);
  return (data ?? []) as Payment[];
}

/**
 * The money position on one trip.
 *
 * `kind` carries the sign, not the number — see the migration. A refund is a
 * positive `amount` with kind 'refund', so a stray minus sign in a form cannot
 * turn a payment into its opposite, and this is the one place that knows which
 * way each kind points.
 *
 * 'adjustment' is deliberately additive: it exists for the small corrections
 * that are not a fresh payment (a rounding fix, a goodwill credit applied to
 * the balance), and an operator entering one wants it to move the balance the
 * way the arithmetic reads.
 */
export function summarizePayments(
  items: ItineraryItem[],
  bookings: Booking[],
  payments: Payment[]
): PaymentSummary {
  const { total, penaltyIfCancelled } = summarize(items, bookings);

  let received = 0;
  let refunded = 0;
  for (const payment of payments) {
    const amount = Number(payment.amount);
    if (payment.kind === "refund") refunded += amount;
    else received += amount;
  }

  const paid = received - refunded;

  return {
    due: total,
    paid,
    outstanding: Math.round((total - paid) * 100) / 100,
    refunded,
    penaltyIfCancelled,
    payments,
  };
}

// ---------------------------------------------------------------- reviews --

export async function getReviews(tripId: string): Promise<Review[]> {
  const supabase = await readClient();
  const { data, error } = await supabase
    .from("reviews")
    .select("*")
    .eq("trip_id", tripId);

  if (error) throw new Error(`getReviews: ${error.message}`);
  return (data ?? []) as Review[];
}

/**
 * Every review this operator's trips have collected, newest first, with enough
 * context to act on one.
 *
 * The point of per-stop ratings is the conversation they start with a vendor,
 * so the stop's title and the group it came from travel with the number.
 */
export interface ReviewWithContext extends Review {
  trips: { title: string; contact_name: string | null } | null;
  itinerary_items: { title: string; type: string } | null;
}

export async function getOperatorReviews(
  limit = 50
): Promise<ReviewWithContext[]> {
  const supabase = await readClient();
  const { data, error } = await supabase
    .from("reviews")
    .select("*, trips(title, contact_name), itinerary_items(title, type)")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`getOperatorReviews: ${error.message}`);
  return (data ?? []) as unknown as ReviewWithContext[];
}

// -------------------------------------------------------------- customers --

/**
 * One row per person who has travelled with this operator.
 *
 * PS-7 lists "customers" first among the things an operator manages centrally,
 * and the board had no such view — a customer existed only as a name attached
 * to a trip, so the same person booking twice was two unrelated rows and
 * nobody could see it.
 *
 * Identity is the contact email where there is one, falling back to the name.
 * That is imperfect and deliberately so: without an accounts system a tour
 * operator's customer identity really is "the email they gave us", and
 * inventing a stronger key would be inventing a fact.
 */
export interface Customer {
  key: string;
  name: string;
  email: string | null;
  phone: string | null;
  trips: Trip[];
  /** Value of every trip they have booked, live ones included. */
  lifetimeValue: number;
  travellers: number;
  /** Their most recent trip's start date, for sorting. */
  lastSeen: string | null;
}

export async function getCustomers(): Promise<Customer[]> {
  const trips = await getOperatorTrips();

  const byKey = new Map<string, Customer>();
  for (const trip of trips) {
    const key = (trip.contact_email || trip.contact_name || trip.id).toLowerCase();
    if (!byKey.has(key)) {
      byKey.set(key, {
        key,
        name: trip.contact_name ?? "Unnamed traveler",
        email: trip.contact_email,
        phone: trip.contact_phone,
        trips: [],
        lifetimeValue: 0,
        travellers: 0,
        lastSeen: null,
      });
    }

    const customer = byKey.get(key)!;
    customer.trips.push(trip);
    // A cancelled trip is history, not revenue.
    if (trip.status !== "cancelled") {
      customer.lifetimeValue += Number(trip.budget ?? 0);
    }
    customer.travellers = Math.max(customer.travellers, trip.party_size);
    if (trip.starts_on && (!customer.lastSeen || trip.starts_on > customer.lastSeen)) {
      customer.lastSeen = trip.starts_on;
    }
  }

  return [...byKey.values()].sort((a, b) =>
    (b.lastSeen ?? "").localeCompare(a.lastSeen ?? "")
  );
}
