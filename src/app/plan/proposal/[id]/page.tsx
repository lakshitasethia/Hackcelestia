import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ExternalLink, Info, TriangleAlert } from "lucide-react";
import AppNav from "@/components/layout/AppNav";
import { getViewer } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatMoney } from "@/lib/format";
import type { ComposeResult } from "@/lib/agent/compose";
import type { ResearchResult } from "@/lib/agent/research";
import type { TripSpec } from "@/lib/agent/intake";
import ProposalDecision from "@/components/plan/ProposalDecision";

export const dynamic = "force-dynamic";

/**
 * Accepting a proposal composes a fortnight of stops into the database from
 * this route, and a hosting platform's default action budget is written for a
 * form post. Sixty is Vercel's ceiling on the plans this runs on.
 */
export const maxDuration = 60;

export const metadata: Metadata = { title: "Is this itinerary right?" };

/**
 * The plan, before it is a trip.
 *
 * This page is the thing the old flow had nowhere to put. Composing used to
 * write straight into `itinerary_items` and redirect the traveler to the
 * finished article, so the only question left to ask was "would you like to
 * cancel the trip you now have". Everything shown here exists only as a row in
 * `trip_proposals`; the buttons at the bottom are what decides whether it
 * becomes anything.
 *
 * Sources are shown next to the stops rather than tucked in a footer. A price
 * researched off the web is a claim, and a claim a traveler cannot check is
 * worth about as much as a guess.
 */
export default async function ProposalPage({
  params,
}: {
  params: { id: string };
}) {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");

  const supabase = createAdminClient();
  const { data } = await supabase
    .from("trip_proposals")
    .select("id, traveler_id, description, spec, plan, research, state, trip_id")
    .eq("id", params.id)
    .maybeSingle();

  if (!data) notFound();

  const proposal = data as unknown as {
    id: string;
    traveler_id: string | null;
    description: string;
    spec: TripSpec;
    plan: ComposeResult;
    research: ResearchResult;
    state: "proposed" | "accepted" | "discarded";
    trip_id: string | null;
  };

  // The admin client is here to read a row the traveler owns, not to read
  // anybody's. RLS would have done this; bypassing it means doing it by hand.
  if (proposal.traveler_id !== viewer.id) notFound();

  // Already said yes. Send them to the trip rather than offering the choice
  // again and quietly building a second one.
  if (proposal.state === "accepted" && proposal.trip_id) {
    redirect(`/trip/${proposal.trip_id}`);
  }

  const { plan, research, spec } = proposal;

  // Sources are keyed by the row, so a stop can show the page its price was
  // read off. Built here because the plan holds inventory ids and the research
  // holds titles, and matching them once is cheaper than matching per row.
  const sourceByTitle = new Map<string, string>();
  for (const place of research.places ?? []) {
    if (place.sourceUrl) sourceByTitle.set(place.title, place.sourceUrl);
  }
  for (const leg of research.legs ?? []) {
    if (leg.sourceUrl) sourceByTitle.set(leg.title, leg.sourceUrl);
  }

  const days = [...new Set(plan.stops.map((s) => s.day))].sort((a, b) => a - b);
  const startsOn = spec.startsOn ? new Date(`${spec.startsOn}T00:00:00Z`) : null;

  const dayDate = (day: number) => {
    if (!startsOn) return null;
    const d = new Date(startsOn);
    d.setUTCDate(d.getUTCDate() + day - 1);
    return d.toLocaleDateString("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    });
  };

  return (
    <main
      data-scroll-theme="dark"
      className="min-h-screen bg-surface text-fg selection:bg-fg selection:text-bg"
    >
      <AppNav />

      <div className="max-w-[100rem] mx-auto px-5 sm:px-8 lg:px-12 pt-28 pb-24">
        <Link
          href="/plan"
          className="inline-flex items-center gap-2 font-sans text-xs uppercase tracking-wider text-muted hover:text-fg transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Start over
        </Link>

        <header className="mt-6 grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-16 items-end">
          <div className="lg:col-span-8">
            <span className="eyebrow">· A proposal · nothing is booked ·</span>
            <h1 className="font-display text-display-lg font-semibold uppercase text-fg text-balance">
              {spec.title || plan.cities.join(", ")}
            </h1>
            <p className="mt-6 text-body-lg text-muted">
              {plan.dayCount} days · {plan.cities.join(" → ")} ·{" "}
              {plan.stops.length} stops
            </p>
          </div>

          <div className="lg:col-span-4 lg:pl-10 lg:border-l border-line">
            <span className="font-display uppercase text-label tracking-label text-accent">
              What it comes to
            </span>
            <p className="mt-3 font-display text-3xl text-fg">
              {formatMoney(plan.total, plan.currency)}
            </p>
            {plan.totalInBudget !== null &&
              plan.budgetCurrency !== plan.currency && (
                <p className="mt-1 font-sans text-sm text-muted">
                  about {formatMoney(plan.totalInBudget, plan.budgetCurrency)}
                </p>
              )}
            {plan.budget !== null && (
              <p className="mt-2 font-sans text-xs text-muted">
                against a budget of{" "}
                {formatMoney(plan.budget, plan.budgetCurrency)}
              </p>
            )}
          </div>
        </header>

        {/* Warnings before the plan, not after it. Somebody who scrolls the
            itinerary and likes it should already know what is wrong with it. */}
        {plan.warnings.length > 0 && (
          <ul className="mt-12 flex flex-col gap-3">
            {plan.warnings.map((warning) => (
              <li
                key={warning}
                className="flex items-start gap-3 border border-accent/40 bg-accent/5 px-4 py-3"
              >
                <TriangleAlert className="w-4 h-4 text-accent shrink-0 mt-0.5" />
                <span className="font-sans text-sm text-fg">{warning}</span>
              </li>
            ))}
          </ul>
        )}

        {(research.notes ?? []).length > 0 && (
          <ul className="mt-4 flex flex-col gap-3">
            {research.notes.map((note) => (
              <li
                key={note}
                className="flex items-start gap-3 border border-line px-4 py-3"
              >
                <Info className="w-4 h-4 text-muted shrink-0 mt-0.5" />
                <span className="font-sans text-sm text-muted">{note}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-14 grid grid-cols-1 xl:grid-cols-12 gap-12">
          <div className="xl:col-span-8 flex flex-col gap-10">
            {days.map((day) => {
              const stops = plan.stops
                .filter((s) => s.day === day)
                .sort((a, b) => a.localTime.localeCompare(b.localTime));

              return (
                <section key={day}>
                  <h2 className="flex items-baseline justify-between gap-4 font-display uppercase text-label tracking-label text-accent border-b border-line pb-2">
                    <span>Day {String(day).padStart(2, "0")}</span>
                    <span className="text-muted normal-case tracking-normal font-sans text-xs">
                      {/* The day's own city, not the first stop's: a travel
                          day begins with a train, and a train belongs to the
                          town it leaves rather than the one you wake up in. */}
                      {dayDate(day)} · {plan.cityByDay?.[day] ?? stops[0]?.city}
                    </span>
                  </h2>

                  <ul className="mt-4 flex flex-col gap-3">
                    {stops.map((stop) => {
                      const source = sourceByTitle.get(stop.title);
                      return (
                        <li
                          key={`${stop.inventoryId}-${stop.localTime}`}
                          className="flex items-start justify-between gap-6 border border-line px-4 py-3"
                        >
                          <div className="min-w-0">
                            <p className="font-sans text-sm text-fg">
                              <span className="text-muted tabular-nums">
                                {stop.localTime}
                              </span>{" "}
                              {stop.title}
                            </p>
                            <p className="mt-1 font-sans text-xs text-muted">
                              {stop.city}
                              {stop.satisfies && (
                                <span className="text-accent">
                                  {" "}
                                  · you asked for this: {stop.satisfies}
                                </span>
                              )}
                            </p>
                            {source && (
                              <a
                                href={source}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="mt-1.5 inline-flex items-center gap-1 font-sans text-xs text-muted hover:text-fg transition-colors underline underline-offset-2"
                              >
                                <ExternalLink className="w-3 h-3" />
                                {new URL(source).hostname.replace(/^www\./, "")}
                              </a>
                            )}
                          </div>
                          <span className="font-sans text-xs text-muted tabular-nums shrink-0">
                            {formatMoney(stop.cost, plan.currency)}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
          </div>

          <aside className="xl:col-span-4 flex flex-col gap-10">
            <ProposalDecision proposalId={proposal.id} />

            <section>
              <h2 className="font-display uppercase text-label tracking-label text-accent border-b border-line pb-2">
                What I read
              </h2>
              <p className="mt-3 font-sans text-xs text-muted">
                Every price above came off one of these pages. They were read on
                the day this plan was made, and prices move.
              </p>
              <ul className="mt-4 flex flex-col gap-2">
                {(research.sources ?? []).slice(0, 20).map((source) => (
                  <li key={source.url}>
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-sans text-xs text-muted hover:text-fg transition-colors underline underline-offset-2 line-clamp-2"
                    >
                      {source.title}
                    </a>
                  </li>
                ))}
              </ul>
            </section>

            <section>
              <h2 className="font-display uppercase text-label tracking-label text-accent border-b border-line pb-2">
                What you told me
              </h2>
              <p className="mt-3 font-sans text-xs text-muted italic">
                “{proposal.description}”
              </p>
            </section>
          </aside>
        </div>
      </div>
    </main>
  );
}
