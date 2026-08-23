"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { addItem, removeItem, setTripStatus } from "@/lib/db/mutations";
import { TRIP_TZ } from "@/lib/format";

export async function addItemAction(formData: FormData): Promise<void> {
  const tripId = String(formData.get("tripId"));
  const inventoryId = String(formData.get("inventoryId"));
  const day = Number(formData.get("day") || 1);
  const localTime = String(formData.get("localTime") || "09:00");

  if (!inventoryId) throw new Error("Pick something to add.");

  await addItem({ tripId, day, inventoryId, localTime, timeZone: TRIP_TZ });

  revalidatePath(`/trip/${tripId}/build`);
  revalidatePath(`/trip/${tripId}`);
  revalidatePath("/ops");
}

export async function removeItemAction(formData: FormData): Promise<void> {
  const tripId = String(formData.get("tripId"));
  await removeItem(String(formData.get("itemId")));

  revalidatePath(`/trip/${tripId}/build`);
  revalidatePath(`/trip/${tripId}`);
  revalidatePath("/ops");
}

export async function confirmTripAction(formData: FormData): Promise<void> {
  const tripId = String(formData.get("tripId"));
  await setTripStatus(tripId, "confirmed");

  revalidatePath(`/trip/${tripId}`);
  revalidatePath("/ops");
  redirect(`/trip/${tripId}`);
}
