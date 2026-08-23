import { redirect } from "next/navigation";
import { DEMO_TRIP_ID, getOperatorTrips } from "@/lib/db/queries";

/**
 * The traveler entry point. With no auth there is no "my trip" to resolve, so
 * this lands on the most recent trip — the seeded group during the demo. Once
 * sign-in exists this resolves the trip belonging to the signed-in traveler.
 */
export const dynamic = "force-dynamic";

export default async function TravelerEntry() {
  const trips = await getOperatorTrips();
  redirect(`/trip/${trips[0]?.id ?? DEMO_TRIP_ID}`);
}
