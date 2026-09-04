"use client";

import AgentChat from "./AgentChat";
import { askCopilotAction } from "@/app/ops/actions";
import type { ThreadMessage } from "@/lib/agent/thread-types";

/**
 * The copilot on the operations board.
 *
 * The same panel as the traveler's concierge with the accept flow removed,
 * because there is nothing to accept: every tool behind it is a read. That is
 * the honest version of "ask your data a question" — it turns a sentence into a
 * query over the schedule, and changing anything still happens on the screen
 * that owns it.
 */
export default function Copilot({
  initialThread,
}: {
  initialThread: ThreadMessage[];
}) {
  return (
    <AgentChat
      storageKey="copilot:console"
      name="Copilot"
      subtitle="Reads the board · cannot change it"
      callToAction="Ask the board"
      emptyState="Ask about groups, vendors or anything moving in the next few days. I can read the board, not change it."
      openers={[
        "What's moving tomorrow morning?",
        "Which vendors need a phone call?",
        "Anything at risk right now?",
      ]}
      placeholder="Ask about the next few days…"
      initialThread={initialThread}
      ask={askCopilotAction}
    />
  );
}
