import "server-only";
import { tripChannel, type TripEvent } from "./channel";

/**
 * Push a change out to every surface watching a trip.
 *
 * The three lenses look at the same itinerary, and the demo's whole point is
 * that a re-plan accepted on the operator's screen reaches the guide's phone
 * without anyone refreshing. `revalidatePath` cannot do that — it only
 * re-renders for the person who caused the change.
 *
 * This is Realtime *Broadcast*, not Postgres Changes, and the difference
 * matters. Postgres Changes streams row data, so every client needs a SELECT
 * policy that lets it read those rows — and with no sign-in yet that would mean
 * opening `itinerary_items` to anon, weakening the RLS the schema was careful
 * to establish. A broadcast carries no itinerary data at all: it is a nudge
 * saying "this trip moved", and each client re-fetches through the server,
 * where its own permissions still apply.
 *
 * Sent over HTTP rather than by opening a socket from the server — a route
 * handler that lives for 200ms has no business holding a websocket open.
 */

/**
 * Never throws. A dropped notification degrades to "the other screens update
 * on their next navigation", which is a worse demo but a correct system —
 * whereas letting it throw would roll back an accepted re-plan because a
 * websocket fan-out hiccuped.
 */
export async function notifyTrip(
  tripId: string,
  event: TripEvent,
  payload: Record<string, unknown> = {}
): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;

  try {
    const response = await fetch(`${url}/realtime/v1/api/broadcast`, {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        messages: [
          {
            topic: tripChannel(tripId),
            event,
            payload: { ...payload, at: new Date().toISOString() },
            private: false,
          },
        ],
      }),
    });

    if (!response.ok) {
      console.warn(
        `notifyTrip: broadcast rejected (${response.status}) — surfaces will ` +
          `update on next navigation instead.`
      );
    }
  } catch (error) {
    console.warn(`notifyTrip: ${error instanceof Error ? error.message : error}`);
  }
}
