import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, ArrowUpRight } from "lucide-react";
import AppNav from "@/components/layout/AppNav";
import LiveRefresh from "@/components/realtime/LiveRefresh";
import ScheduleBoard from "@/components/ops/ScheduleBoard";
import VendorTable from "@/components/ops/VendorTable";
import DemoControls from "@/components/ops/DemoControls";
import Copilot from "@/components/concierge/Copilot";
import {
  getAllOpenDisruptions,
  getOperatorTrips,
  getSchedule,
  getOperators,
  getVendors,
  operatorTotals,
} from "@/lib/db/queries";
import { getCopilotThread } from "@/lib/agent/copilot";
import { formatDate, formatMoney } from "@/lib/format";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Operations" };

export default async function OpsPage() {
  const [trips, vendors, schedule, disruptions, operators, copilotThread] =
    await Promise.all([
      getOperatorTrips(),
      getVendors(),
      getSchedule(3),
      getAllOpenDisruptions(),
      getOperators(),
      getCopilotThread(),
    ]);

  const { liveTrips, travellers, booked, atRisk } = operatorTotals(
    trips,
    schedule
  );

  return (
    <main
      data-scroll-theme="dark"
      className="min-h-screen bg-surface text-fg selection:bg-fg selection:text-bg"
    >
      <AppNav />

      <div className="max-w-[110rem] mx-auto px-5 sm:px-8 lg:px-12 pt-28 pb-24">
        <header className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <div className="flex items-center gap-4 flex-wrap mb-6">
              <span className="eyebrow !mb-0">
                · {operators[0]?.name ?? "Operations"} ·
              </span>
              {/* The board watches every group it lists, so a problem reported
                  from the field appears here without anyone refreshing. */}
              <LiveRefresh tripIds={trips.map((t) => t.id)} />
            </div>
            <h1 className="font-display text-display-lg font-semibold uppercase text-fg">
              Operations
            </h1>
          </div>

          <Link href="/plan" className="btn-solid px-6 py-3 text-xs tracking-wider">
            New trip
          </Link>
        </header>

        {/* Disruptions come first and nothing else moves above them. An operator
            opening this screen needs to know what is on fire before they know
            what the month is worth. Empty until the Day 4 injector runs. */}
        {disruptions.length > 0 && (
          <section className="mt-10 border border-accent p-6">
            <h2 className="font-display uppercase text-label tracking-label text-accent flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              {disruptions.length} open{" "}
              {disruptions.length === 1 ? "disruption" : "disruptions"}
            </h2>
            <ul className="mt-4 flex flex-col gap-3">
              {disruptions.map((d) => (
                <li
                  key={d.id}
                  className="flex flex-wrap items-baseline justify-between gap-3"
                >
                  <div>
                    <span className="font-display text-display-sm font-semibold uppercase text-fg">
                      {d.headline}
                    </span>
                    <span className="ml-3 font-sans text-xs uppercase tracking-wider text-muted">
                      {d.trips?.title} · {d.source} · {d.severity}
                    </span>
                  </div>
                  {d.root_item_id && (
                    <Link
                      href={`/ops/disruption/${d.id}`}
                      className="font-sans text-xs uppercase tracking-wider font-bold text-accent hover:text-fg transition-colors flex items-center gap-1"
                    >
                      Assess impact <ArrowUpRight className="w-3.5 h-3.5" />
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="mt-10 border-y border-line py-8">
          <dl className="grid grid-cols-2 lg:grid-cols-4 gap-x-8 gap-y-8">
            {[
              { label: "Live trips", value: String(liveTrips), note: `${travellers} travelers on the ground` },
              { label: "Booked value", value: formatMoney(booked), note: "across all groups" },
              { label: "Next 72 hours", value: String(schedule.length), note: "scheduled movements" },
              {
                label: "Flagged",
                value: String(atRisk),
                note: atRisk ? "need a decision" : "nothing at risk",
                flag: atRisk > 0,
              },
            ].map((stat) => (
              <div key={stat.label}>
                <dt className="font-display uppercase text-label tracking-label text-accent flex items-center gap-1.5">
                  {stat.flag && <AlertTriangle className="w-3.5 h-3.5" />}
                  {stat.label}
                </dt>
                <dd className="mt-2 font-display text-2xl sm:text-3xl font-semibold uppercase tracking-tight text-fg tabular-nums">
                  {stat.value}
                </dd>
                <dd className="mt-1 font-sans text-xs text-muted">{stat.note}</dd>
              </div>
            ))}
          </dl>
        </section>

        <div className="mt-14 grid grid-cols-1 xl:grid-cols-12 gap-12">
          <div className="xl:col-span-8">
            <ScheduleBoard entries={schedule} />
          </div>

          <div className="xl:col-span-4 flex flex-col gap-12">
            <section>
              <h2 className="font-display text-display-sm font-semibold uppercase text-fg">
                Groups
              </h2>
              <ul className="mt-5 flex flex-col gap-3">
                {trips.map((trip) => (
                  <li key={trip.id}>
                    <Link
                      href={`/trip/${trip.id}`}
                      className="surface p-4 flex items-start justify-between gap-4 hover:border-fg transition-colors group"
                    >
                      <div className="min-w-0">
                        <span className="font-display text-base font-semibold uppercase text-fg block">
                          {trip.contact_name ?? trip.title}
                        </span>
                        <span className="font-sans text-xs text-muted">
                          {trip.party_size} pax
                          {trip.starts_on && ` · from ${formatDate(trip.starts_on)}`}
                        </span>
                        {trip.coordinator_name && (
                          <span className="font-sans text-xs text-muted block mt-0.5">
                            Guide: {trip.coordinator_name}
                          </span>
                        )}
                      </div>
                      <span className="font-sans text-xs uppercase tracking-wider text-muted whitespace-nowrap group-hover:text-accent transition-colors">
                        {trip.status.replace(/_/g, " ")}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>

            <VendorTable vendors={vendors} />
          </div>
        </div>

        {trips[0] && <DemoControls tripId={trips[0].id} />}
      </div>

      {/* Read-only by construction: every tool behind this panel is a query. */}
      <Copilot initialThread={copilotThread} />
    </main>
  );
}
