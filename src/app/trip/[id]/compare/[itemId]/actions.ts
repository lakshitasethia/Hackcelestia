"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { switchStop } from "@/lib/db/mutations";
import { assertTripAccess } from "@/lib/auth/guard";
import { notifyTrip } from "@/lib/realtime/notify";

/**
 * Switch one stop for another the traveler has just compared it against.
 *
 * Thin on purpose: authorize, write, tell the other two surfaces. The write
 * itself is `switchStop`, which goes the long way round through `validateOps`
 * and `applyProposal` — see the comment on it for why a four-line update would
 * have been the wrong answer.
 */
export async function switchStopAction(formData: FormData): Promise<void> {
  const tripId = String(formData.get("tripId"));
  const itemId = String(formData.get("itemId"));
  const inventoryId = String(formData.get("inventoryId"));
  const startsAt = String(formData.get("startsAt"));

  await assertTripAccess(tripId);
  if (!itemId || !inventoryId || !startsAt) {
    throw new Error("Pick something to switch to.");
  }

  await switchStop({ tripId, itemId, inventoryId, startsAt });

  // A change the traveler made themselves still has to reach the operator's
  // board and the guide's phone — that is the whole point of the three
  // surfaces agreeing.
  revalidatePath(`/trip/${tripId}`);
  revalidatePath(`/trip/${tripId}/build`);
  revalidatePath(`/field/${tripId}`);
  revalidatePath("/ops");
  await notifyTrip(tripId, "itinerary_changed", { source: "traveler" });

  redirect(`/trip/${tripId}`);
}
