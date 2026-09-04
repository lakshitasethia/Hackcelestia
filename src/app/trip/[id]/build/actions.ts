"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { addItem, confirmTrip, removeItem } from "@/lib/db/mutations";
import { TRIP_TZ } from "@/lib/format";
import { notifyTrip } from "@/lib/realtime/notify";
import { assertTripAccess } from "@/lib/auth/guard";

export async function addItemAction(formData: FormData): Promise<void> {
  const tripId = String(formData.get("tripId"));
  await assertTripAccess(tripId);

  const inventoryId = String(formData.get("inventoryId"));
  const day = Number(formData.get("day") || 1);
  const localTime = String(formData.get("localTime") || "09:00");

  if (!inventoryId) throw new Error("Pick something to add.");

  await addItem({ tripId, day, inventoryId, localTime, timeZone: TRIP_TZ });

  revalidatePath(`/trip/${tripId}/build`);
  revalidatePath(`/trip/${tripId}`);
  revalidatePath("/ops");
  await notifyTrip(tripId, "itinerary_changed");
}

export async function removeItemAction(formData: FormData): Promise<void> {
  const tripId = String(formData.get("tripId"));
  await assertTripAccess(tripId);

  await removeItem(String(formData.get("itemId")));

  revalidatePath(`/trip/${tripId}/build`);
  revalidatePath(`/trip/${tripId}`);
  revalidatePath(`/field/${tripId}`);
  revalidatePath("/ops");
  await notifyTrip(tripId, "itinerary_changed");
}

export async function confirmTripAction(formData: FormData): Promise<void> {
  const tripId = String(formData.get("tripId"));
  await assertTripAccess(tripId);

  // Confirming books every planned stop, so the operator inherits real
  // reservations rather than a trip that only says "confirmed".
  await confirmTrip(tripId);

  revalidatePath(`/trip/${tripId}`);
  revalidatePath("/ops");
  await notifyTrip(tripId, "itinerary_changed");
  redirect(`/trip/${tripId}`);
}
