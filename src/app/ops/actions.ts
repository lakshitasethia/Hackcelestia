"use server";

import { revalidatePath } from "next/cache";
import { clearDisruptions } from "@/lib/disruption/engine";
import { runScenario, type ScenarioId } from "@/lib/disruption/scenarios";

/**
 * Demo controls. Server actions rather than API routes because they mutate and
 * then need the pages that read that data to re-render — revalidatePath does
 * both in one step.
 */

export async function injectScenarioAction(formData: FormData): Promise<void> {
  const tripId = String(formData.get("tripId"));
  const scenario = String(formData.get("scenario")) as ScenarioId;

  await runScenario(tripId, scenario);

  // Every surface that shows item status has to move at once, or the operator
  // and the traveler disagree about whether the boat is sailing.
  revalidatePath("/ops");
  revalidatePath(`/trip/${tripId}`);
  revalidatePath("/app");
}

export async function clearDisruptionsAction(formData: FormData): Promise<void> {
  const tripId = String(formData.get("tripId"));
  await clearDisruptions(tripId);

  revalidatePath("/ops");
  revalidatePath(`/trip/${tripId}`);
  revalidatePath("/app");
}
