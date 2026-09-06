/**
 * Domain types for the Voyage schema.
 *
 * Row shapes and the status/type unions are derived from `generated.ts`, which
 * is read straight off the live database — so they cannot drift from Postgres.
 * What lives here is the shape Postgres cannot express: the contents of jsonb
 * columns, and the query results that only exist as function output.
 *
 * Regenerate after every migration: `npm run db:types`.
 */

import type {
  AgentRunsRow,
  AgentStepsRow,
  AvailabilityRow,
  BookingsRow,
  DisruptionsRow,
  InventoryRow,
  ItineraryItemsRow,
  MessagesRow,
  OperatorsRow,
  ProfilesRow,
  PaymentsRow,
  ReplanProposalsRow,
  ReviewsRow,
  TripsRow,
  VendorsRow,
} from "./generated";

export type Profile = ProfilesRow;
export type Operator = OperatorsRow;
export type Vendor = VendorsRow;
export type Inventory = InventoryRow;
export type Availability = AvailabilityRow;
export type Booking = BookingsRow;
export type Message = MessagesRow;
export type AgentRun = AgentRunsRow;
export type AgentStep = AgentStepsRow;
export type ItineraryItem = ItineraryItemsRow;
export type Payment = PaymentsRow;
export type Review = ReviewsRow;

/** jsonb columns come back as `Json`; these override them with real shapes. */
export type Trip = Omit<TripsRow, "prefs"> & { prefs: TripPrefs };
export type Disruption = Omit<DisruptionsRow, "payload"> & {
  payload: DisruptionPayload;
};
export type ReplanProposal = Omit<ReplanProposalsRow, "plan"> & {
  plan: ReplanOp[];
};

// Pulled off the row types so the CHECK constraints stay the single source.
export type Role = ProfilesRow["role"];
export type VendorType = VendorsRow["type"];
export type ItemType = ItineraryItemsRow["type"];
export type TripStatus = TripsRow["status"];
export type ItemStatus = ItineraryItemsRow["status"];
export type FieldState = ItineraryItemsRow["field_state"];
export type BookingState = BookingsRow["state"];
export type DisruptionSource = DisruptionsRow["source"];
export type Severity = DisruptionsRow["severity"];
export type DisruptionState = DisruptionsRow["state"];
export type ProposalState = ReplanProposalsRow["state"];
export type AgentKind = AgentRunsRow["kind"];
export type AgentStatus = AgentRunsRow["status"];

/**
 * Structured output of the intake agent. Everything is optional on purpose — a
 * traveler who says "a week in Italy, we like food" should still produce a
 * valid spec rather than an extraction failure.
 */
export interface TripPrefs {
  interests?: string[];
  pace?: "relaxed" | "moderate" | "packed";
  dietary?: string[];
  mobility?: string;
  style?: string;
  /**
   * Where they want to sleep. PS-7 names "accommodation preferences" twice and
   * this is the field behind it: the composer matches it against
   * `inventory.tier` when it picks a bed, and says so on the plan when the town
   * had nothing in that bracket.
   */
  lodging?: LodgingTier;
}

/** The brackets a traveler actually expresses a preference in. Mirrors
 *  `inventory.tier`, which is where the matching happens. */
export type LodgingTier = NonNullable<InventoryRow["tier"]>;

export const LODGING_TIERS: {
  value: LodgingTier;
  label: string;
  hint: string;
}[] = [
  { value: "budget", label: "Budget", hint: "hostels, huts, dorms" },
  { value: "midrange", label: "Mid-range", hint: "clean, private, en-suite" },
  { value: "boutique", label: "Boutique", hint: "small and characterful" },
  { value: "luxury", label: "Luxury", hint: "the best bed in town" },
];

/** What the disruption injector records about the cause. */
export interface DisruptionPayload {
  condition?: string;
  wind_kts?: number;
  rain_mm?: number;
  vendor_message?: string;
  delay_min?: number;
  [key: string]: unknown;
}

/**
 * One operation in a re-plan. The agent emits an ordered list of these, and
 * applying them is a separate step taken by a human — a proposal never mutates
 * a live booking on its own.
 */
export type ReplanOp =
  | { op: "drop"; item_id: string; reason: string }
  | {
      op: "move";
      item_id: string;
      starts_at: string;
      ends_at: string;
      reason: string;
    }
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

/** A blast_radius() row joined back to the item it names. */
export interface AffectedItem extends ItineraryItem {
  depth: number;
}
