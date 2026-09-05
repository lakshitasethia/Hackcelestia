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

  const days = groupByDay(items);
  const total = items.reduce((sum, i) => sum + Number(i.cost), 0);
  const tz = trip.time_zone;

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

      {[...days.entries()].map(([day, dayItems]) => (
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
                <tr key={item.id}>
                  <td className="doc-time">{formatTime(item.starts_at, tz)}</td>
                  <td className="doc-what">
                    <span className="doc-what-title">{item.title}</span>
                    <span className="doc-what-meta">
                      {item.type} · {formatDuration(item.starts_at, item.ends_at)}
                      {bookedItems.has(item.id) ? " · booked" : " · not booked"}
                    </span>
                    {item.notes && <span className="doc-note">{item.notes}</span>}
                  </td>
                  <td className="doc-cost">
                    {/* "Free" rather than a dash. On a printed itinerary a dash
                        reads as a price nobody found, and half the good things
                        in a city cost nothing — that is worth stating. */}
                    {Number(item.cost) > 0
                      ? formatMoney(Number(item.cost), trip.currency)
                      : "Free"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}

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
