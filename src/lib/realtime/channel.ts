/**
 * The wire contract for trip broadcasts — topic name and event vocabulary.
 *
 * Separate from `notify.ts` because that file is `server-only` (it carries the
 * service-role key) while the subscriber is a client component. Both ends have
 * to agree on the topic string exactly, so it lives in one place rather than
 * being spelled twice.
 */

export type TripEvent =
  | "itinerary_changed"
  | "disruption_opened"
  | "disruption_cleared"
  | "replan_ready"
  | "field_report";

/** The topic all three surfaces subscribe to. */
export function tripChannel(tripId: string): string {
  return `trip:${tripId}`;
}
