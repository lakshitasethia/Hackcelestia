"use server";

import { revalidatePath } from "next/cache";
import { recordPayment } from "@/lib/db/mutations";
import { assertTripAccess } from "@/lib/auth/guard";

/**
 * Record money that moved.
 *
 * Operator-only, and enforced here rather than by hiding the form. The panel
 * does hide it from travelers, but a hidden form is a decoration — the check
 * that matters is this one, because the action is reachable by anyone who can
 * post to it.
 */
export async function recordPaymentAction(formData: FormData): Promise<void> {
  const tripId = String(formData.get("tripId"));
  const { viewer } = await assertTripAccess(tripId);

  if (viewer.role !== "operator") {
    throw new Error("Only the operator can record a payment.");
  }

  const amount = Number(formData.get("amount") || 0);
  if (!(amount > 0)) throw new Error("Enter an amount.");

  await recordPayment({
    tripId,
    kind: String(formData.get("kind") || "deposit") as
      | "deposit"
      | "balance"
      | "refund"
      | "adjustment",
    amount,
    method: String(formData.get("method") || "bank_transfer") as
      | "bank_transfer"
      | "card"
      | "cash"
      | "upi"
      | "other",
    reference: String(formData.get("reference") || "").trim() || null,
    note: String(formData.get("note") || "").trim() || null,
    recordedBy: viewer.id,
  });

  revalidatePath(`/trip/${tripId}`);
  revalidatePath("/ops");
}
