"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  addCustomStop,
  addItem,
  confirmTrip,
  removeItem,
} from "@/lib/db/mutations";
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

/**
 * Add a place the catalogue does not have.
 *
 * Guarded by `assertTripAccess` like every other mutating action here, which is
 * the whole authorization story for a write in this codebase: the traveler can
 * only mint a row against a trip RLS already says is theirs.
 *
 * The validation is deliberately about what the rest of the product needs to
 * keep working on this stop, not about being strict for its own sake. A missing
 * duration breaks the timeline arithmetic; a missing town means the transit
 * guard cannot place it and the re-planner may offer a substitute two countries
 * away. So those are required, and the form says why.
 */
export async function addCustomStopAction(formData: FormData): Promise<void> {
  const tripId = String(formData.get("tripId"));
  await assertTripAccess(tripId);

  const title = String(formData.get("title") ?? "").trim();
  const city = String(formData.get("city") ?? "").trim();
  const type = String(formData.get("type") ?? "activity");
  const day = Number(formData.get("day") || 1);
  const localTime = String(formData.get("localTime") || "09:00");
  const durationMin = Number(formData.get("durationMin") || 60);
  const cost = Number(formData.get("cost") || 0);
  const weatherSensitive = formData.get("weatherSensitive") === "on";
  const sourceUrl = String(formData.get("sourceUrl") ?? "").trim() || null;

  if (!title) throw new Error("Give the place a name.");
  if (!city) {
    throw new Error(
      "Say which town it is in — without it we cannot tell whether a " +
        "replacement is nearby or two countries away."
    );
  }
  if (!Number.isFinite(durationMin) || durationMin <= 0) {
    throw new Error("How long does it take? The timeline needs a duration.");
  }
  if (!Number.isFinite(cost) || cost < 0) throw new Error("Cost cannot be negative.");

  const allowed = ["activity", "restaurant", "hotel", "guide", "transport"];
  if (!allowed.includes(type)) throw new Error("Unknown kind of stop.");

  await addCustomStop({
    tripId,
    day,
    localTime,
    timeZone: TRIP_TZ,
    title,
    type: type as "activity" | "restaurant" | "hotel" | "guide" | "transport",
    city,
    durationMin,
    cost,
    weatherSensitive,
    sourceUrl,
  });

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
