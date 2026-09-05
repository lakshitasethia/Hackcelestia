import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getBookings, getItems, getTrip, groupByDay } from "@/lib/db/queries";
import {
  formatDateLong,
  formatMoney,
  formatTime,
  formatDuration,
} from "@/lib/format";
import PrintButton from "@/components/trip/PrintButton";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Itinerary",
  // A PDF of a draft itinerary is a document someone will email around. It has
  // no business in a search index.
  robots: { index: false, follow: false },
};

/**
 * The itinerary as a document, for paper or a PDF.
 *
 * Deliberately its own route rather than a print stylesheet bolted onto the
 * trip page. That page carries the nav, the concierge chat, a live-refresh
 * subscription and a re-plan trace panel — none of which mean anything on
 * paper, and all of which would have to be hidden by hand and re-hidden every
 * time somebody added a section. A separate route renders only what belongs in
 * the document, so what you see is what prints.
 *
 * There is no PDF library here on purpose. "Save as PDF" is in the print
 * dialog of every browser this will ever run in, it produces selectable text
 * with working links rather than a picture of a page, it costs nothing in the
 * serverless bundle, and it needs no fonts shipped server-side. The button is
 * one line of client code.
 *
 * Colours are declared black-on-white and the page is laid out in `pt`,
 * because the app's dark theme prints as a solid black rectangle and most
 * browsers strip background colours from printed output anyway.
 */
export default async function PrintPage({ params }: { params: { id: string } }) {
  const trip = await getTrip(params.id);
  if (!trip) notFound();

  const [items, bookings] = await Promise.all([
    getItems(trip.id),
    getBookings(trip.id),
  ]);

  /**
   * What the document is for: the plan as it stands *now*.
   *
   * A re-planned trip keeps the stop it replaced, so an unfiltered read prints
   * the cancelled boat and the substitute that took its place, one under the
   * other, and adds both to the total. Somebody carrying that page has two
   * things at 09:00 and a number that is wrong.
   *
   * `replaced` rows are dropped: the substitute is already in the list and says
   * the same thing better. `cancelled` rows stay, marked — a traveler who
   * remembers booking Capri should see that it is off rather than find it
   * quietly missing — but they do not count towards the total.
   */
  const live = items.filter((i) => i.status !== "replaced");
  const days = groupByDay(live);
  const total = live
    .filter((i) => i.status !== "cancelled")
    .reduce((sum, i) => sum + Number(i.cost), 0);
  const tz = trip.time_zone;

  /**
   * Every day of the trip, including the ones with nothing on them.
   *
   * The document used to iterate the days that *had stops*, which is not the
   * same list. The composer leaves the last day free — it is the journey home
   * — so a thirteen-day trip printed a header saying thirteen days and then
   * ended at Day 12, and the reader is left wondering what happened to the
   * last one or whether the page was cut off.
   *
   * An empty day printed as an empty day answers that. It is also just true:
   * a free day is part of the itinerary, and a traveler holding this piece of
   * paper wants to see that Thursday is theirs rather than missing.
   */
  const dayCount =
    trip.starts_on && trip.ends_on
      ? Math.max(
          1,
          Math.round(
            (Date.parse(trip.ends_on) - Date.parse(trip.starts_on)) / 86_400_000
          ) + 1
        )
      : days.size;

  const dateOfDay = (day: number): string | null => {
    if (!trip.starts_on) return null;
    const when = new Date(`${trip.starts_on}T12:00:00Z`);
    when.setUTCDate(when.getUTCDate() + day - 1);
    return when.toISOString();
  };

  // A booked stop and a planned one are different things to somebody standing
  // in an airport, so the document says which is which.
  const bookedItems = new Set(
    bookings
      .filter((b) => b.state === "held" || b.state === "confirmed")
      .map((b) => b.item_id)
      .filter(Boolean) as string[]
  );

  return (
    <main className="print-doc">
      {/* Screen-only. `print:hidden` is not enough on its own here — the
          button is the only interactive thing on the page, so it also needs to
          not look like part of the document. */}
      <div className="no-print">
        <PrintButton />
      </div>

      <header className="doc-head">
        <p className="doc-eyebrow">Itinerary · {trip.status.replace(/_/g, " ")}</p>
        <h1 className="doc-title">{trip.title}</h1>
        <p className="doc-sub">
          {trip.starts_on && formatDateLong(trip.starts_on, tz)}
          {trip.ends_on && ` — ${formatDateLong(trip.ends_on, tz)}`}
          {" · "}
          {trip.party_size} {trip.party_size === 1 ? "traveler" : "travelers"}
          {(trip.destinations ?? []).length > 0 &&
            ` · ${(trip.destinations ?? []).join(" → ")}`}
        </p>
        {trip.contact_name && (
          <p className="doc-sub">
            {trip.contact_name}
            {trip.contact_email && ` · ${trip.contact_email}`}
          </p>
        )}
      </header>

      {Array.from({ length: Math.max(dayCount, days.size) }, (_, i) => i + 1).map((day) => {
        const dayItems = days.get(day) ?? [];
        const date = dayItems[0]?.starts_at ?? dateOfDay(day);

        if (dayItems.length === 0) {
          return (
            <section key={day} className="doc-day">
              <h2 className="doc-day-head">
                <span>Day {String(day).padStart(2, "0")}</span>
                <span className="doc-day-date">
                  {date && formatDateLong(date, tz)}
                </span>
              </h2>
              <p className="doc-note">
                {day === dayCount
                  ? "Travelling home. Nothing booked."
                  : "Nothing booked — the day is yours."}
              </p>
            </section>
          );
        }

        return (
          // `break-inside: avoid` on the day, not on the page: a day that fits
          // should not be split across two sheets, and a day that does not fit
          // has to be allowed to break or it leaves a blank page behind it.
          <section key={day} className="doc-day">
          <h2 className="doc-day-head">
            <span>Day {String(day).padStart(2, "0")}</span>
            <span className="doc-day-date">
              {dayItems[0] && formatDateLong(dayItems[0].starts_at, tz)}
            </span>
          </h2>

          <table className="doc-table">
            <tbody>
              {dayItems.map((item) => (
                <tr key={item.id} className={item.status === "cancelled" ? "doc-off" : undefined}>
                  <td className="doc-time">{formatTime(item.starts_at, tz)}</td>
                  <td className="doc-what">
                    <span className="doc-what-title">{item.title}</span>
                    <span className="doc-what-meta">
                      {item.type} · {formatDuration(item.starts_at, item.ends_at)}
                      {item.status === "cancelled"
                        ? " · cancelled"
                        : bookedItems.has(item.id)
                          ? " · booked"
                          : " · not booked"}
                    </span>
                    {item.notes && <span className="doc-note">{item.notes}</span>}
                  </td>
                  <td className="doc-cost">
                    {/* "Free" rather than a dash. On a printed itinerary a dash
                        reads as a price nobody found, and half the good things
                        in a city cost nothing — that is worth stating. */}
                    {item.status === "cancelled"
                      ? "—"
                      : Number(item.cost) > 0
                        ? formatMoney(Number(item.cost), trip.currency)
                        : "Free"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        );
      })}

      <footer className="doc-foot">
        <p className="doc-total">
          <span>Total</span>
          <span>{formatMoney(total, trip.currency)}</span>
        </p>
        {trip.budget !== null && (
          <p className="doc-sub">
            Budget {formatMoney(Number(trip.budget), trip.currency)}
            {total > Number(trip.budget) &&
              ` · ${formatMoney(total - Number(trip.budget), trip.currency)} over`}
          </p>
        )}
        <p className="doc-fineprint">
          Prices were researched from public sources and are not quotes. Stops
          marked “not booked” have not been reserved with the supplier.
          Generated {formatDateLong(new Date().toISOString(), tz)}.
        </p>
      </footer>
    </main>
  );
}
