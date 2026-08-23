import { Bot, User } from "lucide-react";
import type { Vendor } from "@/lib/db/types";

/**
 * `channel` is the column that matters operationally: an `auto` vendor can be
 * renegotiated by the comms agent without waking anybody, a `manual` one always
 * needs a person. It decides how much of a re-plan can happen unattended.
 */
export default function VendorTable({ vendors }: { vendors: Vendor[] }) {
  return (
    <section>
      <h2 className="font-display text-display-sm font-semibold uppercase text-fg">
        Vendors
      </h2>
      <p className="mt-2 font-sans text-xs uppercase tracking-wider text-muted">
        {vendors.filter((v) => v.channel === "auto").length} of {vendors.length}{" "}
        reachable automatically
      </p>

      <ul className="mt-5 flex flex-col">
        {vendors.map((vendor) => (
          <li
            key={vendor.id}
            className="flex items-start justify-between gap-3 py-3 border-b border-line"
          >
            <div className="min-w-0">
              <span className="block font-sans font-medium text-fg truncate">
                {vendor.name}
              </span>
              <span className="font-sans text-xs uppercase tracking-wider text-muted">
                {vendor.type}
              </span>
            </div>
            <div className="text-right shrink-0">
              <span
                className="flex items-center gap-1 font-sans text-xs uppercase tracking-wider text-muted"
                title={
                  vendor.channel === "auto"
                    ? "The comms agent can rebook this vendor directly"
                    : "Changes need an operator to confirm"
                }
              >
                {vendor.channel === "auto" ? (
                  <Bot className="w-3 h-3" />
                ) : (
                  <User className="w-3 h-3" />
                )}
                {vendor.channel}
              </span>
              <span className="font-sans text-xs text-muted tabular-nums">
                {Math.round(Number(vendor.reliability) * 100)}% reliable
              </span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
