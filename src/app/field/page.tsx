import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Radio } from "lucide-react";
import AppNav from "@/components/layout/AppNav";
import { getCoordinatorTrips } from "@/lib/db/queries";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Field" };

/**
 * The coordinator's way in.
 *
 * A guide running one group should not have to pick it out of a list of one —
 * so with a single assignment this is a redirect and the list never renders.
 * It exists for the operator who runs three groups in a week, and because a
 * dead end here is worse than a page nobody sees.
 */
export default async function FieldHome() {
  const trips = await getCoordinatorTrips();

  if (trips.length === 1) redirect(`/field/${trips[0].id}`);

  return (
    <main
      data-scroll-theme="dark"
      className="min-h-screen bg-surface text-fg selection:bg-fg selection:text-bg"
    >
      <AppNav />

      <div className="max-w-2xl mx-auto px-5 sm:px-8 pt-24 pb-24">
        <span className="eyebrow flex items-center gap-2">
          <Radio className="w-3.5 h-3.5" />· On the ground ·
        </span>
        <h1 className="font-display text-display-md font-semibold uppercase text-fg">
          My groups
        </h1>

        {trips.length === 0 ? (
          <p className="mt-8 text-body-lg text-muted">
            No groups assigned. An operator assigns a coordinator on the trip
            record.
          </p>
        ) : (
          <ul className="mt-10 flex flex-col gap-3">
            {trips.map((trip) => (
              <li key={trip.id}>
                <Link
                  href={`/field/${trip.id}`}
                  className="surface p-5 flex items-center justify-between gap-4 hover:border-fg transition-colors group"
                >
                  <div className="min-w-0">
                    <span className="font-display text-display-sm font-semibold uppercase text-fg block">
                      {trip.contact_name ?? trip.title}
                    </span>
                    <span className="font-sans text-xs text-muted">
                      {trip.party_size} pax
                      {trip.starts_on && ` · from ${formatDate(trip.starts_on)}`}{" "}
                      · {trip.status.replace(/_/g, " ")}
                    </span>
                  </div>
                  <ArrowRight className="w-4 h-4 shrink-0 text-muted group-hover:text-accent group-hover:translate-x-1 transition-all" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
