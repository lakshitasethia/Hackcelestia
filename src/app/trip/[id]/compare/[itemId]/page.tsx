import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Check, Lock, Ban } from "lucide-react";
import AppNav from "@/components/layout/AppNav";
import { getAlternatives, getItems, getTrip } from "@/lib/db/queries";
import { formatMoney, formatTime } from "@/lib/format";
import { switchStopAction } from "./actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Compare alternatives" };

/**
 * "Compare alternatives" — one stop, everything else it could have been.
 *
 * Deliberately a page rather than a modal. A traveler comparing four hotels
 * wants to read them, and a comparison you cannot link someone to is a
 * comparison nobody discusses with the person they are travelling with.
 *
 * The layout is fixed on purpose: the stop you have now sits at the top, in
 * the same shape as every card below it, so the eye compares like with like
 * instead of hunting for what changed.
 */
export default async function ComparePage({
  params,
}: {
  params: { id: string; itemId: string };
}) {
  const trip = await getTrip(params.id);
  if (!trip) notFound();

  const items = await getItems(trip.id);
  const item = items.find((i) => i.id === params.itemId);
  if (!item) notFound();

  const alternatives = await getAlternatives(item);

  const locked = Boolean(item.lock_reason);
  const atRisk = item.status === "at_risk";
  const cost = Number(item.cost);

  /**
   * Why the whole page might be read-only.
   *
   * Three different reasons, and they need different words. A locked stop is a
   * commercial fact ("non-refundable, prepaid"); an at-risk one is an operator
   * mid-way through fixing something; a cancelled one is simply gone. Saying
   * "you cannot change this" for all three is how a user ends up emailing to
   * ask why.
   */
  const frozen = locked
    ? { icon: Lock, text: item.lock_reason as string }
    : atRisk
      ? {
          icon: Ban,
          text: "The office is re-planning this stop right now. You will be able to change it once that is settled.",
        }
      : item.status === "cancelled" || item.status === "replaced"
        ? { icon: Ban, text: `This stop is already ${item.status}.` }
        : null;

  return (
    <main
      data-scroll-theme="dark"
      className="min-h-screen bg-surface text-fg selection:bg-fg selection:text-bg"
    >
      <AppNav />

      <div className="max-w-[70rem] mx-auto px-5 sm:px-8 lg:px-12 pt-28 pb-24">
        <Link
          href={`/trip/${trip.id}`}
          className="inline-flex items-center gap-1.5 font-sans text-xs uppercase tracking-wider text-muted hover:text-fg transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to the itinerary
        </Link>

        <span className="eyebrow mt-8">· Day {item.day} · Compare ·</span>
        <h1 className="font-display text-display-lg font-semibold uppercase text-fg text-balance">
          Other options
        </h1>
        <p className="mt-6 text-body-lg text-muted max-w-2xl">
          Everything else of the same kind, in the same town, free on the same
          day. Prices are what you would pay instead — the difference against
          what you have booked is on each card.
        </p>

        {/* What is booked now. Same card shape as the options, so the only
            thing that differs between them is the information. */}
        <section className="mt-14">
          <h2 className="font-display uppercase text-label tracking-label text-accent border-b border-line pb-2">
            You have booked
          </h2>
          <div className="surface p-5 mt-4 border-fg">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h3 className="font-display text-lg font-semibold uppercase text-fg">
                  {item.title}
                </h3>
                <p className="font-sans text-xs text-muted mt-1">
                  Day {item.day} · {formatTime(item.starts_at, trip.time_zone)} ·{" "}
                  {item.type}
                </p>
              </div>
              <span className="font-display text-lg font-semibold text-fg tabular-nums shrink-0">
                {formatMoney(cost, trip.currency)}
              </span>
            </div>
          </div>
        </section>

        {frozen && (
          <p className="mt-6 border border-accent p-4 font-sans text-sm text-fg flex items-start gap-3">
            <frozen.icon className="w-4 h-4 shrink-0 mt-0.5 text-accent" />
            <span>{frozen.text}</span>
          </p>
        )}

        <section className="mt-12">
          <h2 className="font-display uppercase text-label tracking-label text-accent border-b border-line pb-2">
            {alternatives.length} alternative
            {alternatives.length === 1 ? "" : "s"}
          </h2>

          {alternatives.length === 0 ? (
            <p className="mt-6 font-sans text-sm text-muted max-w-2xl">
              Nothing else of this kind is bookable in{" "}
              {item.title.split(",").pop()?.trim() || "this town"} on that day.
              That is the catalogue being thin rather than the town being empty
              — ask the concierge on your itinerary and it will look again.
            </p>
          ) : (
            <ul className="mt-6 flex flex-col gap-3">
              {alternatives.map((option) => {
                const cheaper = option.delta < 0;
                const same = option.delta === 0;

                return (
                  <li
                    key={option.inventory.id}
                    className={`surface p-5 ${option.blocked ? "opacity-50" : ""}`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <h3 className="font-display text-lg font-semibold uppercase text-fg">
                          {option.inventory.title}
                        </h3>
                        <p className="font-sans text-xs text-muted mt-1">
                          {option.vendorName} ·{" "}
                          {formatTime(option.startsAt, trip.time_zone)} ·{" "}
                          {option.inventory.duration_min} min
                          {option.inventory.tier && ` · ${option.inventory.tier}`}
                        </p>
                        {option.inventory.description && (
                          <p className="font-sans text-sm text-muted mt-2 max-w-xl">
                            {option.inventory.description}
                          </p>
                        )}
                        {(option.inventory.tags ?? []).length > 0 && (
                          <p className="font-sans text-xs text-muted mt-2">
                            {(option.inventory.tags ?? []).join(" · ")}
                          </p>
                        )}
                      </div>

                      <div className="text-right shrink-0">
                        <span className="font-display text-lg font-semibold text-fg tabular-nums block">
                          {formatMoney(option.price, trip.currency)}
                        </span>
                        {/* The number that actually answers the question. */}
                        <span
                          className={`font-sans text-xs uppercase tracking-wider block mt-1 ${
                            cheaper ? "text-fg" : same ? "text-muted" : "text-accent"
                          }`}
                        >
                          {same
                            ? "same price"
                            : `${cheaper ? "saves" : "adds"} ${formatMoney(
                                Math.abs(option.delta),
                                trip.currency
                              )}`}
                        </span>
                        <span className="font-sans text-xs text-muted block mt-1">
                          {option.slotsFree} left
                        </span>
                      </div>
                    </div>

                    <div className="mt-4 pt-4 border-t border-line">
                      {option.blocked ? (
                        <span className="font-sans text-xs uppercase tracking-wider text-muted">
                          {option.blocked}
                        </span>
                      ) : frozen ? (
                        <span className="font-sans text-xs uppercase tracking-wider text-muted">
                          Cannot switch — see above
                        </span>
                      ) : (
                        <form action={switchStopAction}>
                          <input type="hidden" name="tripId" value={trip.id} />
                          <input type="hidden" name="itemId" value={item.id} />
                          <input
                            type="hidden"
                            name="inventoryId"
                            value={option.inventory.id}
                          />
                          <input
                            type="hidden"
                            name="startsAt"
                            value={option.startsAt}
                          />
                          <button
                            type="submit"
                            className="btn-solid px-5 py-2.5 text-xs tracking-wider"
                          >
                            <Check className="w-3.5 h-3.5 mr-2 inline" />
                            Switch to this
                          </button>
                        </form>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Said once, plainly, rather than left for someone to discover. */}
        {!frozen && alternatives.some((a) => !a.blocked) && (
          <p className="mt-10 font-sans text-sm text-muted max-w-2xl">
            Switching rebooks straight away: the old booking is cancelled, the
            new one is made, and your operator and guide both see the change.
            Anything that depended on this stop stays attached to whatever
            replaces it.
          </p>
        )}
      </div>
    </main>
  );
}
