import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Check, Star } from "lucide-react";
import AppNav from "@/components/layout/AppNav";
import {
  getItems,
  getReviews,
  getTrip,
} from "@/lib/db/queries";
import { formatDate, formatMoney } from "@/lib/format";
import { completeTripAction, saveReviewAction } from "./actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Close out & review" };

/**
 * Complete, then Review.
 *
 * The last two stages the brief prints, and the two that did not exist:
 * `trips.status` has carried a 'completed' value since the first migration
 * that nothing ever set, and no table recorded a rating.
 *
 * One page for both because they are one moment for the person doing them —
 * the trip is over, and what happens next is closing it and saying how it
 * went. Splitting them across two screens would mean navigating between them
 * to do a single obvious thing.
 *
 * The stars are radio inputs in a plain form. No JavaScript, so this works on
 * the same bad hotel wifi the run sheet is built for, and it degrades to
 * something usable rather than to nothing.
 */
export default async function ReviewPage({
  params,
}: {
  params: { id: string };
}) {
  const trip = await getTrip(params.id);
  if (!trip) notFound();

  const [items, reviews] = await Promise.all([
    getItems(trip.id),
    getReviews(trip.id),
  ]);

  const done = trip.status === "completed";
  const today = new Date().toISOString().slice(0, 10);
  const stillRunning = Boolean(trip.ends_on && trip.ends_on > today);
  const neverBooked = trip.status === "draft" || trip.status === "quoted";

  // Only stops that actually happened. Rating a cancelled boat trip tells the
  // operator nothing about the vendor and would drag a real average down.
  const rateable = items.filter(
    (i) => i.status !== "cancelled" && i.status !== "replaced"
  );

  const byItem = new Map(
    reviews.filter((r) => r.item_id).map((r) => [r.item_id as string, r])
  );
  const tripReview = reviews.find((r) => !r.item_id) ?? null;

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

        <span className="eyebrow mt-8">
          · {done ? "Reviewed" : "Close out"} ·
        </span>
        <h1 className="font-display text-display-lg font-semibold uppercase text-fg text-balance">
          {trip.title}
        </h1>
        <p className="mt-6 text-body-lg text-muted max-w-2xl">
          {trip.starts_on && trip.ends_on && (
            <>
              {formatDate(trip.starts_on, trip.time_zone)} —{" "}
              {formatDate(trip.ends_on, trip.time_zone)} ·{" "}
            </>
          )}
          {rateable.length} stops
        </p>

        {/* --------------------------------------------------- Complete -- */}

        <section className="mt-14">
          <h2 className="font-display uppercase text-label tracking-label text-accent border-b border-line pb-2">
            Step one — close the trip
          </h2>

          <div className="surface p-6 mt-4">
            {done ? (
              <p className="font-sans text-sm text-fg flex items-center gap-2">
                <Check className="w-4 h-4 text-accent shrink-0" />
                Closed
                {trip.completed_at &&
                  ` on ${formatDate(trip.completed_at, trip.time_zone)}`}
                . Nothing more is owed here.
              </p>
            ) : neverBooked ? (
              <p className="font-sans text-sm text-muted">
                This trip was never confirmed, so there is nothing to close out.
                Book it first, or leave it as a draft.
              </p>
            ) : stillRunning ? (
              <p className="font-sans text-sm text-muted">
                This trip runs until {formatDate(trip.ends_on!, trip.time_zone)}.
                You can close it out the day after it finishes — until then the
                concierge and your operator can still change it.
              </p>
            ) : (
              <>
                <p className="font-sans text-sm text-muted max-w-2xl">
                  Marks the trip finished and opens reviewing below. Your
                  operator keeps everything — the itinerary, the bookings and
                  the payments stay exactly as they are.
                </p>
                <form action={completeTripAction} className="mt-5">
                  <input type="hidden" name="tripId" value={trip.id} />
                  <button
                    type="submit"
                    className="btn-solid px-6 py-3 text-xs tracking-wider"
                  >
                    <Check className="w-4 h-4 mr-2 inline" />
                    Mark this trip complete
                  </button>
                </form>
              </>
            )}
          </div>
        </section>

        {/* ----------------------------------------------------- Review -- */}

        <section className="mt-14">
          <h2 className="font-display uppercase text-label tracking-label text-accent border-b border-line pb-2">
            Step two — how was it?
          </h2>

          {!done ? (
            <p className="mt-4 font-sans text-sm text-muted max-w-2xl">
              Reviewing opens once the trip is closed out above.
            </p>
          ) : (
            <>
              <div className="surface p-6 mt-4">
                <h3 className="font-display text-lg font-semibold uppercase text-fg">
                  The trip overall
                </h3>
                <form action={saveReviewAction} className="mt-4">
                  <input type="hidden" name="tripId" value={trip.id} />
                  <input type="hidden" name="itemId" value="" />
                  <Stars
                    name="rating"
                    id="trip"
                    current={tripReview?.rating ?? 0}
                  />
                  <textarea
                    name="comment"
                    rows={3}
                    defaultValue={tripReview?.comment ?? ""}
                    placeholder="Anything your operator should know."
                    className="mt-4 w-full bg-transparent border border-line px-4 py-3 text-fg font-sans text-sm focus:outline-none focus:border-fg transition-colors placeholder:text-muted resize-y"
                  />
                  <button
                    type="submit"
                    className="btn-solid mt-4 px-5 py-2.5 text-xs tracking-wider"
                  >
                    {tripReview ? "Update" : "Save"}
                  </button>
                </form>
              </div>

              <h3 className="mt-12 font-display text-display-sm font-semibold uppercase text-fg">
                Stop by stop
              </h3>
              <p className="mt-2 font-sans text-sm text-muted max-w-2xl">
                Optional, and the most useful thing you can leave. Each rating
                reaches your operator against the vendor who ran that stop.
              </p>

              <ul className="mt-6 flex flex-col gap-3">
                {rateable.map((item) => {
                  const existing = byItem.get(item.id);
                  return (
                    <li key={item.id} className="surface p-5">
                      <div className="flex flex-wrap items-baseline justify-between gap-3">
                        <div className="min-w-0">
                          <h4 className="font-display text-base font-semibold uppercase text-fg">
                            {item.title}
                          </h4>
                          <p className="font-sans text-xs text-muted mt-0.5">
                            Day {item.day} · {item.type}
                          </p>
                        </div>
                        <span className="font-display font-semibold text-fg tabular-nums">
                          {formatMoney(Number(item.cost), trip.currency)}
                        </span>
                      </div>

                      <form action={saveReviewAction} className="mt-4">
                        <input type="hidden" name="tripId" value={trip.id} />
                        <input type="hidden" name="itemId" value={item.id} />
                        <div className="flex flex-wrap items-center gap-4">
                          <Stars
                            name="rating"
                            id={item.id}
                            current={existing?.rating ?? 0}
                          />
                          <input
                            name="comment"
                            defaultValue={existing?.comment ?? ""}
                            placeholder="Optional note"
                            className="flex-1 min-w-[12rem] bg-transparent border border-line px-3 py-2 text-fg font-sans text-xs focus:outline-none focus:border-fg transition-colors placeholder:text-muted"
                          />
                          <button
                            type="submit"
                            className="border border-line px-4 py-2 font-sans text-xs uppercase tracking-wider font-bold text-muted hover:text-fg hover:border-fg transition-colors"
                          >
                            {existing ? "Update" : "Rate"}
                          </button>
                        </div>
                      </form>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </section>
      </div>
    </main>
  );
}

/**
 * Five radios styled as stars.
 *
 * Radios rather than buttons so the whole page stays a plain form — no client
 * component, no JavaScript, and a keyboard and a screen reader both get the
 * behaviour for free. `id` scopes the input names, because a page with twenty
 * of these would otherwise have twenty groups fighting over one name.
 */
function Stars({
  name,
  id,
  current,
}: {
  name: string;
  id: string;
  current: number;
}) {
  return (
    <fieldset className="flex items-center gap-1">
      <legend className="sr-only">Rating out of five</legend>
      {[1, 2, 3, 4, 5].map((value) => (
        <label
          key={value}
          title={`${value} out of 5`}
          className="cursor-pointer p-1 text-muted hover:text-accent transition-colors has-[:checked]:text-accent"
        >
          <input
            type="radio"
            name={name}
            value={value}
            defaultChecked={current === value}
            className="sr-only peer"
          />
          <Star
            className={`w-5 h-5 ${value <= current ? "fill-current text-accent" : ""}`}
          />
          <span className="sr-only">{value}</span>
        </label>
      ))}
    </fieldset>
  );
}
