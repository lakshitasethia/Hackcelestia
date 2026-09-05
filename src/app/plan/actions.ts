"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createTrip } from "@/lib/db/mutations";
import { getViewer } from "@/lib/auth/session";
import { extractTripSpec, type TripSpec } from "@/lib/agent/intake";
import {
  planItinerary,
  commitItinerary,
  type ComposeResult,
} from "@/lib/agent/compose";
import { researchTrip, type ResearchResult } from "@/lib/agent/research";
import { ingestResearch } from "@/lib/agent/catalogue";
import { createAdminClient } from "@/lib/supabase/admin";
import type { TripPrefs } from "@/lib/db/types";

/**
 * Read a description and hand back a spec for the form to display.
 *
 * Deliberately returns rather than writes. The trip is still created by the
 * form below it, from values the traveler has seen.
 *
 * It returns its failures rather than throwing them, which matters more than
 * it looks. React replaces the message of anything thrown out of a server
 * action in a production build — deliberately, so a stack trace cannot leak —
 * so a thrown error reaches the browser as "An error occurred in the Server
 * Components render", and the user is told nothing at all. A returned failure
 * keeps the sentence that explains what to do about it.
 */
export type IntakeResult =
  | { ok: true; spec: TripSpec }
  | { ok: false; error: string };

export async function readDescriptionAction(
  description: string
): Promise<IntakeResult> {
  try {
    const viewer = await getViewer();
    return { ok: true, spec: await extractTripSpec(description, viewer?.id) };
  } catch (cause) {
    return {
      ok: false,
      error: cause instanceof Error ? cause.message : "That did not work.",
    };
  }
}

export async function createTripAction(formData: FormData): Promise<void> {
  /**
   * Read the viewer before anything else. A trip created with a null
   * `traveler_id` is invisible to the person who just filled in the form —
   * `trips_read` matches on `traveler_id = auth.uid()`, and null matches
   * nobody. The route is behind the middleware guard, so this is belt and
   * braces, but the failure it prevents is silent.
   */
  const viewer = await getViewer();
  if (!viewer) throw new Error("Sign in before planning a trip.");

  const title = String(formData.get("title") || "").trim();
  const contactName = String(formData.get("contactName") || "").trim();
  const startsOn = String(formData.get("startsOn") || "");
  const endsOn = String(formData.get("endsOn") || "");

  if (!title || !contactName || !startsOn || !endsOn) {
    throw new Error("Trip name, traveler name and both dates are required.");
  }
  if (endsOn < startsOn) {
    throw new Error("The end date cannot be before the start date.");
  }

  const budgetRaw = String(formData.get("budget") || "").trim();
  const prefs: TripPrefs = {
    // getAll, because interests is a checkbox group — get() would silently keep
    // only the first one and quietly narrow the trip.
    interests: formData.getAll("interests").map(String).filter(Boolean),
    pace: (String(formData.get("pace") || "relaxed") as TripPrefs["pace"]),
    dietary: String(formData.get("dietary") || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    mobility: String(formData.get("mobility") || "").trim() || undefined,
    style: String(formData.get("style") || "").trim() || undefined,
  };

  const tripId = await createTrip({
    title,
    contactName,
    contactEmail: String(formData.get("contactEmail") || "").trim() || undefined,
    partySize: Math.max(1, Number(formData.get("partySize") || 1)),
    budget: budgetRaw ? Number(budgetRaw) : null,
    startsOn,
    endsOn,
    prefs,
    operatorId: String(formData.get("operatorId") || "") || null,
    travelerId: viewer.id,
  });

  revalidatePath("/ops");
  revalidatePath("/app");
  redirect(`/trip/${tripId}/build`);
}


/**
 * One sentence in, a researched proposal out.
 *
 * This replaces `planTripAction`, which did two things wrong. It could only
 * plan destinations that were already seeded in the catalogue — ask it for
 * Switzerland and it answered "None of those places are in the catalogue yet" —
 * and it wrote the whole itinerary into the database before showing anyone,
 * so the traveler was never actually asked whether the plan was any good.
 *
 * The shape now is: read the sentence, go and research the place on the web,
 * put what was found in the catalogue, compose a plan out of it, and stop.
 * Nothing about the trip exists yet. `acceptProposalAction` is what makes it
 * real, and a person is the only thing that calls it.
 */
export type ProposeResult =
  | {
      ok: true;
      proposalId: string;
      spec: TripSpec;
      plan: ComposeResult;
      research: ResearchResult;
    }
  | { ok: false; error: string };

export async function proposeTripAction(description: string): Promise<ProposeResult> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: "Sign in before planning a trip." };

  try {
    const spec = await extractTripSpec(description, viewer.id);

    if (!spec.startsOn || !spec.endsOn) {
      return {
        ok: false,
        error: "I need the dates — tell me when you arrive and when you leave.",
      };
    }
    if (!spec.destinations.length) {
      return { ok: false, error: "Tell me where you want to go and I will plan it." };
    }

    // The web pass. Everything after this is the same solver that has always
    // been here, working from a catalogue that now contains the destination.
    const research = await researchTrip(spec, viewer.id);
    await ingestResearch(research);

    const plan = await planItinerary(spec, {
      cityHint: research.cities,
      timeZone: research.timeZone,
      currency: research.currency,
      fxToBudget: research.fxToBudget,
    });

    // Stored server-side rather than round-tripped through the browser: the
    // accept step must build the trip from the plan that was actually shown,
    // and a plan posted back from a form is a plan the client could have edited.
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("trip_proposals")
      .insert({
        traveler_id: viewer.id,
        description,
        spec: spec as never,
        research: research as never,
        plan: plan as never,
      })
      .select("id")
      .single();

    if (error) throw new Error(error.message);

    return {
      ok: true,
      proposalId: (data as { id: string }).id,
      spec,
      plan,
      research,
    };
  } catch (cause) {
    return {
      ok: false,
      error: cause instanceof Error ? cause.message : "That did not work.",
    };
  }
}

/**
 * "Yes, build it."
 *
 * The only thing in this codebase that turns a proposal into a trip, and it is
 * reachable only from a button. It re-reads the proposal from the database
 * rather than trusting anything the browser sends, so what gets built is what
 * was shown.
 *
 * The trip it creates is still a `draft`: composing writes `itinerary_items`,
 * but nothing is booked, no `availability` moves, and every researched row is
 * against a manual vendor. Confirming the *booking* is a second, separate
 * button on the trip page. Two gates, and they mean different things — this one
 * is "the plan is right", that one is "go and spend my money".
 */
export type AcceptResult =
  | { ok: true; tripId: string }
  | { ok: false; error: string };

export async function acceptProposalAction(proposalId: string): Promise<AcceptResult> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: "Sign in before planning a trip." };

  const supabase = createAdminClient();

  try {
    const { data: row, error } = await supabase
      .from("trip_proposals")
      .select("id, traveler_id, spec, plan, state, trip_id")
      .eq("id", proposalId)
      .single();

    if (error || !row) return { ok: false, error: "That proposal has gone." };

    const proposal = row as unknown as {
      traveler_id: string | null;
      spec: TripSpec;
      plan: ComposeResult;
      state: string;
      trip_id: string | null;
    };

    // The admin client bypasses RLS, so the ownership check that the policy
    // would have made has to be made here instead.
    if (proposal.traveler_id !== viewer.id) {
      return { ok: false, error: "That proposal is not yours." };
    }
    // Accepting twice would build the same trip twice. Send them to the one
    // they already have.
    if (proposal.state === "accepted" && proposal.trip_id) {
      return { ok: true, tripId: proposal.trip_id };
    }

    const { spec, plan } = proposal;

    const tripId = await createTrip({
      title: spec.title || `${plan.cities.slice(0, 3).join(", ")} and back`,
      contactName: viewer.fullName || viewer.email || "Traveler",
      contactEmail: viewer.email ?? undefined,
      partySize: spec.partySize ?? 1,
      budget: spec.budget,
      startsOn: spec.startsOn!,
      endsOn: spec.endsOn!,
      prefs: {
        interests: spec.interests,
        pace: spec.pace ?? "moderate",
        dietary: spec.dietary,
        mobility: spec.mobility ?? undefined,
        style: spec.style ?? undefined,
      },
      travelerId: viewer.id,
    });

    await commitItinerary(tripId, plan, spec);

    await supabase
      .from("trip_proposals")
      .update({ state: "accepted", trip_id: tripId })
      .eq("id", proposalId);

    revalidatePath("/ops");
    revalidatePath("/app");
    return { ok: true, tripId };
  } catch (cause) {
    return {
      ok: false,
      error: cause instanceof Error ? cause.message : "That did not work.",
    };
  }
}

/** "No, start again." Keeps the row so the description is not lost. */
export async function discardProposalAction(proposalId: string): Promise<void> {
  const viewer = await getViewer();
  if (!viewer) return;

  await createAdminClient()
    .from("trip_proposals")
    .update({ state: "discarded" })
    .eq("id", proposalId)
    .eq("traveler_id", viewer.id);
}
