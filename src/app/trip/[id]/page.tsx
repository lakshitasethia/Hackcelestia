import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Check, Download } from "lucide-react";
import AppNav from "@/components/layout/AppNav";
import LiveRefresh from "@/components/realtime/LiveRefresh";
import Concierge from "@/components/concierge/Concierge";
import TripSummary from "@/components/trip/TripSummary";
import DayTimeline from "@/components/trip/DayTimeline";
import JourneyRail from "@/components/trip/JourneyRail";
import PaymentPanel from "@/components/trip/PaymentPanel";
import {
  getBookings,
  getItems,
  getOpenDisruptions,
  getPayments,
  getReviews,
  getTrip,
  groupByDay,
  summarizePayments,
} from "@/lib/db/queries";
import { getConciergeThread } from "@/lib/agent/thread";
import { getViewer } from "@/lib/auth/session";
import { tripStage } from "@/lib/trip/stage";
import { formatDate, localDay, now } from "@/lib/format";

/** Always hit the database — an itinerary that re-plans mid-trip must never be
 *  served from a build-time snapshot. */
export const dynamic = "force-dynamic";

/**
 * Server actions run under the route they were called from, and a hosting
 * platform's default budget is written for a form post, not for Vela, who answers from the traveler's itinerary.
 * Vercel's Hobby default is ten seconds and its ceiling is sixty; measured
 * runs here are 16-36s for a chat answer and around 50s for a full re-plan.
 * Without this the agent is killed mid-run and the user is told nothing useful.
 *
 * Sixty is the ceiling, not a comfortable margin. A slow re-plan can still
 * exceed it on a free model tier.
 */
export const maxDuration = 60;

export const metadata: Metadata = {
  title: "Your itinerary",
};

export default async function TripPage({
  params,
}: {
  params: { id: string };
}) {
  const trip = await getTrip(params.id);
  if (!trip) notFound();

  const [items, bookings, thread, payments, reviews, disruptions, viewer] =
    await Promise.all([
      getItems(trip.id),
      getBookings(trip.id),
      getConciergeThread(trip.id),
      getPayments(trip.id),
      getReviews(trip.id),
      getOpenDisruptions(trip.id),
      getViewer(),
    ]);

  const days = groupByDay(items);
  const titleById = new Map(items.map((i) => [i.id, i.title]));

  /**
   * Where this trip is in the lifecycle the brief prints, and the one thing to
   * do about it. Computed here and rendered at the top, because the complaint
   * this answers — "I built this and I still cannot tell which button is the
   * next one" — is not solved by adding another link somewhere.
   */
  const stage = tripStage({
    trip,
    items,
    bookings,
    reviews,
    openDisruptions: disruptions.length,
    today: localDay(now(), trip.time_zone),
  });

  const money = summarizePayments(items, bookings, payments);

  return (
    <main
      data-scroll-theme="dark"
      className="min-h-screen bg-surface text-fg selection:bg-fg selection:text-bg"
    >
      <AppNav />

      <div className="max-w-[110rem] mx-auto px-5 sm:px-8 lg:px-12 pt-28 pb-24">
        <header className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-16 items-end">
          <div className="lg:col-span-8">
            <div className="flex items-center gap-4 flex-wrap mb-6">
              <span className="eyebrow !mb-0">
                · {trip.status.replace(/_/g, " ")} ·
              </span>
              <LiveRefresh tripIds={[trip.id]} />
              {/* Opens in a new tab rather than navigating: the print view is a
                  document, and coming back from it should not cost the
                  traveler their place in a fortnight of scrolling. */}
              <Link
                href={`/trip/${trip.id}/print`}
                target="_blank"
                className="inline-flex items-center gap-1.5 font-sans text-xs uppercase tracking-wider text-muted hover:text-fg transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                Export PDF
              </Link>

              {/**
               * The way to the confirm step.
               *
               * Confirming lives on `/trip/[id]/build` and nothing on this page
               * linked to it, so the only route to the one action that turns a
               * draft into a live trip — and puts it on the operator's board and
               * the guide's run sheet — was typing the URL. Shown only while
               * there is something to confirm.
               */}
              {trip.status === "draft" && (
                <Link
                  href={`/trip/${trip.id}/build`}
                  className="inline-flex items-center gap-1.5 font-sans text-xs uppercase tracking-wider text-accent hover:text-fg transition-colors"
                >
                  <Check className="w-3.5 h-3.5" />
                  Review &amp; confirm
                </Link>
              )}
            </div>
            <h1 className="font-display text-display-lg font-semibold uppercase text-fg text-balance">
              {trip.title}
            </h1>
            <p className="mt-6 text-body-lg text-muted">
              {trip.starts_on && trip.ends_on && (
                <>
                  {formatDate(trip.starts_on, trip.time_zone)} —{" "}
                  {formatDate(trip.ends_on, trip.time_zone)} ·{" "}
                </>
              )}
              {trip.party_size} {trip.party_size === 1 ? "traveler" : "travelers"}
            </p>
          </div>

          {/* Preferences are the intake agent's structured output; showing them
              back is how a traveler knows the plan was built from what they
              actually said. */}
          {(trip.prefs.interests?.length ||
            trip.prefs.pace ||
            trip.prefs.lodging) && (
            <div className="lg:col-span-4 lg:pl-10 lg:border-l border-line">
              <span className="font-display uppercase text-label tracking-label text-accent">
                Planned around
              </span>
              <ul className="mt-3 flex flex-wrap gap-2">
                {[
                  trip.prefs.pace,
                  trip.prefs.style,
                  // Prefixed, because "luxury" on its own next to "food" and
                  // "relaxed" reads as another interest rather than as the
                  // answer to where they sleep.
                  trip.prefs.lodging && `${trip.prefs.lodging} rooms`,
                  ...(trip.prefs.interests ?? []),
                  ...(trip.prefs.dietary ?? []),
                  trip.prefs.mobility,
                ]
                  .filter((tag): tag is string => Boolean(tag))
                  .map((tag) => (
                    <li
                      key={tag}
                      className="font-sans text-xs uppercase tracking-wider text-muted border border-line px-2.5 py-1"
                    >
                      {tag}
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </header>

        <div className="mt-12">
          <JourneyRail stage={stage} />
        </div>

        <div className="mt-8">
          <TripSummary trip={trip} items={items} bookings={bookings} />
        </div>

        <div className="mt-8">
          <PaymentPanel
            tripId={trip.id}
            summary={money}
            currency={trip.currency}
            timeZone={trip.time_zone}
            canRecord={viewer?.role === "operator"}
          />
        </div>

        {days.size === 0 ? (
          <p className="mt-16 text-body-lg text-muted">
            Nothing planned yet.
          </p>
        ) : (
          <div className="mt-16 flex flex-col gap-16">
            {[...days].map(([day, dayItems]) => (
              <DayTimeline
                timeZone={trip.time_zone}
                comparable
                key={day}
                day={day}
                items={dayItems}
                titleById={titleById}
                currency={trip.currency}
              />
            ))}
          </div>
        )}

        <div className="mt-20 pt-8 border-t border-line">
          <Link href="/ops" className="link-underline">
            <ArrowLeft className="w-4 h-4" />
            <span>Operations board</span>
          </Link>
        </div>
      </div>

      {/* The traveler's own agent. It reads this trip and writes drafts; the
          Accept button on a draft is the only path from a conversation to a
          booking, and it runs the same code an operator's re-plan does. */}
      <Concierge tripId={trip.id} initialThread={thread} />
    </main>
  );
}
