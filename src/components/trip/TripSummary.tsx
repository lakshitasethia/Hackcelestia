import { AlertTriangle } from "lucide-react";
import type { Booking, ItineraryItem, Trip } from "@/lib/db/types";
import { summarize } from "@/lib/db/queries";
import { formatDate, formatMoney } from "@/lib/format";

/**
 * The running total, which is the promise the landing page makes ("watch
 * transparent itemized totals calculate live with every change"). Recomputed
 * from the items on every render rather than stored on the trip, so it cannot
 * fall out of step with what is actually booked.
 */
export default function TripSummary({
  trip,
  items,
  bookings,
}: {
  trip: Trip;
  items: ItineraryItem[];
  bookings: Booking[];
}) {
  const { total, atRisk, confirmed, count, penaltyIfCancelled } = summarize(
    items,
    bookings
  );
  const budget = trip.budget === null ? null : Number(trip.budget);
  const remaining = budget === null ? null : budget - total;

  const stats: { label: string; value: string; note?: string; flag?: boolean }[] = [
    {
      label: "Itinerary total",
      value: formatMoney(total, trip.currency),
      note: `${count} items · ${confirmed} confirmed`,
    },
    budget !== null
      ? {
          label: remaining! >= 0 ? "Under budget" : "Over budget",
          value: formatMoney(Math.abs(remaining!), trip.currency),
          note: `of ${formatMoney(budget, trip.currency)}`,
          flag: remaining! < 0,
        }
      : { label: "Budget", value: "Not set" },
    {
      label: "Locked in",
      value: formatMoney(penaltyIfCancelled, trip.currency),
      note: "non-refundable if cancelled today",
    },
  ];

  // Only earns a slot when something is actually threatened.
  if (atRisk > 0) {
    stats.push({
      label: "At risk",
      value: formatMoney(atRisk, trip.currency),
      note: "awaiting a re-plan decision",
      flag: true,
    });
  }

  return (
    <section className="border-y border-line py-8">
      <dl className="grid grid-cols-2 lg:grid-cols-4 gap-x-8 gap-y-8">
        {stats.map((stat) => (
          <div key={stat.label}>
            <dt className="font-display uppercase text-label tracking-label text-accent flex items-center gap-1.5">
              {stat.flag && <AlertTriangle className="w-3.5 h-3.5" />}
              {stat.label}
            </dt>
            <dd className="mt-2 font-display text-2xl sm:text-3xl font-semibold uppercase tracking-tight text-fg tabular-nums">
              {stat.value}
            </dd>
            {stat.note && (
              <dd className="mt-1 font-sans text-xs text-muted">{stat.note}</dd>
            )}
          </div>
        ))}
      </dl>
    </section>
  );
}
