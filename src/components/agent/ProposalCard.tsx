import { Check, X } from "lucide-react";
import type { ReplanProposal, ReplanOp } from "@/lib/db/types";
import { formatMoney, formatTime } from "@/lib/format";
import { acceptProposalAction, rejectProposalAction } from "@/app/ops/disruption/[id]/actions";

const OP_VERB: Record<ReplanOp["op"], string> = {
  drop: "Drop",
  move: "Move",
  replace: "Replace",
  add: "Add",
};

/**
 * One proposed plan, with an explicit accept/decline.
 *
 * The two buttons are the product's safety boundary: everything the agent did
 * up to this point is a draft, and nothing touches a live booking until someone
 * presses Accept. Declining is a first-class outcome, not a hidden one.
 */
export default function ProposalCard({
  proposal,
  titleById,
  disruptionId,
}: {
  proposal: ReplanProposal;
  titleById: Map<string, string>;
  disruptionId: string;
}) {
  const [summary, ...rest] = (proposal.rationale ?? "").split("\n\n");
  const decided = proposal.state !== "draft";
  const delta = Number(proposal.cost_delta);

  return (
    <article
      className={`surface p-5 ${proposal.state === "accepted" ? "border-fg" : ""} ${
        proposal.state === "rejected" || proposal.state === "superseded"
          ? "opacity-45"
          : ""
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <h3 className="font-display text-base font-semibold uppercase text-fg">
          {summary || "Proposed plan"}
        </h3>
        <span className="text-right shrink-0">
          <span className="block font-display text-lg font-semibold text-fg tabular-nums">
            {delta === 0
              ? "No change"
              : `${delta > 0 ? "+" : "−"}${formatMoney(Math.abs(delta))}`}
          </span>
          {decided && (
            <span className="font-sans text-xs uppercase tracking-wider text-muted">
              {proposal.state}
            </span>
          )}
        </span>
      </div>

      {rest.length > 0 && (
        <p className="mt-3 font-sans text-sm text-muted leading-relaxed">
          {rest.join("\n\n")}
        </p>
      )}

      <ol className="mt-4 flex flex-col gap-2">
        {proposal.plan.map((op, idx) => {
          const target =
            "item_id" in op ? titleById.get(op.item_id) ?? op.item_id : null;
          return (
            <li key={idx} className="font-sans text-xs text-muted flex gap-2">
              <span className="uppercase tracking-wider text-accent shrink-0">
                {OP_VERB[op.op]}
              </span>
              <span className="min-w-0">
                {target && <span className="text-fg">{target}</span>}
                {"starts_at" in op && op.starts_at && (
                  <span> → {formatTime(op.starts_at)}</span>
                )}
                <span className="block mt-0.5">{op.reason}</span>
              </span>
            </li>
          );
        })}
      </ol>

      {!decided && (
        <div className="mt-5 pt-4 border-t border-line flex gap-3">
          <form action={acceptProposalAction}>
            <input type="hidden" name="proposalId" value={proposal.id} />
            <input type="hidden" name="disruptionId" value={disruptionId} />
            <button type="submit" className="btn-solid px-5 py-2.5 text-xs tracking-wider">
              <Check className="w-3.5 h-3.5 mr-1.5 inline" />
              Accept and apply
            </button>
          </form>
          <form action={rejectProposalAction}>
            <input type="hidden" name="proposalId" value={proposal.id} />
            <input type="hidden" name="disruptionId" value={disruptionId} />
            <button
              type="submit"
              className="flex items-center gap-1.5 border border-line px-5 py-2.5 font-sans text-xs uppercase tracking-wider font-bold text-muted hover:text-fg hover:border-fg transition-colors"
            >
              <X className="w-3.5 h-3.5" />
              Decline
            </button>
          </form>
        </div>
      )}
    </article>
  );
}
