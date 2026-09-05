import { Banknote } from "lucide-react";
import type { PaymentSummary } from "@/lib/db/queries";
import { formatDate, formatMoney } from "@/lib/format";
import { recordPaymentAction } from "@/app/trip/[id]/payments/actions";

const KIND_LABEL: Record<string, string> = {
  deposit: "Deposit",
  balance: "Balance",
  refund: "Refund",
  adjustment: "Adjustment",
};

/**
 * What this trip costs, what has been paid, and what is left.
 *
 * PS-7 lists payments among the things an operator manages centrally, and this
 * is that — a ledger, honestly labelled. No card is charged anywhere in this
 * codebase; an operator records money that moved and everyone sees the same
 * balance. Pretending otherwise with a fake checkout would be the worse
 * version of this feature.
 *
 * The recording form renders only for an operator. A traveler sees the same
 * numbers and cannot write to them, which is the correct asymmetry: the
 * traveler is the one being told, not the one keeping the book.
 */
export default function PaymentPanel({
  tripId,
  summary,
  currency,
  timeZone,
  canRecord,
}: {
  tripId: string;
  summary: PaymentSummary;
  currency: string;
  timeZone: string;
  /** True for the operator running this trip. */
  canRecord: boolean;
}) {
  const settled = summary.outstanding <= 0;
  const overpaid = summary.outstanding < 0;

  const field =
    "bg-transparent border border-line px-3 py-2 text-fg font-sans text-xs focus:outline-none focus:border-fg transition-colors";

  return (
    <section className="border border-line">
      <header className="flex items-center gap-2 px-5 sm:px-6 py-4 border-b border-line">
        <Banknote className="w-4 h-4 text-accent" />
        <h2 className="font-display uppercase text-label tracking-label text-fg">
          Payments
        </h2>
      </header>

      <div className="px-5 sm:px-6 py-6">
        <dl className="grid grid-cols-2 lg:grid-cols-4 gap-x-8 gap-y-6">
          {[
            {
              label: "Trip cost",
              value: formatMoney(summary.due, currency),
              note: "everything currently booked",
            },
            {
              label: "Paid",
              value: formatMoney(summary.paid, currency),
              note:
                summary.refunded > 0
                  ? `after ${formatMoney(summary.refunded, currency)} refunded`
                  : "received to date",
            },
            {
              label: overpaid ? "Owed back" : "Outstanding",
              value: formatMoney(Math.abs(summary.outstanding), currency),
              note: settled
                ? overpaid
                  ? "refund due to the traveler"
                  : "settled in full"
                : "still to pay",
              flag: !settled,
            },
            {
              label: "Cancel today",
              value: formatMoney(summary.penaltyIfCancelled, currency),
              note: "non-refundable if cancelled now",
            },
          ].map((stat) => (
            <div key={stat.label}>
              <dt className="font-display uppercase text-label tracking-label text-accent">
                {stat.label}
              </dt>
              <dd
                className={`mt-2 font-display text-xl sm:text-2xl font-semibold uppercase tracking-tight tabular-nums ${
                  stat.flag ? "text-accent" : "text-fg"
                }`}
              >
                {stat.value}
              </dd>
              <dd className="mt-1 font-sans text-xs text-muted">{stat.note}</dd>
            </div>
          ))}
        </dl>

        {summary.payments.length > 0 && (
          <ul className="mt-8 flex flex-col divide-y divide-line border-t border-line">
            {summary.payments.map((payment) => (
              <li
                key={payment.id}
                className="flex flex-wrap items-baseline justify-between gap-3 py-3"
              >
                <div className="min-w-0">
                  <span className="font-sans text-xs uppercase tracking-wider text-fg font-bold">
                    {KIND_LABEL[payment.kind] ?? payment.kind}
                  </span>
                  <span className="ml-3 font-sans text-xs text-muted">
                    {formatDate(payment.created_at, timeZone)} ·{" "}
                    {payment.method.replace(/_/g, " ")}
                    {payment.reference && ` · ${payment.reference}`}
                  </span>
                  {payment.note && (
                    <p className="font-sans text-xs text-muted mt-0.5">
                      {payment.note}
                    </p>
                  )}
                </div>
                <span
                  className={`font-display font-semibold tabular-nums ${
                    payment.kind === "refund" ? "text-accent" : "text-fg"
                  }`}
                >
                  {payment.kind === "refund" ? "−" : "+"}
                  {formatMoney(Number(payment.amount), payment.currency)}
                </span>
              </li>
            ))}
          </ul>
        )}

        {summary.payments.length === 0 && (
          <p className="mt-6 font-sans text-sm text-muted">
            Nothing recorded against this trip yet.
          </p>
        )}

        {canRecord && (
          <form
            action={recordPaymentAction}
            className="mt-8 pt-6 border-t border-line flex flex-wrap items-end gap-3"
          >
            <input type="hidden" name="tripId" value={tripId} />

            <div>
              <label
                htmlFor="kind"
                className="font-display uppercase text-label tracking-label text-accent block mb-2"
              >
                Record
              </label>
              <select id="kind" name="kind" defaultValue="deposit" className={field}>
                <option value="deposit">Deposit</option>
                <option value="balance">Balance</option>
                <option value="refund">Refund</option>
                <option value="adjustment">Adjustment</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="amount"
                className="font-display uppercase text-label tracking-label text-accent block mb-2"
              >
                Amount ({currency})
              </label>
              <input
                id="amount"
                name="amount"
                type="number"
                min={1}
                step="0.01"
                required
                // Pre-filled with what is actually owed. The overwhelmingly
                // common case is "they paid the balance", and typing a figure
                // that is on the screen above is how a typo gets in.
                defaultValue={
                  summary.outstanding > 0 ? summary.outstanding : undefined
                }
                className={field}
              />
            </div>

            <div>
              <label
                htmlFor="method"
                className="font-display uppercase text-label tracking-label text-accent block mb-2"
              >
                How
              </label>
              <select
                id="method"
                name="method"
                defaultValue="bank_transfer"
                className={field}
              >
                <option value="bank_transfer">Bank transfer</option>
                <option value="upi">UPI</option>
                <option value="card">Card</option>
                <option value="cash">Cash</option>
                <option value="other">Other</option>
              </select>
            </div>

            <div className="flex-1 min-w-[10rem]">
              <label
                htmlFor="reference"
                className="font-display uppercase text-label tracking-label text-accent block mb-2"
              >
                Reference
              </label>
              <input
                id="reference"
                name="reference"
                placeholder="UTR / receipt no."
                className={`${field} w-full`}
              />
            </div>

            <button
              type="submit"
              className="btn-solid px-5 py-2.5 text-xs tracking-wider"
            >
              Record
            </button>
          </form>
        )}
      </div>
    </section>
  );
}
