"use server";

import { revalidatePath } from "next/cache";
import { askConcierge } from "@/lib/agent/concierge";
import { getConciergeThread } from "@/lib/agent/thread";
import { applyProposal } from "@/lib/db/mutations";
import { serviceRoleClient } from "@/lib/db/client";
import { assertTripAccess } from "@/lib/auth/guard";
import { notifyTrip } from "@/lib/realtime/notify";
import type { ThreadResult } from "@/lib/agent/thread-types";

/**
 * Everything the chat widget can do.
 *
 * Each action returns the whole thread rather than a delta. A conversation is a
 * few dozen rows and the server has already read them to answer; returning the
 * state instead of a patch means the widget cannot drift from the database,
 * which matters most in the case it is hardest to test — two tabs open, or a
 * proposal accepted somewhere else between one message and the next.
 */

export async function askConciergeAction(
  tripId: string,
  question: string
): Promise<ThreadResult> {
  await assertTripAccess(tripId);

  const asked = question.trim();
  if (!asked) return { messages: await getConciergeThread(tripId) };
  if (asked.length > 500) {
    return {
      messages: await getConciergeThread(tripId),
      error: "That is longer than I can read — try it in a sentence or two.",
    };
  }

  try {
    await askConcierge(tripId, asked);
  } catch (cause) {
    return {
      messages: await getConciergeThread(tripId),
      error: cause instanceof Error ? cause.message : "That did not go through.",
    };
  }
  return { messages: await getConciergeThread(tripId) };
}

/**
 * The confirmation. This is the only path from a conversation to a booking, and
 * it goes through exactly the code an operator's accepted re-plan goes through.
 */
export async function acceptConciergeProposalAction(
  tripId: string,
  proposalId: string
): Promise<ThreadResult> {
  await assertTripAccess(tripId);
  const supabase = serviceRoleClient();

  // `assertTripAccess` above has established this viewer may act on this trip.
  // This is the second half: that the *proposal* belongs to it. Both ids come
  // from the browser, and `applyProposal` trusts whatever it is given.
  const { data } = await supabase
    .from("replan_proposals")
    .select("trip_id, source")
    .eq("id", proposalId)
    .maybeSingle();

  const row = data as { trip_id: string | null; source: string } | null;
  if (!row || row.trip_id !== tripId || row.source !== "concierge") {
    throw new Error("That suggestion does not belong to this trip.");
  }

  await applyProposal(proposalId);

  // A change the traveler made themselves still has to reach the operator's
  // board and the guide's phone — that is the whole point of the three
  // surfaces agreeing.
  revalidatePath(`/trip/${tripId}`);
  revalidatePath(`/trip/${tripId}/build`);
  revalidatePath(`/field/${tripId}`);
  revalidatePath("/ops");
  await notifyTrip(tripId, "itinerary_changed", { source: "concierge" });

  await supabase.from("messages").insert({
    trip_id: tripId,
    thread_key: `concierge:${tripId}`,
    direction: "outbound",
    from_role: "agent",
    body: "Done — that's on your itinerary now, and the office can see it.",
  });

  return { messages: await getConciergeThread(tripId) };
}

export async function declineConciergeProposalAction(
  tripId: string,
  proposalId: string
): Promise<ThreadResult> {
  await assertTripAccess(tripId);
  const supabase = serviceRoleClient();

  // Declining is a first-class outcome, not a hidden one: the draft is marked
  // rejected and kept, so the operator can see what was offered and refused.
  await supabase
    .from("replan_proposals")
    .update({ state: "rejected", decided_at: new Date().toISOString() })
    .eq("id", proposalId)
    .eq("trip_id", tripId)
    .eq("source", "concierge");

  return { messages: await getConciergeThread(tripId) };
}
