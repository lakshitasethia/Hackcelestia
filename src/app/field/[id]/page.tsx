import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft, Phone, Radio } from "lucide-react";
import AppNav from "@/components/layout/AppNav";
import LiveRefresh from "@/components/realtime/LiveRefresh";
import StopCard from "@/components/field/StopCard";
import {
  getItems,
  getOpenDisruptions,
  getRunSheet,
  getTrip,
  groupByLocalDay,
} from "@/lib/db/queries";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Field" };

/**
 * The coordinator's run sheet.
 *
 * Narrow by construction — this is the only surface designed for a phone held
 * in one hand, so it is a single column at every breakpoint rather than a
 * desktop layout that collapses. It shows two days, not five: what is happening
 * now and what has to be right by tomorrow morning. The rest of the itinerary
 * is the office's problem.
 */
export default async function FieldRunSheet({
  params,
}: {
  params: { id: string };
}) {
  const trip = await getTrip(params.id);
  if (!trip) notFound();

  const [runSheet, allItems, disruptions] = await Promise.all([
    getRunSheet(trip.id, 2),
    getItems(trip.id),
    getOpenDisruptions(trip.id),
  ]);

  const titleById = new Map(allItems.map((i) => [i.id, i.title]));
  const days = groupByLocalDay(runSheet);

  const live = runSheet.filter(
    (i) => i.status !== "cancelled" && i.status !== "replaced"
  );
  const done = live.filter((i) => i.field_state === "done").length;

  return (
    <main
      data-scroll-theme="dark"
      className="min-h-screen bg-surface text-fg selection:bg-fg selection:text-bg"
    >
      <AppNav />

      <div className="max-w-2xl mx-auto px-5 sm:px-8 pt-24 pb-24">
        <header>
          <div className="flex items-center justify-between gap-4">
            <span className="eyebrow flex items-center gap-2 !mb-0">
              <Radio className="w-3.5 h-3.5" />· On the ground ·
            </span>
            <LiveRefresh tripIds={[trip.id]} />
          </div>

          <h1 className="mt-4 font-display text-display-md font-semibold uppercase text-fg text-balance">
            {trip.contact_name ?? trip.title}
          </h1>

          <p className="mt-3 font-sans text-sm text-muted">
            {trip.party_size} {trip.party_size === 1 ? "traveler" : "travelers"}
            {trip.coordinator_name && <> · guided by {trip.coordinator_name}</>}
            {trip.starts_on && <> · from {formatDate(trip.starts_on)}</>}
          </p>

          {trip.contact_phone && (
            <a
              href={`tel:${trip.contact_phone.replace(/\s/g, "")}`}
              className="mt-4 inline-flex items-center gap-2 border border-line px-4 py-2 font-sans text-xs uppercase tracking-wider font-bold text-muted hover:text-fg hover:border-fg transition-colors"
            >
              <Phone className="w-3.5 h-3.5" />
              Call {trip.contact_name?.split(" ")[0] ?? "the group"}
            </a>
          )}
        </header>

        {/* What the office already knows about, so the guide does not report a
            problem that is halfway to being solved — and does not assume one is
            being handled when nobody has looked at it. */}
        {disruptions.length > 0 && (
          <section className="mt-8 border border-accent p-5">
            <h2 className="font-display uppercase text-label tracking-label text-accent flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              The office is working on{" "}
              {disruptions.length === 1 ? "this" : `${disruptions.length} things`}
            </h2>
            <ul className="mt-3 flex flex-col gap-2">
              {disruptions.map((d) => (
                <li key={d.id} className="font-sans text-sm text-fg">
                  {d.headline}
                  <span className="block font-sans text-xs text-muted mt-0.5">
                    Reported {new Date(d.detected_at).toLocaleTimeString("en-GB", {
                      hour: "2-digit",
                      minute: "2-digit",
                      timeZone: "Europe/Rome",
                    })}{" "}
                    · a re-plan will land here when it is accepted
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="mt-8 border-y border-line py-5 flex items-center justify-between gap-4">
          <div>
            <span className="font-display uppercase text-label tracking-label text-accent">
              Next 48 hours
            </span>
            <p className="mt-1 font-sans text-sm text-muted">
              {done} of {live.length} stops reported done
            </p>
          </div>
          <span className="font-display text-3xl font-semibold text-fg tabular-nums">
            {live.length ? Math.round((done / live.length) * 100) : 0}%
          </span>
        </section>

        {days.length === 0 ? (
          <p className="mt-12 text-body-lg text-muted">
            Nothing scheduled in the next two days.
          </p>
        ) : (
          <div className="mt-12 flex flex-col gap-12">
            {days.map(({ label, items }) => (
              <section key={label}>
                <h2 className="font-display text-display-sm font-semibold uppercase text-fg sticky top-16 bg-surface py-3 z-10">
                  {label}
                </h2>
                <div className="mt-2 flex flex-col gap-4">
                  {items.map((item) => (
                    <StopCard
                      key={item.id}
                      item={item}
                      dependsOn={item.depends_on
                        .map((id) => titleById.get(id))
                        .filter((t): t is string => Boolean(t))}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}

        <div className="mt-16 pt-8 border-t border-line flex flex-wrap gap-6 justify-between">
          <Link href="/field" className="link-underline">
            <ArrowLeft className="w-4 h-4" />
            <span>My groups</span>
          </Link>
          <Link href={`/trip/${trip.id}`} className="link-underline">
            <span>Full itinerary</span>
          </Link>
        </div>
      </div>
    </main>
  );
}
