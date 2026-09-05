import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Star } from "lucide-react";
import AppNav from "@/components/layout/AppNav";
import { getOperatorReviews } from "@/lib/db/queries";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Reviews" };

/**
 * What came back from finished trips.
 *
 * Review is the last stage in the brief, and a rating a traveler leaves is
 * worth nothing if the only person who sees it is the traveler. This is the
 * other half: every rating against the stop it was about, worst first.
 *
 * Worst first is a decision. An operator opening this screen is looking for
 * the vendor to have a conversation with, not for reassurance — and a page
 * sorted by date buries a 1-star camp under a week of 5-star dinners.
 */
export default async function OpsReviewsPage() {
  const reviews = await getOperatorReviews();

  const stopReviews = reviews.filter((r) => r.item_id);
  const tripReviews = reviews.filter((r) => !r.item_id);

  const mean = (list: typeof reviews) =>
    list.length
      ? Math.round((list.reduce((s, r) => s + r.rating, 0) / list.length) * 10) / 10
      : null;

  const overall = mean(tripReviews);
  const poor = stopReviews.filter((r) => r.rating <= 2);

  // Worst first, then newest, so the thing needing attention is at the top.
  const sorted = [...reviews].sort(
    (a, b) => a.rating - b.rating || b.created_at.localeCompare(a.created_at)
  );

  return (
    <main
      data-scroll-theme="dark"
      className="min-h-screen bg-surface text-fg selection:bg-fg selection:text-bg"
    >
      <AppNav />

      <div className="max-w-[110rem] mx-auto px-5 sm:px-8 lg:px-12 pt-28 pb-24">
        <Link
          href="/ops"
          className="inline-flex items-center gap-1.5 font-sans text-xs uppercase tracking-wider text-muted hover:text-fg transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Operations
        </Link>

        <span className="eyebrow mt-8">· Review ·</span>
        <h1 className="font-display text-display-lg font-semibold uppercase text-fg">
          What came back
        </h1>

        <section className="mt-10 border-y border-line py-8">
          <dl className="grid grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-8">
            {[
              {
                label: "Trips rated",
                value: String(tripReviews.length),
                note: overall ? `${overall} out of 5 on average` : "none yet",
              },
              {
                label: "Stops rated",
                value: String(stopReviews.length),
                note: "individual bookings",
              },
              {
                label: "Needs a word",
                value: String(poor.length),
                note: poor.length ? "rated 2 or below" : "nothing below 3",
                flag: poor.length > 0,
              },
            ].map((stat) => (
              <div key={stat.label}>
                <dt className="font-display uppercase text-label tracking-label text-accent">
                  {stat.label}
                </dt>
                <dd
                  className={`mt-2 font-display text-2xl sm:text-3xl font-semibold uppercase tracking-tight tabular-nums ${
                    stat.flag ? "text-accent" : "text-fg"
                  }`}
                >
                  {stat.value}
                </dd>
                <dd className="mt-1 font-sans text-xs text-muted">{stat.note}</dd>
              </div>
            ))}
          </dl>
        </section>

        {sorted.length === 0 ? (
          <p className="mt-12 text-body-lg text-muted max-w-2xl">
            Nothing yet. Reviews arrive once a trip is closed out — a traveler
            marks it complete on their itinerary and rates it stop by stop.
          </p>
        ) : (
          <ul className="mt-12 flex flex-col gap-3">
            {sorted.map((review) => (
              <li key={review.id} className="surface p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h2 className="font-display text-base font-semibold uppercase text-fg">
                      {review.itinerary_items?.title ?? "The trip overall"}
                    </h2>
                    <p className="font-sans text-xs text-muted mt-1">
                      {review.trips?.contact_name ?? review.trips?.title ?? "A group"}
                      {review.itinerary_items?.type &&
                        ` · ${review.itinerary_items.type}`}
                      {` · ${formatDate(review.created_at)}`}
                    </p>
                    {review.comment && (
                      <p className="font-sans text-sm text-fg mt-3 max-w-2xl">
                        “{review.comment}”
                      </p>
                    )}
                  </div>

                  <div
                    className={`flex items-center gap-0.5 shrink-0 ${
                      review.rating <= 2 ? "text-accent" : "text-fg"
                    }`}
                    aria-label={`${review.rating} out of 5`}
                  >
                    {[1, 2, 3, 4, 5].map((n) => (
                      <Star
                        key={n}
                        className={`w-4 h-4 ${n <= review.rating ? "fill-current" : "opacity-25"}`}
                      />
                    ))}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
