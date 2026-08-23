import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Check, Plus, X } from "lucide-react";
import AppNav from "@/components/layout/AppNav";
import {
  getInventory,
  getItems,
  getTrip,
  groupByDay,
} from "@/lib/db/queries";
import { formatMoney, formatTime } from "@/lib/format";
import { addItemAction, removeItemAction, confirmTripAction } from "./actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Build itinerary" };

export default async function BuildPage({
  params,
}: {
  params: { id: string };
}) {
  const trip = await getTrip(params.id);
  if (!trip) notFound();

  const [items, inventory] = await Promise.all([
    getItems(trip.id),
    getInventory(),
  ]);

  const byDay = groupByDay(items);
  const titleById = new Map(items.map((i) => [i.id, i.title]));
  const total = items.reduce((sum, i) => sum + Number(i.cost), 0);
  const budget = trip.budget === null ? null : Number(trip.budget);

  const dayCount =
    trip.starts_on && trip.ends_on
      ? Math.max(
          1,
          Math.round(
            (new Date(trip.ends_on).getTime() -
              new Date(trip.starts_on).getTime()) /
              86_400_000
          ) + 1
        )
      : 1;
  const days = Array.from({ length: dayCount }, (_, i) => i + 1);

  // Interests first — the whole point of collecting them is that the catalogue
  // reorders around them rather than showing an undifferentiated list.
  const interests = new Set(trip.prefs.interests ?? []);
  const ranked = [...inventory].sort((a, b) => {
    const score = (tags: string[]) =>
      tags.filter((t) => interests.has(t)).length;
    return score(b.tags ?? []) - score(a.tags ?? []);
  });

  const field =
    "bg-transparent border border-line px-3 py-2 text-fg font-sans text-xs focus:outline-none focus:border-fg transition-colors";

  return (
    <main
      data-scroll-theme="dark"
      className="min-h-screen bg-surface text-fg selection:bg-fg selection:text-bg"
    >
      <AppNav />

      <div className="max-w-[110rem] mx-auto px-5 sm:px-8 lg:px-12 pt-28 pb-24">
        <header className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <span className="eyebrow">· Building · {trip.status} ·</span>
            <h1 className="font-display text-display-lg font-semibold uppercase text-fg">
              {trip.title}
            </h1>
            <p className="mt-4 font-sans text-sm text-muted">
              {items.length} {items.length === 1 ? "stop" : "stops"} ·{" "}
              {formatMoney(total, trip.currency)}
              {budget !== null && (
                <>
                  {" of "}
                  {formatMoney(budget, trip.currency)}
                  {total > budget && (
                    <span className="text-accent">
                      {" "}
                      · {formatMoney(total - budget, trip.currency)} over
                    </span>
                  )}
                </>
              )}
            </p>
          </div>

          {items.length > 0 && (
            <form action={confirmTripAction}>
              <input type="hidden" name="tripId" value={trip.id} />
              <button type="submit" className="btn-solid px-6 py-3 text-xs tracking-wider">
                <Check className="w-4 h-4 mr-2 inline" />
                Confirm itinerary
              </button>
            </form>
          )}
        </header>

        <div className="mt-14 grid grid-cols-1 xl:grid-cols-12 gap-12">
          <div className="xl:col-span-7 flex flex-col gap-10">
            {days.map((day) => {
              const dayItems = byDay.get(day) ?? [];
              return (
                <section key={day}>
                  <h2 className="font-display uppercase text-label tracking-label text-accent border-b border-line pb-2">
                    Day {String(day).padStart(2, "0")}
                  </h2>

                  {dayItems.length === 0 ? (
                    <p className="mt-4 font-sans text-sm text-muted">
                      Nothing planned yet.
                    </p>
                  ) : (
                    <ul className="mt-4 flex flex-col gap-3">
                      {dayItems.map((item) => (
                        <li
                          key={item.id}
                          className="surface p-4 flex items-start justify-between gap-4"
                        >
                          <div className="min-w-0">
                            <span className="font-display font-semibold text-fg tabular-nums">
                              {formatTime(item.starts_at)}
                            </span>
                            <h3 className="font-display text-base font-semibold uppercase text-fg mt-0.5">
                              {item.title}
                            </h3>
                            {item.depends_on.length > 0 && (
                              <p className="mt-1 font-sans text-xs text-muted">
                                <span className="uppercase tracking-wider">
                                  Needs
                                </span>{" "}
                                {item.depends_on
                                  .map((id) => titleById.get(id))
                                  .filter(Boolean)
                                  .join(" · ")}
                              </p>
                            )}
                          </div>

                          <div className="flex items-center gap-4 shrink-0">
                            <span className="font-display font-semibold text-fg tabular-nums">
                              {formatMoney(Number(item.cost), trip.currency)}
                            </span>
                            <form action={removeItemAction}>
                              <input type="hidden" name="tripId" value={trip.id} />
                              <input type="hidden" name="itemId" value={item.id} />
                              <button
                                type="submit"
                                aria-label={`Remove ${item.title}`}
                                className="p-1.5 border border-line text-muted hover:text-fg hover:border-fg transition-colors"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </form>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              );
            })}
          </div>

          <aside className="xl:col-span-5">
            <div className="xl:sticky xl:top-24">
              <h2 className="font-display text-display-sm font-semibold uppercase text-fg">
                Catalogue
              </h2>
              <p className="mt-2 font-sans text-xs uppercase tracking-wider text-muted">
                {interests.size > 0
                  ? `Sorted by your interests: ${[...interests].join(", ")}`
                  : `${inventory.length} options`}
              </p>

              <ul className="mt-6 flex flex-col gap-3 max-h-[70vh] overflow-y-auto pr-1">
                {ranked.map((option) => (
                  <li key={option.id} className="surface p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="font-display text-base font-semibold uppercase text-fg">
                          {option.title}
                        </h3>
                        <p className="font-sans text-xs text-muted mt-0.5">
                          {option.vendors?.name} · {option.type} ·{" "}
                          {option.duration_min} min
                        </p>
                        {(option.tags ?? []).length > 0 && (
                          <p className="font-sans text-xs text-muted mt-1">
                            {(option.tags ?? []).join(" · ")}
                          </p>
                        )}
                      </div>
                      <span className="font-display font-semibold text-fg tabular-nums shrink-0">
                        {formatMoney(Number(option.base_cost), trip.currency)}
                      </span>
                    </div>

                    <form
                      action={addItemAction}
                      className="mt-3 flex items-center gap-2"
                    >
                      <input type="hidden" name="tripId" value={trip.id} />
                      <input
                        type="hidden"
                        name="inventoryId"
                        value={option.id}
                      />
                      <select
                        name="day"
                        defaultValue={1}
                        aria-label="Day"
                        className={field}
                      >
                        {days.map((day) => (
                          <option key={day} value={day}>
                            Day {day}
                          </option>
                        ))}
                      </select>
                      <input
                        type="time"
                        name="localTime"
                        defaultValue={
                          option.opens_at?.slice(0, 5) ?? "09:00"
                        }
                        aria-label="Start time"
                        className={field}
                      />
                      <button
                        type="submit"
                        className="flex items-center gap-1.5 border border-line px-3 py-2 font-sans text-xs uppercase tracking-wider font-bold text-muted hover:text-fg hover:border-fg transition-colors ml-auto"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Add
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        </div>

        <div className="mt-20 pt-8 border-t border-line">
          <Link href={`/trip/${trip.id}`} className="link-underline">
            <span>View as traveler</span>
          </Link>
        </div>
      </div>
    </main>
  );
}
