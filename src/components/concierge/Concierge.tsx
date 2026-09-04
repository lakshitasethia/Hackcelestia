"use client";

import { useRouter } from "next/navigation";
import AgentChat from "./AgentChat";
import {
  acceptConciergeProposalAction,
  askConciergeAction,
  declineConciergeProposalAction,
} from "@/app/trip/[id]/concierge/actions";
import type { ThreadMessage } from "@/lib/agent/thread-types";

/**
 * Vela on the traveler's own itinerary.
 *
 * The only agent in the product with a write path, and it is a narrow one: she
 * writes drafts, and the Accept button on a draft runs `applyProposal` — the
 * same deterministic code an operator's accepted re-plan runs. Everything else
 * here is the shared panel.
 */
export default function Concierge({
  tripId,
  initialThread,
}: {
  tripId: string;
  initialThread: ThreadMessage[];
}) {
  const router = useRouter();

  return (
    <AgentChat
      storageKey={`vela:${tripId}`}
      name="Vela"
      subtitle="Your concierge · suggests, never books"
      callToAction="Ask Vela"
      emptyState="Ask me anything about your trip, or tell me what you would like to change. I will show you the change before anything happens."
      openers={[
        "What are we doing tomorrow?",
        "Add a wine tasting on day 4",
        "Something indoors if it rains",
      ]}
      placeholder="Tell me what you'd like…"
      initialThread={initialThread}
      ask={(question) => askConciergeAction(tripId, question)}
      decide={(proposalId, accept) =>
        accept
          ? acceptConciergeProposalAction(tripId, proposalId)
          : declineConciergeProposalAction(tripId, proposalId)
      }
      // The itinerary behind the panel has just changed.
      onApplied={() => router.refresh()}
    />
  );
}
