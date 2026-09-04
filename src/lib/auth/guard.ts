import "server-only";
import { getTrip } from "@/lib/db/queries";
import { serviceRoleClient } from "@/lib/db/client";
import { getViewer, type Viewer } from "./session";
import type { Trip } from "@/lib/db/types";

/**
 * The check every mutating server action owes the database.
 *
 * Writes run as the service role — `applyProposal` has to move availability
 * seats and cancel vendor bookings, which no user-facing policy permits, and
 * correctly so. That buys correctness at the cost of a bypass: the write layer
 * will happily act on any trip id it is handed. A server action taking
 * `tripId` from a form is exactly where a stranger would hand it someone
 * else's.
 *
 * So authorization happens here, and it asks the database rather than
 * reimplementing the rules: `getTrip` is an RLS-scoped read, so it returns the
 * trip only if `trips_read` says this viewer may see it — their own trip, their
 * operator's, or the group they are running. If RLS would hide it, this
 * throws, and the write never happens.
 *
 * One consequence worth keeping: this is the *same* predicate the read path
 * uses, so the two can never drift apart the way a hand-written
 * `if (trip.traveler_id !== user.id)` eventually does.
 */
export async function assertTripAccess(
  tripId: string
): Promise<{ trip: Trip; viewer: Viewer }> {
  const viewer = await getViewer();
  if (!viewer) {
    throw new Error("Not signed in.");
  }

  const trip = await getTrip(tripId);
  if (!trip) {
    /**
     * Deliberately the same message whether the trip does not exist or belongs
     * to somebody else. Telling them apart lets a stranger enumerate which trip
     * ids are real, and there is nothing a legitimate user does with the
     * distinction.
     */
    throw new Error("That trip is not available.");
  }

  return { trip, viewer };
}

/** For actions that identify their target by role rather than by trip. */
export async function assertRole(
  ...allowed: Viewer["role"][]
): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) throw new Error("Not signed in.");
  if (!allowed.includes(viewer.role)) {
    throw new Error(`This action is for ${allowed.join(" or ")} accounts.`);
  }
  return viewer;
}

/**
 * The same check, for actions that name an itinerary item rather than a trip.
 *
 * The lookup runs as the service role and the *gate* runs as the viewer. That
 * split is deliberate: resolving an id to its trip reveals nothing (you learn
 * a uuid you already guessed), while asking RLS about that trip is the actual
 * decision. Doing the lookup through RLS instead would collapse "this item
 * does not exist" and "this item is not yours" into one silent empty result,
 * before the guard ever ran.
 */
export async function assertItemAccess(itemId: string) {
  const { data } = await serviceRoleClient()
    .from("itinerary_items")
    .select("trip_id")
    .eq("id", itemId)
    .maybeSingle();

  const tripId = (data as { trip_id: string } | null)?.trip_id;
  if (!tripId) throw new Error("That stop is not available.");

  return assertTripAccess(tripId);
}

/** And for actions that name a proposal — accept, reject. */
export async function assertProposalAccess(proposalId: string) {
  const { data } = await serviceRoleClient()
    .from("replan_proposals")
    .select("trip_id, disruption_id, disruptions(trip_id)")
    .eq("id", proposalId)
    .maybeSingle();

  const row = data as
    | { trip_id: string | null; disruptions: { trip_id: string } | null }
    | null;

  // A proposal hangs off either a disruption or, since the concierge landed, a
  // trip directly. Both routes lead to the same question.
  const tripId = row?.trip_id ?? row?.disruptions?.trip_id;
  if (!tripId) throw new Error("That proposal is not available.");

  return assertTripAccess(tripId);
}
