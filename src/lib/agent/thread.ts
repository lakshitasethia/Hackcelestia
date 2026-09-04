import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getItems, getTrip } from "@/lib/db/queries";
import { conciergeThread } from "./concierge";
import { describeOp } from "./concierge-tools";
import type { ReplanOp } from "@/lib/db/types";
import type { ProposalView, ThreadMessage } from "./thread-types";

/**
 * The conversation, with each draft resolved into something readable.
 *
 * A proposal is stored as operations over ids — the form `applyProposal` needs.
 * Nobody can approve that, so it is rendered here into the same sentences the
 * tests assert on, using `describeOp`. One description, three readers.
 */
export async function getConciergeThread(
  tripId: string
): Promise<ThreadMessage[]> {
  const supabase = createAdminClient();

  const [{ data: rows }, trip, items] = await Promise.all([
    supabase
      .from("messages")
      .select("id, from_role, body, sent_at, structured")
      .eq("thread_key", conciergeThread(tripId))
      .order("sent_at"),
    getTrip(tripId),
    getItems(tripId),
  ]);

  const messages = (rows ?? []) as {
    id: string;
    from_role: string;
    body: string;
    sent_at: string;
    structured: { proposal_id?: string; failed?: boolean } | null;
  }[];

  const proposalIds = messages
    .map((m) => m.structured?.proposal_id)
    .filter((id): id is string => Boolean(id));

  const byId = new Map<string, ProposalView>();

  if (proposalIds.length) {
    const { data: proposals } = await supabase
      .from("replan_proposals")
      .select("id, plan, cost_delta, rationale, state")
      .in("id", proposalIds);

    // Titles come from two places: a stop already on the trip has one, a
    // catalogue option has one, and an operation can name either.
    const itemTitles = new Map(items.map((i) => [i.id, i.title]));
    const { data: inventory } = await supabase.from("inventory").select("id, title");
    const catalogueTitles = new Map(
      ((inventory ?? []) as { id: string; title: string }[]).map((i) => [i.id, i.title])
    );

    for (const row of (proposals ?? []) as {
      id: string;
      plan: ReplanOp[];
      cost_delta: number;
      rationale: string | null;
      state: ProposalView["state"];
    }[]) {
      const [summary, ...rest] = (row.rationale ?? "").split("\n\n");
      byId.set(row.id, {
        id: row.id,
        summary: summary || "Suggested change",
        rationale: rest.join("\n\n"),
        costDelta: Number(row.cost_delta),
        currency: trip?.currency ?? "EUR",
        state: row.state,
        operations: row.plan.map((op) =>
          describeOp(op, itemTitles, catalogueTitles)
        ),
      });
    }
  }

  return messages.map((message) => ({
    id: message.id,
    role: message.from_role === "traveler" ? "traveler" : "agent",
    body: message.body,
    sentAt: message.sent_at,
    proposal: message.structured?.proposal_id
      ? byId.get(message.structured.proposal_id) ?? null
      : null,
    ...(message.structured?.failed ? { failed: true } : {}),
  }));
}
