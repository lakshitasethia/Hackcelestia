import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { STAGES, type TripStage } from "@/lib/trip/stage";

/**
 * The lifecycle, on the screen, with the next action attached to it.
 *
 * Two things in one block, deliberately, because they answer the same
 * question in a different resolution: the rail says *where you are* and the
 * panel underneath says *what to do about it*. Split across the page they read
 * as decoration and instruction; together they read as a position and a move.
 *
 * The rail is not a progress bar. Stages are not evenly weighted and Adapt can
 * be reached from anywhere, so filling a percentage would be a lie — what is
 * drawn is which stages are behind you, which one you are in, and which are
 * still ahead.
 *
 * Overflows horizontally on a phone rather than wrapping or shrinking to
 * illegibility. Eleven stages do not fit on a 375px screen at a readable size,
 * and the honest answer is a scroll.
 */
export default function JourneyRail({ stage }: { stage: TripStage }) {
  const done = new Set(stage.done);

  return (
    <section className="border border-line">
      <div className="overflow-x-auto">
        <ol className="flex items-stretch min-w-max">
          {STAGES.map((s) => {
            const isDone = done.has(s.id);
            const isCurrent = stage.current === s.id;

            return (
              <li
                key={s.id}
                aria-current={isCurrent ? "step" : undefined}
                className={`flex items-center gap-1.5 px-3 py-2.5 border-r border-line last:border-r-0 font-sans text-xs uppercase tracking-wider whitespace-nowrap ${
                  isCurrent
                    ? "bg-fg text-bg font-bold"
                    : isDone
                      ? "text-fg"
                      : "text-muted"
                }`}
              >
                {isDone && !isCurrent && (
                  <Check className="w-3 h-3 shrink-0" aria-hidden />
                )}
                {s.label}
              </li>
            );
          })}
        </ol>
      </div>

      <div className="border-t border-line p-5 sm:p-6 flex flex-wrap items-center justify-between gap-5">
        <div className="min-w-0">
          <p className="font-display text-display-sm font-semibold uppercase text-fg">
            {stage.headline}
          </p>
          {stage.next && (
            <p className="mt-2 font-sans text-sm text-muted max-w-xl">
              {stage.next.explain}
            </p>
          )}
          {stage.blocked && (
            <p className="mt-2 font-sans text-sm text-accent max-w-xl">
              {stage.blocked}
            </p>
          )}
        </div>

        {stage.next && (
          <Link
            href={stage.next.href}
            className={
              stage.next.primary
                ? "btn-solid px-6 py-3 text-xs tracking-wider shrink-0 group"
                : "inline-flex items-center gap-2 border border-line px-6 py-3 font-sans text-xs uppercase tracking-wider font-bold text-muted hover:text-fg hover:border-fg transition-colors shrink-0 group"
            }
          >
            <span>{stage.next.label}</span>
            <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
          </Link>
        )}
      </div>
    </section>
  );
}
