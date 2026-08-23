import { Check, ChevronRight, CircleDashed, X } from "lucide-react";
import type { AgentRunWithSteps } from "@/lib/db/queries";

/**
 * The agent's tool trace, rendered.
 *
 * This exists to make the work checkable. Anyone can claim their product "uses
 * AI"; showing which tools ran, with what arguments, in what order and how long
 * each took, turns that into something a reader can audit — and it is the first
 * place to look when a proposal is wrong.
 */

const TOOL_LABEL: Record<string, string> = {
  get_blast_radius: "Traced the dependency graph",
  search_availability: "Searched live availability",
  price_option: "Priced an option",
  check_vendor: "Contacted a vendor",
  propose_replan: "Recorded a proposal",
};

export default function TracePanel({ run }: { run: AgentRunWithSteps }) {
  const output = (run.output ?? {}) as { summary?: string; proposals?: number };
  const elapsed =
    run.ended_at && run.started_at
      ? (new Date(run.ended_at).getTime() -
          new Date(run.started_at).getTime()) /
        1000
      : null;

  return (
    <section className="surface p-6">
      <header className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-line">
        <h2 className="font-display text-display-sm font-semibold uppercase text-fg flex items-center gap-2">
          {run.status === "succeeded" ? (
            <Check className="w-4 h-4 text-accent" />
          ) : run.status === "failed" ? (
            <X className="w-4 h-4 text-accent" />
          ) : (
            <CircleDashed className="w-4 h-4 text-accent animate-spin" />
          )}
          Agent trace
        </h2>
        <p className="font-sans text-xs uppercase tracking-wider text-muted tabular-nums">
          {run.agent_steps.length} tool calls
          {elapsed !== null && ` · ${elapsed.toFixed(1)}s`}
          {run.input_tokens !== null &&
            ` · ${run.input_tokens! + (run.output_tokens ?? 0)} tokens`}
        </p>
      </header>

      {run.status === "failed" && run.error && (
        <p className="mt-4 font-sans text-sm text-accent break-words">
          {run.error}
        </p>
      )}

      <ol className="mt-4 flex flex-col">
        {run.agent_steps.map((step) => (
          <li key={step.id} className="py-3 border-b border-line last:border-b-0">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-sans text-sm text-fg flex items-baseline gap-2 min-w-0">
                <ChevronRight className="w-3 h-3 shrink-0 text-accent translate-y-0.5" />
                <span className="truncate">
                  {TOOL_LABEL[step.tool_name] ?? step.tool_name}
                </span>
              </span>
              <span className="font-sans text-xs text-muted tabular-nums shrink-0">
                {step.ms}ms
              </span>
            </div>

            {/* Arguments and result are collapsed by default: the sequence is
                the story, the payloads are the evidence. */}
            <details className="mt-2 ml-5">
              <summary className="font-sans text-xs uppercase tracking-wider text-muted cursor-pointer hover:text-fg transition-colors">
                {step.tool_name}
              </summary>
              <pre className="mt-2 p-3 bg-bg/40 border border-line overflow-x-auto text-xs text-muted leading-relaxed">
                {JSON.stringify(
                  { input: step.tool_input, output: step.tool_output },
                  null,
                  2
                )}
              </pre>
            </details>
          </li>
        ))}
      </ol>

      {output.summary && (
        <p className="mt-5 pt-4 border-t border-line font-sans text-sm text-muted leading-relaxed whitespace-pre-line">
          {output.summary}
        </p>
      )}
    </section>
  );
}
