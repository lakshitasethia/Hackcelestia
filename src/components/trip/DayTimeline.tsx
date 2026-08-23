import type { ItineraryItem } from "@/lib/db/types";
import { formatDateLong, formatMoney } from "@/lib/format";
import ItemCard from "./ItemCard";

export default function DayTimeline({
  day,
  items,
  titleById,
  currency,
}: {
  day: number;
  items: ItineraryItem[];
  /** Every item in the trip, so `depends_on` ids can be shown as names. */
  titleById: Map<string, string>;
  currency: string;
}) {
  const dayTotal = items
    .filter((i) => i.status !== "cancelled" && i.status !== "replaced")
    .reduce((sum, i) => sum + Number(i.cost), 0);

  return (
    <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-10">
      <header className="lg:col-span-3 lg:sticky lg:top-28 lg:self-start">
        <span className="font-display uppercase text-label tracking-label text-accent">
          Day {String(day).padStart(2, "0")}
        </span>
        <h2 className="mt-2 font-display text-display-sm font-semibold uppercase text-fg">
          {items[0] ? formatDateLong(items[0].starts_at) : ""}
        </h2>
        <p className="mt-2 font-sans text-xs uppercase tracking-wider text-muted tabular-nums">
          {items.length} {items.length === 1 ? "stop" : "stops"} ·{" "}
          {formatMoney(dayTotal, currency)}
        </p>
      </header>

      <div className="lg:col-span-9 flex flex-col gap-4">
        {items.map((item) => (
          <ItemCard
            key={item.id}
            item={item}
            currency={currency}
            dependsOn={item.depends_on
              .map((id) => titleById.get(id))
              .filter((t): t is string => Boolean(t))}
          />
        ))}
      </div>
    </section>
  );
}
