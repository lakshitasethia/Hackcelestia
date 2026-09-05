import {
  Bed,
  Car,
  Compass,
  Lock,
  Plane,
  UtensilsCrossed,
  UserRound,
  AlertTriangle,
} from "lucide-react";
import type { ItemStatus, ItemType, ItineraryItem } from "@/lib/db/types";
import { formatDuration, formatMoney, formatTime } from "@/lib/format";

const ICONS: Record<ItemType, typeof Bed> = {
  hotel: Bed,
  activity: Compass,
  transport: Car,
  guide: UserRound,
  restaurant: UtensilsCrossed,
  flight: Plane,
};

/**
 * Status is carried by a text label and a border weight rather than colour
 * alone — the palette here is two warm tones that invert on scroll, so a
 * colour-only signal would be unreadable in one of the two themes (and to
 * anyone who cannot separate them anyway).
 */
const STATUS_LABEL: Record<ItemStatus, string | null> = {
  planned: "Planned",
  confirmed: null, // the default; labelling it adds noise to every card
  at_risk: "At risk",
  cancelled: "Cancelled",
  replaced: "Replaced",
};

export default function ItemCard({
  item,
  dependsOn,
  currency,
  timeZone,
}: {
  item: ItineraryItem;
  /** Titles of the items this one cannot happen without. */
  dependsOn: string[];
  currency: string;
  /** The trip's zone, so a 04:00 start in Garhwal reads as 04:00. */
  timeZone: string;
}) {
  const Icon = ICONS[item.type] ?? Compass;
  const statusLabel = STATUS_LABEL[item.status];
  const dimmed = item.status === "cancelled" || item.status === "replaced";
  const flagged = item.status === "at_risk";

  return (
    <article
      className={`surface p-5 transition-colors ${
        flagged ? "ring-1 ring-accent" : ""
      } ${dimmed ? "opacity-45" : ""}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4 min-w-0">
          <div className="w-10 h-10 shrink-0 border border-line flex items-center justify-center text-accent">
            <Icon className="w-5 h-5" />
          </div>

          <div className="min-w-0">
            <div className="flex items-baseline gap-3 flex-wrap">
              <span className="font-display text-lg font-semibold text-fg tabular-nums">
                {formatTime(item.starts_at, timeZone)}
              </span>
              <span className="font-sans text-xs uppercase tracking-wider text-muted">
                {formatDuration(item.starts_at, item.ends_at)}
              </span>
            </div>

            <h3
              className={`font-display text-display-sm font-semibold uppercase text-fg mt-1 ${
                dimmed ? "line-through" : ""
              }`}
            >
              {item.title}
            </h3>

            {dependsOn.length > 0 && (
              // The DAG, made legible. Without this the itinerary reads as a
              // list and the blast radius later looks arbitrary.
              <p className="mt-2 font-sans text-xs text-muted">
                <span className="uppercase tracking-wider">Needs</span>{" "}
                {dependsOn.join(" · ")}
              </p>
            )}

            {item.lock_reason && (
              <p className="mt-2 flex items-center gap-1.5 font-sans text-xs text-muted">
                <Lock className="w-3 h-3 shrink-0" />
                {item.lock_reason}
              </p>
            )}
          </div>
        </div>

        <div className="text-right shrink-0">
          <div className="font-display text-lg font-semibold text-fg tabular-nums">
            {formatMoney(Number(item.cost), currency)}
          </div>
          {statusLabel && (
            <div
              className={`mt-1 font-sans text-xs uppercase tracking-wider ${
                flagged ? "text-accent" : "text-muted"
              }`}
            >
              {flagged && (
                <AlertTriangle className="w-3 h-3 inline mr-1 -mt-0.5" />
              )}
              {statusLabel}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
