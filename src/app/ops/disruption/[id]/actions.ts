"use server";

import { revalidatePath } from "next/cache";
import { runReplanAgent } from "@/lib/agent/replan";
import { recordVendorReply, replyToOps } from "@/lib/agent/vendor-reply";
import { validateOps } from "@/lib/agent/plan";
import { getItems } from "@/lib/db/queries";
import { formatTime } from "@/lib/format";
import { applyProposal } from "@/lib/db/mutations";
import { serviceRoleClient } from "@/lib/db/client";
import { assertProposalAccess, assertTripAccess } from "@/lib/auth/guard";
import { notifyTrip } from "@/lib/realtime/notify";

export async function runAgentAction(formData: FormData): Promise<void> {
  const disruptionId = String(formData.get("disruptionId"));
  const tripId = String(formData.get("tripId"));
  await assertTripAccess(tripId);

  const { proposals } = await runReplanAgent(disruptionId);

  revalidatePath(`/ops/disruption/${disruptionId}`);
  revalidatePath(`/trip/${tripId}`);
  revalidatePath("/ops");

  await notifyTrip(tripId, "replan_ready", { proposals });
}

export async function acceptProposalAction(formData: FormData): Promise<void> {
  const proposalId = String(formData.get("proposalId"));
  const disruptionId = String(formData.get("disruptionId"));
  await assertProposalAccess(proposalId);

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
  await assertProposalAccess(proposalId);

  const supabase = serviceRoleClient();
  await supabase
    .from("replan_proposals")
    .update({ state: "rejected", decided_at: new Date().toISOString() })
    .eq("id", proposalId);

  revalidatePath(`/ops/disruption/${disruptionId}`);
}

/**
 * A supplier wrote back.
 *
 * In a deployed system this is an inbox — email, or a WhatsApp webhook. Here
 * the operator pastes what they were sent, which is the honest prototype of it:
 * the interesting work is not receiving the message, it is turning a sentence
 * into a decision, and that part is real.
 *
 * What happens next is the whole point. The reply is parsed and filed against
 * the thread; if it changes the plan, the change becomes an ordinary proposal —
 * same validator, same card, same accept button as the re-planner's. It is
 * tagged `source: 'vendor'` so the board can say where it came from rather than
 * crediting the agent with the supplier's idea. Nothing is applied here: a
 * supplier gets no more authority over an itinerary than the model does.
 */
export async function recordVendorReplyAction(formData: FormData): Promise<void> {
  const disruptionId = String(formData.get("disruptionId"));
  const tripId = String(formData.get("tripId"));
  const itemId = String(formData.get("itemId") || "");
  const body = String(formData.get("body") ?? "").trim();
  await assertTripAccess(tripId);

  if (!body) throw new Error("Paste what the supplier wrote.");

  const { parsed } = await recordVendorReply({
    threadKey: `replan:${disruptionId}`,
    tripId,
    body,
  });

  // Only a reply about a specific stop can propose anything about it.
  const item = itemId
    ? (await getItems(tripId)).find((i) => i.id === itemId)
    : undefined;

  if (item) {
    const ops = replyToOps(parsed, {
      id: item.id,
      day: item.day,
      localTime: formatTime(item.starts_at),
    });

    if (ops.length > 0) {
      const validated = await validateOps(tripId, ops);
      if (validated.errors.length === 0) {
        await serviceRoleClient().from("replan_proposals").insert({
          disruption_id: disruptionId,
          trip_id: tripId,
          source: "vendor",
          plan: validated.normalised,
          cost_delta: validated.costDelta,
          rationale:
            `The supplier offered ${parsed.alternativeTime}.` +
            (parsed.conditions.length
              ? ` Conditions: ${parsed.conditions.join("; ")}.`
              : "") +
            (parsed.notes ? ` ${parsed.notes}` : ""),
          state: "draft",
        });
      }
    }
  }

  revalidatePath(`/ops/disruption/${disruptionId}`);
}
