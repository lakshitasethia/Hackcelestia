"use server";

import { revalidatePath } from "next/cache";
import { findOpenDisruptionFor, reportFieldState } from "@/lib/db/mutations";
import { injectDisruption } from "@/lib/disruption/engine";
import { notifyTrip } from "@/lib/realtime/notify";
import type { DisruptionSource, FieldState } from "@/lib/db/types";

/**
 * What the guide on the ground can do.
 *
 * Two verbs, and the difference between them is the point of the surface.
 * Reporting a stop is bookkeeping. Flagging one is an *escalation*: it opens a
 * real disruption against the live itinerary, which means the operator's board
 * lights up and the re-planner has something to reason about — the same object
 * the storm scenario produces, arriving from a person instead of the weather.
 */

async function refresh(tripId: string): Promise<void> {
  revalidatePath(`/field/${tripId}`);
  revalidatePath(`/trip/${tripId}`);
  revalidatePath("/ops");
}

export async function reportStopAction(formData: FormData): Promise<void> {
  const itemId = String(formData.get("itemId"));
  const state = String(formData.get("state")) as FieldState;

  const { tripId, title } = await reportFieldState(itemId, state);

  await refresh(tripId);
  await notifyTrip(tripId, "field_report", { item: title, state });
}

const CAUSES: DisruptionSource[] = ["weather", "transport", "vendor", "manual"];

export async function flagStopAction(formData: FormData): Promise<void> {
  const itemId = String(formData.get("itemId"));
  const note = String(formData.get("note") ?? "").trim();

  // Validated against the list rather than cast, because this value reaches a
  // CHECK constraint and decides which replacements the engine will consider.
  const submitted = String(formData.get("cause") ?? "") as DisruptionSource;
  const cause = CAUSES.includes(submitted) ? submitted : "vendor";

  const { tripId, title } = await reportFieldState(itemId, "issue", note);

  // Flagging the same stop twice should add detail, not a second identical
  // disruption for the operator to triage — the note above has already landed.
  const existing = await findOpenDisruptionFor(itemId);
  if (!existing) {
    await injectDisruption({
      tripId,
      rootItemId: itemId,
      source: cause,
      severity: "high",
      headline: `Flagged on the ground — ${title}`,
      payload: {
        reported_by: "coordinator",
        // Named for the cause so the assessment page and the agent's brief read
        // it the same way a seeded scenario's payload does.
        ...(cause === "weather"
          ? { condition: note || "Reported unsafe by the guide." }
          : { vendor_message: note || "No detail given." }),
      },
    });
  }

  await refresh(tripId);
  await notifyTrip(tripId, existing ? "field_report" : "disruption_opened", {
    item: title,
  });
}
