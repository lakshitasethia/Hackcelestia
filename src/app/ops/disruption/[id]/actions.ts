"use server";

import { revalidatePath } from "next/cache";
import { runReplanAgent } from "@/lib/agent/replan";
import { applyProposal } from "@/lib/db/mutations";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyTrip } from "@/lib/realtime/notify";

export async function runAgentAction(formData: FormData): Promise<void> {
  const disruptionId = String(formData.get("disruptionId"));
  const tripId = String(formData.get("tripId"));

  const { proposals } = await runReplanAgent(disruptionId);

  revalidatePath(`/ops/disruption/${disruptionId}`);
  revalidatePath(`/trip/${tripId}`);
  revalidatePath("/ops");

  await notifyTrip(tripId, "replan_ready", { proposals });
}

export async function acceptProposalAction(formData: FormData): Promise<void> {
  const proposalId = String(formData.get("proposalId"));
  const disruptionId = String(formData.get("disruptionId"));

  const { tripId } = await applyProposal(proposalId);

  revalidatePath(`/ops/disruption/${disruptionId}`);
  revalidatePath(`/trip/${tripId}`);
  revalidatePath(`/field/${tripId}`);
  revalidatePath("/ops");

  // The moment the demo is built around: one operator click, and the itinerary
  // changes under the traveler and the guide without either of them acting.
  await notifyTrip(tripId, "itinerary_changed");
}

export async function rejectProposalAction(formData: FormData): Promise<void> {
  const proposalId = String(formData.get("proposalId"));
  const disruptionId = String(formData.get("disruptionId"));

  const supabase = createAdminClient();
  await supabase
    .from("replan_proposals")
    .update({ state: "rejected", decided_at: new Date().toISOString() })
    .eq("id", proposalId);

  revalidatePath(`/ops/disruption/${disruptionId}`);
}
