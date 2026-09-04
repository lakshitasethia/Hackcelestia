"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createTrip } from "@/lib/db/mutations";
import { getViewer } from "@/lib/auth/session";
import { extractTripSpec, type TripSpec } from "@/lib/agent/intake";
import type { TripPrefs } from "@/lib/db/types";

/**
 * Read a description and hand back a spec for the form to display.
 *
 * Deliberately returns rather than writes. The trip is still created by the
 * form below it, from values the traveler has seen.
 *
 * It returns its failures rather than throwing them, which matters more than
 * it looks. React replaces the message of anything thrown out of a server
 * action in a production build — deliberately, so a stack trace cannot leak —
 * so a thrown error reaches the browser as "An error occurred in the Server
 * Components render", and the user is told nothing at all. A returned failure
 * keeps the sentence that explains what to do about it.
 */
export type IntakeResult =
  | { ok: true; spec: TripSpec }
  | { ok: false; error: string };

export async function readDescriptionAction(
  description: string
): Promise<IntakeResult> {
  try {
    return { ok: true, spec: await extractTripSpec(description) };
  } catch (cause) {
    return {
      ok: false,
      error: cause instanceof Error ? cause.message : "That did not work.",
    };
  }
}

export async function createTripAction(formData: FormData): Promise<void> {
  /**
   * Read the viewer before anything else. A trip created with a null
   * `traveler_id` is invisible to the person who just filled in the form —
   * `trips_read` matches on `traveler_id = auth.uid()`, and null matches
   * nobody. The route is behind the middleware guard, so this is belt and
   * braces, but the failure it prevents is silent.
   */
  const viewer = await getViewer();
  if (!viewer) throw new Error("Sign in before planning a trip.");

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
    travelerId: viewer.id,
  });

  revalidatePath("/ops");
  revalidatePath("/app");
  redirect(`/trip/${tripId}/build`);
}
