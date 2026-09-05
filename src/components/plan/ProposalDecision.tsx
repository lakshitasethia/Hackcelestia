"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { acceptProposalAction, discardProposalAction } from "@/app/plan/actions";

/**
 * Yes or no, and nothing in between.
 *
 * The accept path is deliberately the only way a proposal becomes a trip.
 * There is no auto-accept, no "continue" that quietly means yes, and no timer —
 * a plan sits as a proposal until somebody presses this.
 *
 * A client component because the answer is a redirect to a URL that does not
 * exist until the action returns it, and because the button has to be able to
 * say "building it" for the several seconds that composing a fortnight takes.
 */
export default function ProposalDecision({ proposalId }: { proposalId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"accept" | "discard" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    if (busy) return;
    setBusy("accept");
    setError(null);
    try {
      const result = await acceptProposalAction(proposalId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push(`/trip/${result.tripId}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That did not work.");
    } finally {
      setBusy(null);
    }
  }

  async function discard() {
    if (busy) return;
    setBusy("discard");
    try {
      await discardProposalAction(proposalId);
      router.push("/plan");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="surface p-5">
      <h2 className="font-display uppercase text-label tracking-label text-fg">
        Is this itinerary OK?
      </h2>
      <p className="mt-2 font-sans text-xs text-muted">
        Nothing has been created yet. Say yes and I will build the trip — you
        will still get a second chance to confirm before anything is booked.
      </p>

      <div className="mt-5 flex flex-col gap-3">
        <button
          type="button"
          onClick={accept}
          disabled={busy !== null}
          className="flex items-center justify-center gap-2 bg-fg text-bg px-4 py-3 font-sans text-xs
                     uppercase tracking-wider font-bold hover:opacity-90 transition-opacity
                     disabled:opacity-40"
        >
          <Check className="w-4 h-4" />
          {busy === "accept" ? "Building the trip…" : "Yes, build this trip"}
        </button>

        <button
          type="button"
          onClick={discard}
          disabled={busy !== null}
          className="flex items-center justify-center gap-2 border border-line px-4 py-3 font-sans text-xs
                     uppercase tracking-wider font-bold text-muted hover:text-fg hover:border-fg
                     transition-colors disabled:opacity-40"
        >
          <X className="w-4 h-4" />
          {busy === "discard" ? "Discarding…" : "No, plan it differently"}
        </button>
      </div>

      {error && <p className="mt-3 font-sans text-xs text-accent">{error}</p>}
    </section>
  );
}
