"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createTrip } from "@/lib/db/mutations";
import { extractTripSpec, type TripSpec } from "@/lib/agent/intake";
import type { TripPrefs } from "@/lib/db/types";

/**
 * Read a description and hand back a spec for the form to display.
 *
 * Deliberately returns rather than writes. The trip is still created by the
 * form below it, from values the traveler has seen.
 */
export async function readDescriptionAction(
  description: string
): Promise<TripSpec> {
  return extractTripSpec(description);
}

export async function createTripAction(formData: FormData): Promise<void> {
  const title = String(formData.get("title") || "").trim();
  const contactName = String(formData.get("contactName") || "").trim();
  const startsOn = String(formData.get("startsOn") || "");
  const endsOn = String(formData.get("endsOn") || "");

  if (!title || !contactName || !startsOn || !endsOn) {
    throw new Error("Trip name, traveler name and both dates are required.");
  }
  if (endsOn < startsOn) {
    throw new Error("The end date cannot be before the start date.");
  }

  const budgetRaw = String(formData.get("budget") || "").trim();
  const prefs: TripPrefs = {
    // getAll, because interests is a checkbox group — get() would silently keep
    // only the first one and quietly narrow the trip.
    interests: formData.getAll("interests").map(String).filter(Boolean),
    pace: (String(formData.get("pace") || "relaxed") as TripPrefs["pace"]),
    dietary: String(formData.get("dietary") || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    mobility: String(formData.get("mobility") || "").trim() || undefined,
    style: String(formData.get("style") || "").trim() || undefined,
  };

  const tripId = await createTrip({
    title,
    contactName,
    contactEmail: String(formData.get("contactEmail") || "").trim() || undefined,
    partySize: Math.max(1, Number(formData.get("partySize") || 1)),
    budget: budgetRaw ? Number(budgetRaw) : null,
    startsOn,
    endsOn,
    prefs,
    operatorId: String(formData.get("operatorId") || "") || null,
  });

  revalidatePath("/ops");
  revalidatePath("/app");
  redirect(`/trip/${tripId}/build`);
}
