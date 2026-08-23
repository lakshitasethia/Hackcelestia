/**
 * Domain types for the Voyage schema.
 *
 * The status/type columns are text + CHECK in Postgres (see the migration for
 * why), so the unions below are where that vocabulary is actually enforced for
 * us. Keep them in step with the CHECK constraints — nothing else will.
 *
 * Row shapes will be replaced by `supabase gen types typescript` output once
 * the project exists; these are the hand-written stand-ins.
 */

export type Role = "traveler" | "operator" | "coordinator";

export type VendorType =
  | "hotel"
  | "activity"
  | "transport"
  | "guide"
  | "restaurant";

/** Itinerary items add `flight`, which is not something a vendor supplies. */
export type ItemType = VendorType | "flight";

export type TripStatus =
  | "draft"
  | "quoted"
  | "confirmed"
  | "in_progress"
  | "completed"
  | "cancelled";

export type ItemStatus =
  | "planned"
  | "confirmed"
  | "at_risk"
  | "cancelled"
  | "replaced";

export type BookingState =
  | "held"
  | "confirmed"
  | "cancelled"
  | "refunded"
  | "failed";

export type DisruptionSource = "weather" | "transport" | "vendor" | "manual";
export type Severity = "low" | "medium" | "high";
export type DisruptionState = "open" | "resolved" | "dismissed";

export type ProposalState =
  | "draft"
  | "sent"
  | "accepted"
  | "rejected"
  | "superseded";

export type AgentKind = "intake" | "compose" | "replan" | "comms" | "copilot";
export type AgentStatus = "running" | "succeeded" | "failed";

export interface Trip {
  id: string;
  traveler_id: string | null;
  operator_id: string | null;
  title: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  status: TripStatus;
  party_size: number;
  budget: number | null;
  currency: string;
  starts_on: string | null;
  ends_on: string | null;
  prefs: TripPrefs;
  created_at: string;
  updated_at: string;
}

/** Structured output of the intake agent. Everything optional — a traveler who
 *  says "a week in Italy, we like food" should still produce a valid spec. */
export interface TripPrefs {
  interests?: string[];
  pace?: "relaxed" | "moderate" | "packed";
  dietary?: string[];
  mobility?: string;
  style?: string;
}

export interface ItineraryItem {
  id: string;
  trip_id: string;
  day: number;
  seq: number;
  inventory_id: string | null;
  vendor_id: string | null;
  title: string;
  type: ItemType;
  starts_at: string;
  ends_at: string;
  lat: number | null;
  lng: number | null;
  cost: number;
  status: ItemStatus;
  /** The DAG edge: ids of items this one cannot happen without. */
  depends_on: string[];
  /** Non-null means the re-planner may not move it; the text says why. */
  lock_reason: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Disruption {
  id: string;
  trip_id: string;
  source: DisruptionSource;
  severity: Severity;
  headline: string;
  root_item_id: string | null;
  payload: Record<string, unknown>;
  state: DisruptionState;
  detected_at: string;
  resolved_at: string | null;
}

/** One operation in a re-plan. The agent emits an ordered list of these;
 *  applying them is a separate, deliberate step taken by a human. */
export type ReplanOp =
  | { op: "drop"; item_id: string; reason: string }
  | { op: "move"; item_id: string; starts_at: string; ends_at: string; reason: string }
  | {
      op: "replace";
      item_id: string;
      with_inventory_id: string;
      starts_at: string;
      ends_at: string;
      reason: string;
    }
  | {
      op: "add";
      inventory_id: string;
      day: number;
      starts_at: string;
      ends_at: string;
      depends_on: string[];
      reason: string;
    };

export interface ReplanProposal {
  id: string;
  disruption_id: string;
  run_id: string | null;
  plan: ReplanOp[];
  cost_delta: number;
  rationale: string | null;
  state: ProposalState;
  created_at: string;
  decided_at: string | null;
  decided_by: string | null;
}

/** One node of the blast radius, as returned by the `blast_radius()` function
 *  joined back to the items it names. */
export interface AffectedItem extends ItineraryItem {
  depth: number;
}
