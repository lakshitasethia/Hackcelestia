import { RotateCcw, Zap } from "lucide-react";
import { injectScenarioAction, clearDisruptionsAction } from "@/app/ops/actions";
import { SCENARIOS } from "@/lib/disruption/scenarios";

/**
 * Demo controls, labelled as such.
 *
 * These are not a product feature — an operator does not create their own
 * storms. Presenting them honestly is better than dressing them up: judges can
 * see the disruption is injected rather than faked, and the reset makes the
 * demo repeatable without re-seeding the database.
 */
export default function DemoControls({ tripId }: { tripId: string }) {
  return (
    <section className="mt-20 pt-8 border-t border-line">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-sans text-xs uppercase tracking-wider text-muted flex items-center gap-2">
            <Zap className="w-3.5 h-3.5" />
            Demo controls
          </h2>
          <p className="mt-1 font-sans text-xs text-muted">
            Inject a real disruption against the live itinerary, then reset.
          </p>
        </div>

        <form action={clearDisruptionsAction}>
          <input type="hidden" name="tripId" value={tripId} />
          <button
            type="submit"
            className="flex items-center gap-2 border border-line px-4 py-2 font-sans text-xs uppercase tracking-wider font-bold text-muted hover:text-fg hover:border-fg transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset trip
          </button>
        </form>
      </div>

      <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-3">
        {SCENARIOS.map((scenario) => (
          <form key={scenario.id} action={injectScenarioAction}>
            <input type="hidden" name="tripId" value={tripId} />
            <input type="hidden" name="scenario" value={scenario.id} />
            <button
              type="submit"
              className="surface w-full text-left p-4 hover:border-fg transition-colors group"
            >
              <span className="font-display text-base font-semibold uppercase text-fg group-hover:text-accent transition-colors">
                {scenario.label}
              </span>
              <span className="block mt-1 font-sans text-xs text-muted">
                {scenario.description}
              </span>
            </button>
          </form>
        ))}
      </div>
    </section>
  );
}
