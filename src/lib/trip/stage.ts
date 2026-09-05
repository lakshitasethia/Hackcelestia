import type { Booking, ItineraryItem, Review, Trip } from "@/lib/db/types";

/**
 * Where a trip is in its life, and what to do about it next.
 *
 * PS-7 prints the journey it wants represented:
 *
 *   Discover -> Personalize -> Plan -> Price -> Book -> Prepare
 *            -> Operate -> Assist -> Adapt -> Complete -> Review
 *
 * This is that sequence as one pure function, and it exists for two reasons.
 *
 * The first is the brief: an eleven-stage lifecycle you cannot see is a claim
 * rather than a feature, and a judge reading the screen should be able to tell
 * which stage a trip is in without being walked through it.
 *
 * The second is worse and more important. The actions in this product were
 * spread across five surfaces with no shared account of which one mattered
 * *now* — confirming lived on the build page, closing out did not exist, and
 * the only way to know that a draft needed confirming was to already know.
 * Anyone using it, including the person who wrote it, had to hold the workflow
 * in their head. One function that names the current stage and the single next
 * action is how that stops being true.
 *
 * Pure and dependency-free on purpose: it takes rows and returns a verdict, so
 * it can be unit-tested without a database and cannot drift between the three
 * surfaces that render it.
 */

export type StageId =
  | "discover"
  | "personalize"
  | "plan"
  | "price"
  | "book"
  | "prepare"
  | "operate"
  | "assist"
  | "adapt"
  | "complete"
  | "review";

/** The order the brief prints them in. Rendered left to right. */
export const STAGES: { id: StageId; label: string }[] = [
  { id: "discover", label: "Discover" },
  { id: "personalize", label: "Personalize" },
  { id: "plan", label: "Plan" },
  { id: "price", label: "Price" },
  { id: "book", label: "Book" },
  { id: "prepare", label: "Prepare" },
  { id: "operate", label: "Operate" },
  { id: "assist", label: "Assist" },
  { id: "adapt", label: "Adapt" },
  { id: "complete", label: "Complete" },
  { id: "review", label: "Review" },
];

export interface NextAction {
  /** Imperative and specific: "Confirm and book", never "Continue". */
  label: string;
  href: string;
  /** One sentence saying what pressing it does. */
  explain: string;
  /** True when this is the thing to do, false when it is merely available. */
  primary: boolean;
}

export interface TripStage {
  current: StageId;
  /** Everything strictly before `current` in STAGES, plus any it has passed. */
  done: StageId[];
  /** One line describing the state, in the second person. */
  headline: string;
  /** What to do now. Null when the trip is finished and nothing is owed. */
  next: NextAction | null;
  /** Why the obvious action is unavailable, when it is. */
  blocked: string | null;
}

export interface StageInput {
  trip: Trip;
  items: ItineraryItem[];
  bookings: Booking[];
  reviews: Review[];
  /** Open disruptions on this trip. Any at all means Adapt. */
  openDisruptions: number;
  /** Today, as YYYY-MM-DD in the trip's own zone. Injected so this stays pure
   *  and so a test can ask what happens the day after a trip ends. */
  today: string;
}

export function tripStage(input: StageInput): TripStage {
  const { trip, items, reviews, openDisruptions, today } = input;

  const live = items.filter(
    (i) => i.status !== "cancelled" && i.status !== "replaced"
  );
  const href = `/trip/${trip.id}`;

  const started = Boolean(trip.starts_on && trip.starts_on <= today);
  const ended = Boolean(trip.ends_on && trip.ends_on < today);
  const booked =
    trip.status === "confirmed" ||
    trip.status === "in_progress" ||
    trip.status === "completed";

  const upTo = (id: StageId): StageId[] => {
    const index = STAGES.findIndex((s) => s.id === id);
    return STAGES.slice(0, index).map((s) => s.id);
  };

  // Cancelled is not a stage in the brief and it is not a failure either. It
  // is simply the end, and it must not be shown as "Discover" because every
  // later test happened to be false.
  if (trip.status === "cancelled") {
    return {
      current: "complete",
      done: upTo("complete"),
      headline: "This trip was cancelled.",
      next: null,
      blocked: null,
    };
  }

  /* ---- the tail of the lifecycle, checked first because it is terminal ---- */

  if (trip.status === "completed") {
    const reviewed = reviews.length > 0;
    return {
      current: "review",
      done: reviewed ? STAGES.map((s) => s.id) : upTo("review"),
      headline: reviewed
        ? "Trip closed and reviewed. Thank you."
        : "This trip is finished. Tell us how it went.",
      next: reviewed
        ? {
            label: "See your review",
            href: `${href}/review`,
            explain: "Change a rating, or add one for a stop you skipped.",
            primary: false,
          }
        : {
            label: "Leave a review",
            href: `${href}/review`,
            explain:
              "Rate the trip and any stop on it. Your operator sees each rating against the vendor who ran it.",
            primary: true,
          },
      blocked: null,
    };
  }

  /* ---- Adapt outranks everything below it ---- */

  // Something is broken. Whatever else is true about this trip, the thing to
  // do is deal with that — which is the entire premise of the product.
  if (openDisruptions > 0) {
    return {
      current: "adapt",
      done: upTo("adapt"),
      headline:
        openDisruptions === 1
          ? "Something on this trip needs a decision."
          : `${openDisruptions} things on this trip need a decision.`,
      next: {
        label: "See what is affected",
        href: "/ops",
        explain:
          "Your operator is working out the impact and the options. You will see the itinerary change here when they settle it.",
        primary: true,
      },
      blocked: null,
    };
  }

  /* ---- the ordinary path ---- */

  if (live.length === 0) {
    return {
      current: "plan",
      done: upTo("plan"),
      headline: "Nothing is planned yet.",
      next: {
        label: "Add stops",
        href: `${href}/build`,
        explain:
          "Pick from the catalogue, or describe what you want and let the planner compose it.",
        primary: true,
      },
      blocked: null,
    };
  }

  if (!booked) {
    // Priced but not bought. This is the gate the whole product turns on, and
    // it was reachable only by typing a URL until the trip page linked to it.
    return {
      current: "book",
      done: upTo("book"),
      headline: "Your plan is ready. Nothing is booked yet.",
      next: {
        label: "Review and confirm",
        href: `${href}/build`,
        explain:
          "Confirming reserves every stop with its vendor, takes the seats, and puts the trip on your operator's board.",
        primary: true,
      },
      blocked: null,
    };
  }

  if (ended) {
    return {
      current: "complete",
      done: upTo("complete"),
      headline: "This trip has finished.",
      next: {
        label: "Close it out",
        href: `${href}/review`,
        explain:
          "Marks the trip complete and opens reviewing. Your operator can still see everything afterwards.",
        primary: true,
      },
      blocked: null,
    };
  }

  if (started) {
    return {
      current: "operate",
      done: upTo("operate"),
      headline: "You are on this trip now.",
      next: {
        label: "Ask the concierge",
        href,
        explain:
          "Anything you want changed, ask in the panel at the bottom right. You see the price before anything happens.",
        primary: false,
      },
      blocked: null,
    };
  }

  return {
    current: "prepare",
    done: upTo("prepare"),
    headline: trip.starts_on
      ? `Booked. You leave on ${trip.starts_on}.`
      : "Booked and ready.",
    next: {
      label: "Export your itinerary",
      href: `${href}/print`,
      explain:
        "A printable copy with every time, address and booking reference on it.",
      primary: false,
    },
    blocked: null,
  };
}
