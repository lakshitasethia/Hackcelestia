import {
  AlertTriangle,
  Bed,
  Car,
  Check,
  Compass,
  CircleDot,
  Flag,
  Plane,
  UserRound,
  UtensilsCrossed,
} from "lucide-react";
import type { ItemType } from "@/lib/db/types";
import type { RunSheetItem } from "@/lib/db/queries";
import { formatDuration, formatTime } from "@/lib/format";
import { flagStopAction, reportStopAction } from "@/app/field/[id]/actions";

const ICONS: Record<ItemType, typeof Bed> = {
  hotel: Bed,
  activity: Compass,
  transport: Car,
  guide: UserRound,
  restaurant: UtensilsCrossed,
  flight: Plane,
};

/**
 * One stop, as the guide sees it.
 *
 * Everything here is a plain form posting to a server action — no client
 * JavaScript, no optimistic state. That is a deliberate choice for the surface
 * most likely to be used one-handed on a phone with two bars of signal on a
 * cliff path: a form submits and the page comes back, or it does not and
 * nothing was silently lost.
 */
export default function StopCard({
  item,
  dependsOn,
}: {
  item: RunSheetItem;
  dependsOn: string[];
}) {
  const Icon = ICONS[item.type] ?? Compass;
  const cancelled = item.status === "cancelled" || item.status === "replaced";
  const atRisk = item.status === "at_risk";
  const done = item.field_state === "done";
  const flagged = item.field_state === "issue";

  return (
    <article
      className={`surface p-4 sm:p-5 ${atRisk || flagged ? "ring-1 ring-accent" : ""} ${
        cancelled ? "opacity-45" : ""
      }`}
    >
      <div className="flex items-start gap-3 sm:gap-4">
        <div className="w-10 h-10 shrink-0 border border-line flex items-center justify-center text-accent">
          {done ? <Check className="w-5 h-5" /> : <Icon className="w-5 h-5" />}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-3 flex-wrap">
            <span className="font-display text-lg font-semibold text-fg tabular-nums">
              {formatTime(item.starts_at)}
            </span>
            <span className="font-sans text-xs uppercase tracking-wider text-muted">
              {formatDuration(item.starts_at, item.ends_at)}
            </span>
          </div>

          <h3
            className={`font-display text-display-sm font-semibold uppercase text-fg mt-1 ${
              cancelled ? "line-through" : ""
            }`}
          >
            {item.title}
          </h3>

          {dependsOn.length > 0 && (
            <p className="mt-2 font-sans text-xs text-muted">
              <span className="uppercase tracking-wider">After</span>{" "}
              {dependsOn.join(" · ")}
            </p>
          )}

          {/* The office's view of this stop, in the guide's words. `notes` is
              what an accepted re-plan wrote, so a swapped stop explains itself
              rather than just appearing. */}
          {(atRisk || cancelled) && (
            <p className="mt-2 flex items-start gap-1.5 font-sans text-xs text-accent">
              <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
              {cancelled
                ? "Cancelled by the office — do not run this."
                : "Flagged at risk — the office is working on it."}
            </p>
          )}
          {/* The traveler found this one; nobody has checked it exists.
              Worth saying out loud on the one screen where somebody is about to
              drive a group to it. */}
          {item.inventory?.added_for_trip && (
            <p className="mt-2 inline-flex items-center gap-1.5 border border-line px-2 py-1 font-sans text-[0.65rem] uppercase tracking-wider text-muted">
              <AlertTriangle className="w-3 h-3 shrink-0" />
              Added by the traveler — not verified or booked by the office
            </p>
          )}

          {item.notes && (
            <p className="mt-2 font-sans text-xs text-muted border-l-2 border-line pl-3">
              {item.notes}
            </p>
          )}
          {item.field_note && (
            <p className="mt-2 font-sans text-xs text-muted border-l-2 border-accent pl-3">
              Your note: {item.field_note}
            </p>
          )}
        </div>
      </div>

      {!cancelled && (
        <div className="mt-4 pt-4 border-t border-line flex flex-wrap gap-2">
          {(
            [
              { state: "on_track", label: "On track", icon: CircleDot },
              { state: "done", label: "Done", icon: Check },
            ] as const
          ).map(({ state, label, icon: StateIcon }) => (
            <form key={state} action={reportStopAction} className="flex-1 min-w-[7rem]">
              <input type="hidden" name="itemId" value={item.id} />
              <input type="hidden" name="state" value={state} />
              <button
                type="submit"
                aria-pressed={item.field_state === state}
                className={`w-full flex items-center justify-center gap-2 px-3 py-3 border font-sans text-xs uppercase tracking-wider font-bold transition-colors ${
                  item.field_state === state
                    ? "border-fg bg-fg text-bg"
                    : "border-line text-muted hover:text-fg hover:border-fg"
                }`}
              >
                <StateIcon className="w-3.5 h-3.5" />
                {label}
              </button>
            </form>
          ))}

          {/* Escalation is one tap plus a sentence. Anything longer and a guide
              standing in the problem rings the office instead, which is the
              behaviour this surface exists to replace. */}
          {/* Keyed on the item so the open/closed state and the typed note are
              tied to the stop they describe. A live refresh arriving mid-
              sentence must not wipe what the guide is writing (same key, state
              kept), but an accepted re-plan that swaps this stop for another
              must not leave the old note sitting under the new one (new key,
              fresh form). */}
          <details key={item.id} className="w-full">
            <summary
              className={`flex items-center justify-center gap-2 px-3 py-3 border font-sans text-xs uppercase tracking-wider font-bold cursor-pointer transition-colors ${
                flagged
                  ? "border-accent text-accent"
                  : "border-line text-muted hover:text-fg hover:border-fg"
              }`}
            >
              <Flag className="w-3.5 h-3.5" />
              {flagged ? "Flagged — add detail" : "Flag a problem"}
            </summary>

            <form action={flagStopAction} className="mt-3 flex flex-col gap-3">
              <input type="hidden" name="itemId" value={item.id} />
              <label htmlFor={`note-${item.id}`} className="sr-only">
                What is wrong with {item.title}?
              </label>
              <textarea
                id={`note-${item.id}`}
                name="note"
                rows={3}
                required
                placeholder="Skipper says the swell is too high to sail."
                className="w-full bg-transparent border border-line p-3 font-sans text-sm text-fg placeholder:text-muted focus:border-fg focus:outline-none"
              />

              {/* The guide standing in the problem knows what kind it is, and
                  the cause changes the answer: a weather event rules out every
                  weather-exposed replacement, so a rained-off boat is never
                  offered another boat. Asking is one tap and beats inferring
                  it from prose. */}
              <label htmlFor={`cause-${item.id}`} className="sr-only">
                What kind of problem?
              </label>
              <select
                id={`cause-${item.id}`}
                name="cause"
                defaultValue="vendor"
                className="w-full bg-transparent border border-line p-3 font-sans text-sm uppercase tracking-wider text-fg focus:border-fg focus:outline-none"
              >
                <option value="vendor">The supplier cannot do it</option>
                <option value="weather">Weather</option>
                <option value="transport">Transport or delay</option>
                <option value="manual">Something else</option>
              </select>
              <button type="submit" className="btn-solid px-6 py-3 text-xs tracking-wider">
                Report to the office
              </button>
              <p className="font-sans text-xs text-muted">
                This opens a disruption against the live itinerary. The office
                sees it immediately and the re-planner can start work.
              </p>
            </form>
          </details>
        </div>
      )}
    </article>
  );
}
