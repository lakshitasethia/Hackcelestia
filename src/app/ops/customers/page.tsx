import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Mail, Phone } from "lucide-react";
import AppNav from "@/components/layout/AppNav";
import { getCustomers } from "@/lib/db/queries";
import { formatDate, formatMoney } from "@/lib/format";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Customers" };

/**
 * Who this operator has travelling with them, and what each of them is worth.
 *
 * "Customers" is the first item in PS-7's list of what an operator manages
 * centrally, and the board had no such view: a customer existed only as a name
 * on a trip, so the same person booking twice was two unrelated rows and there
 * was no screen that could tell you otherwise.
 *
 * Grouped by contact email, which is the honest key — see `getCustomers`.
 */
export default async function CustomersPage() {
  const customers = await getCustomers();

  const repeat = customers.filter((c) => c.trips.length > 1).length;
  const value = customers.reduce((sum, c) => sum + c.lifetimeValue, 0);

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

        <span className="eyebrow mt-8">· Customers ·</span>
        <h1 className="font-display text-display-lg font-semibold uppercase text-fg">
          Everyone travelling
        </h1>

        <section className="mt-10 border-y border-line py-8">
          <dl className="grid grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-8">
            {[
              { label: "Customers", value: String(customers.length), note: "on the books" },
              {
                label: "Repeat",
                value: String(repeat),
                note: repeat ? "have booked more than once" : "nobody has rebooked yet",
              },
              {
                label: "Lifetime value",
                value: formatMoney(value),
                note: "across every live trip",
              },
            ].map((stat) => (
              <div key={stat.label}>
                <dt className="font-display uppercase text-label tracking-label text-accent">
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

        {customers.length === 0 ? (
          <p className="mt-12 text-body-lg text-muted">
            No trips on the board yet, so nobody to show.
          </p>
        ) : (
          <ul className="mt-12 flex flex-col gap-4">
            {customers.map((customer) => (
              <li key={customer.key} className="surface p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h2 className="font-display text-lg font-semibold uppercase text-fg">
                      {customer.name}
                    </h2>
                    <p className="mt-1 flex flex-wrap items-center gap-4 font-sans text-xs text-muted">
                      {customer.email && (
                        <span className="flex items-center gap-1.5">
                          <Mail className="w-3 h-3" />
                          {customer.email}
                        </span>
                      )}
                      {customer.phone && (
                        <span className="flex items-center gap-1.5">
                          <Phone className="w-3 h-3" />
                          {customer.phone}
                        </span>
                      )}
                      <span>
                        {customer.travellers}{" "}
                        {customer.travellers === 1 ? "traveler" : "travelers"}
                      </span>
                    </p>
                  </div>

                  <div className="text-right shrink-0">
                    <span className="font-display text-lg font-semibold text-fg tabular-nums block">
                      {formatMoney(customer.lifetimeValue)}
                    </span>
                    <span className="font-sans text-xs uppercase tracking-wider text-muted">
                      {customer.trips.length}{" "}
                      {customer.trips.length === 1 ? "trip" : "trips"}
                    </span>
                  </div>
                </div>

                <ul className="mt-4 pt-4 border-t border-line flex flex-col gap-2">
                  {customer.trips.map((trip) => (
                    <li key={trip.id}>
                      <Link
                        href={`/trip/${trip.id}`}
                        className="flex flex-wrap items-baseline justify-between gap-3 font-sans text-sm text-muted hover:text-fg transition-colors"
                      >
                        <span>
                          {trip.title}
                          {trip.starts_on && (
                            <span className="text-xs ml-3">
                              from {formatDate(trip.starts_on, trip.time_zone)}
                            </span>
                          )}
                        </span>
                        <span className="text-xs uppercase tracking-wider">
                          {trip.status.replace(/_/g, " ")}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
