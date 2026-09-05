"use server";

import { revalidatePath } from "next/cache";
import { completeTrip, saveReview } from "@/lib/db/mutations";
import { assertTripAccess } from "@/lib/auth/guard";
import { notifyTrip } from "@/lib/realtime/notify";

/**
 * Complete, then Review — the last two stages of the lifecycle in the brief.
 *
 * They are separate actions on purpose. Closing a trip out is the operator's
 * or the traveler's admission that it is over; reviewing is optional and can
 * happen days later. Fusing them would mean a trip nobody rated could never be
 * closed, and an operator's board would fill up with finished trips forever.
 */

export async function completeTripAction(formData: FormData): Promise<void> {
  const tripId = String(formData.get("tripId"));
  await assertTripAccess(tripId);

  await completeTrip(tripId);

  revalidatePath(`/trip/${tripId}`);
  revalidatePath(`/trip/${tripId}/review`);
  revalidatePath("/ops");
  await notifyTrip(tripId, "itinerary_changed", { source: "complete" });
}

export async function saveReviewAction(formData: FormData): Promise<void> {
  const tripId = String(formData.get("tripId"));
  const { viewer } = await assertTripAccess(tripId);

  const rating = Number(formData.get("rating") || 0);
  if (!rating) throw new Error("Pick a rating first.");

  // "" is the trip-level review; a uuid is one stop on it.
  const itemId = String(formData.get("itemId") || "") || null;

  await saveReview({
    tripId,
    itemId,
    authorId: viewer.id,
    rating,
    comment: String(formData.get("comment") || "").trim() || null,
  });

  revalidatePath(`/trip/${tripId}/review`);
  // The operator reads these against the vendor who ran the stop, so a rating
  // has to reach their board without anyone refreshing it.
  revalidatePath("/ops");
  revalidatePath("/ops/reviews");
}
