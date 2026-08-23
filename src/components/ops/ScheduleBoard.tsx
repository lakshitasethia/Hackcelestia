import { AlertTriangle, Bot, User } from "lucide-react";
import type { ScheduleEntry } from "@/lib/db/queries";
import { formatDateLong, formatMoney, formatTime } from "@/lib/format";

/**
 * The operator's working view: every movement across every group for the next
 * few days, in time order rather than grouped by trip. A coordinator's question
 * is "what is happening at 09:00", not "what does the Sharma party have booked"
 * — so time is the primary axis and the group is a column.
 */
export default function ScheduleBoard({ entries }: { entries: ScheduleEntry[] }) {
  const byDate = new Map<string, ScheduleEntry[]>();
  for (const entry of entries) {
    const key = formatDateLong(entry.starts_at);
    if (!byDate.has(key)) byDate.set(key, []);
    byDate.get(key)!.push(entry);
  }

  return (
    <section>
      <h2 className="font-display text-display-sm font-semibold uppercase text-fg">
        Schedule
      </h2>
      <p className="mt-2 font-sans text-xs uppercase tracking-wider text-muted">
        Next 72 hours · all groups
      </p>

      {entries.length === 0 ? (
        <p className="mt-6 text-muted">Nothing scheduled in this window.</p>
      ) : (
        <div className="mt-6 flex flex-col gap-10">
          {[...byDate].map(([date, dayEntries]) => (
            <div key={date}>
              <h3 className="font-display uppercase text-label tracking-label text-accent border-b border-line pb-2">
                {date}
              </h3>
              <ul className="mt-3">
                {dayEntries.map((entry) => {
                  const flagged = entry.status === "at_risk";
                  const dropped =
                    entry.status === "cancelled" || entry.status === "replaced";

                  return (
                    <li
                      key={entry.id}
                      className={`grid grid-cols-12 gap-3 items-baseline py-3 border-b border-line ${
                        dropped ? "opacity-45" : ""
                      }`}
                    >
                      <span className="col-span-2 font-display font-semibold text-fg tabular-nums">
                        {formatTime(entry.starts_at)}
                      </span>

                      <span className="col-span-5 min-w-0">
                        <span
                          className={`block font-sans font-medium text-fg truncate ${
                            dropped ? "line-through" : ""
                          }`}
                        >
                          {flagged && (
                            <AlertTriangle className="w-3.5 h-3.5 inline mr-1.5 -mt-0.5 text-accent" />
                          )}
                          {entry.title}
                        </span>
                        {entry.vendors && (
                          <span className="flex items-center gap-1 font-sans text-xs text-muted mt-0.5">
                            {/* Whether the comms agent can rebook this vendor
                                without a human is the operator's first question
                                when something breaks. */}
                            {entry.vendors.channel === "auto" ? (
                              <Bot className="w-3 h-3" />
                            ) : (
                              <User className="w-3 h-3" />
                            )}
                            {entry.vendors.name}
                          </span>
                        )}
                      </span>

                      <span className="col-span-3 font-sans text-xs text-muted truncate">
                        {entry.trips?.contact_name ?? entry.trips?.title ?? "—"}
                        {entry.trips && ` · ${entry.trips.party_size} pax`}
                      </span>

                      <span className="col-span-2 text-right font-sans text-sm text-fg tabular-nums">
                        {formatMoney(Number(entry.cost))}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
