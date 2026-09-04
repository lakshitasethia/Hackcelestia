/**
 * What the chat widget renders.
 *
 * Deliberately plain data with no server imports, because it crosses into a
 * client component. The projection that produces it lives in `thread.ts`, which
 * is server-only; keeping the types apart means the widget can be typed against
 * them without dragging the service-role client into the browser bundle.
 */

export interface ProposalView {
  id: string;
  /** The one-line summary Vela wrote. */
  summary: string;
  rationale: string;
  costDelta: number;
  currency: string;
  state: "draft" | "sent" | "accepted" | "rejected" | "superseded";
  /** Each operation in the words a traveler would use. */
  operations: string[];
}

export interface ThreadMessage {
  id: string;
  role: "traveler" | "agent";
  body: string;
  sentAt: string;
  /** The draft this message is offering, if it is offering one. */
  proposal: ProposalView | null;
  /** Set when the agent failed and this is the apology, so the UI can style it
   *  as a problem rather than an answer. */
  failed?: boolean;
}
