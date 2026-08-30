import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Compass, LayoutGrid, Radio } from "lucide-react";
import AppNav from "@/components/layout/AppNav";
import { getOperatorTrips, getSchedule } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Voyage app" };

/**
 * Entry point into the product.
 *
 * With no auth there is nothing to route a person to automatically, so this
 * names the three lenses and lets you pick. It also doubles as the demo's
 * starting screen: the same disruption is about to be seen from all three, and
 * showing them side by side first makes that legible.
 */
export default async function AppHome() {
  const [trips, schedule] = await Promise.all([
    getOperatorTrips(),
    getSchedule(3),
  ]);
  const trip = trips[0];

  const surfaces = [
    {
      label: "Plan a trip",
      icon: Compass,
      href: "/plan",
      blurb:
        "Set your dates, budget and interests, then build the itinerary from real inventory.",
      stat: trip ? `Latest: ${trip.contact_name ?? trip.title}` : "No trips yet",
      ready: true,
    },
    {
      label: "Operations",
      icon: LayoutGrid,
      href: "/ops",
      blurb:
        "Every group, vendor and movement in one board — and every disruption waiting on a decision.",
      stat: `${schedule.length} movements in 72h`,
      ready: true,
    },
    {
      label: "Field",
      icon: Radio,
      href: "/field",
      blurb:
        "The coordinator on the ground: today's stops, confirm or flag, re-plans pushed live.",
      stat: trip?.coordinator_name
        ? `${trip.coordinator_name} is with the group`
        : "No coordinator assigned",
      ready: true,
    },
  ];

  return (
    <main
      data-scroll-theme="dark"
      className="min-h-screen bg-surface text-fg selection:bg-fg selection:text-bg"
    >
      <AppNav />

      <div className="max-w-[110rem] mx-auto px-5 sm:px-8 lg:px-12 pt-32 pb-24">
        <span className="eyebrow">· One trip, three lenses ·</span>
        <h1 className="font-display text-display-lg font-semibold uppercase text-fg text-balance max-w-4xl">
          Pick where you are standing.
        </h1>
        <p className="mt-6 text-body-lg text-muted max-w-2xl">
          The traveler, the operator and the guide see the same itinerary from
          different sides. When something breaks, all three have to agree within
          minutes — that is the whole product.
        </p>

        <div className="mt-14 grid grid-cols-1 md:grid-cols-3 gap-6">
          {surfaces.map(({ label, icon: Icon, href, blurb, stat, ready }) => {
            const body = (
              <>
                <div className="flex items-start justify-between">
                  <div className="w-11 h-11 border border-line flex items-center justify-center text-accent">
                    <Icon className="w-5 h-5" />
                  </div>
                  {ready ? (
                    <ArrowRight className="w-4 h-4 text-muted group-hover:text-accent group-hover:translate-x-1 transition-all" />
                  ) : (
                    <span className="font-sans text-xs uppercase tracking-wider text-muted">
                      Soon
                    </span>
                  )}
                </div>
                <h2 className="mt-5 font-display text-display-sm font-semibold uppercase text-fg">
                  {label}
                </h2>
                <p className="mt-2 text-sm text-muted leading-relaxed">{blurb}</p>
                <p className="mt-4 pt-3 border-t border-line font-sans text-xs uppercase tracking-wider text-accent">
                  {stat}
                </p>
              </>
            );

            return ready ? (
              <Link
                key={label}
                href={href}
                className="surface p-6 flex flex-col group hover:border-fg transition-colors"
              >
                {body}
              </Link>
            ) : (
              <div key={label} className="surface p-6 flex flex-col opacity-55">
                {body}
              </div>
            );
          })}
        </div>
      </div>
    </main>
  );
}
