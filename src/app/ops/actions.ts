"use server";

import { revalidatePath } from "next/cache";
import { clearDisruptions } from "@/lib/disruption/engine";
import { runScenario, type ScenarioId } from "@/lib/disruption/scenarios";
import { notifyTrip } from "@/lib/realtime/notify";
import { askCopilot, getCopilotThread, COPILOT_THREAD } from "@/lib/agent/copilot";
import { serviceRoleClient } from "@/lib/db/client";
import { assertRole, assertTripAccess } from "@/lib/auth/guard";
import type { ThreadResult } from "@/lib/agent/thread-types";

/**
 * Demo controls. Server actions rather than API routes because they mutate and
 * then need the pages that read that data to re-render — revalidatePath does
 * both in one step.
 */

export async function injectScenarioAction(formData: FormData): Promise<void> {
  const tripId = String(formData.get("tripId"));
  await assertTripAccess(tripId);

  const scenario = String(formData.get("scenario")) as ScenarioId;
  await runScenario(tripId, scenario);

  // Every surface that shows item status has to move at once, or the operator
  // and the traveler disagree about whether the boat is sailing.
  revalidatePath("/ops");
  revalidatePath(`/trip/${tripId}`);
  revalidatePath(`/field/${tripId}`);
  revalidatePath("/app");

  // revalidatePath only re-renders for whoever clicked. The traveler's tab and
  // the guide's phone are told separately, or they keep showing a plan that is
  // no longer true.
  await notifyTrip(tripId, "disruption_opened");
}

export async function clearDisruptionsAction(formData: FormData): Promise<void> {
  const tripId = String(formData.get("tripId"));
  await assertTripAccess(tripId);

  await clearDisruptions(tripId);

  // The console's own conversation is not scoped to a trip, so `clearDisruptions`
  // cannot reach it — but this is the demo reset button, and a copilot still
  // answering questions about a storm that no longer exists is exactly the kind
  // of thing that gets noticed from the front row.
  await serviceRoleClient().from("messages").delete().eq("thread_key", COPILOT_THREAD);

  revalidatePath("/ops");
  revalidatePath(`/trip/${tripId}`);
  revalidatePath(`/field/${tripId}`);
  revalidatePath("/app");

  await notifyTrip(tripId, "disruption_cleared");
}

/**
 * The console copilot. Read-only by construction — its tools cannot write —
 * so unlike every other action in this file it revalidates nothing.
 */
export async function askCopilotAction(
  question: string
): Promise<ThreadResult> {
  // The copilot reads across the whole operation — every group, every vendor,
  // every open disruption — so unlike the trip-scoped actions the question is
  // not "which trip" but "are you staff at all".
  await assertRole("operator");

  const asked = question.trim();
  if (asked) {
    if (asked.length > 500) {
      return {
        messages: await getCopilotThread(),
        error: "That is longer than I can read — try it in a sentence or two.",
      };
    }
    try {
      await askCopilot(asked);
    } catch (cause) {
      return { messages: await getCopilotThread(), error: cause instanceof Error ? cause.message : "That did not go through." };
    }
  }
  return { messages: await getCopilotThread() };
}
