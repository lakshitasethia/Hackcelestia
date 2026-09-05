import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { addItems } from "@/lib/db/mutations";
import {
  SPINE,
  TRANSIT_ONLY,
  loadLegGraph,
  servedCities,
  type Leg,
  type LegGraph,
} from "./corridor";
import { ensureAvailability, samePlace } from "./catalogue";
import type { TripSpec } from "./intake";

/**
 * The composer — a spec in, a whole itinerary out.
 *
 * This is the piece the README admitted was missing: `/plan` collected
 * preferences and then handed the traveler a 40-row catalogue to assemble by
 * hand, which is not what "suggest me an itinerary" means to anyone who typed
 * it.
 *
 * It follows the same rule as the rest of the project: **feasibility is a
 * solver, not the model.** Routing walks a real leg graph, day allocation is
 * arithmetic, and every cost is summed from catalogue rows. Nothing here asks
 * a model whether a plan fits. What the model does — in `narrate`, and only
 * after the plan exists — is explain the days and name the compromises.
 *
 * The stops are written through `addItem` in chronological order, which is
 * what makes the result a graph rather than a list: `chainInto` hangs each new
 * stop off the previous one, so the disruption engine, the blast radius and
 * the re-planner all work on a composed trip exactly as they do on the seeded
 * one, with no extra code.
 *
 * ## Planning and committing are two functions
 *
 * They used to be one, and that is what made the confirmation step impossible:
 * `composeItinerary` wrote `itinerary_items` as it went, so by the time the
 * traveler saw the plan it *was* the plan, and "is this itinerary OK?" was a
 * question about something already in the database. `planItinerary` now
 * decides everything and writes nothing; `commitItinerary` writes what was
 * decided. A person presses a button in between.
 *
 * Nothing about the solver changed in the split. The plan is the same plan —
 * it just exists as a value for a while before it exists as rows.
 */

/** Fallback zone for a plan whose catalogue rows carry none. */
export const DEFAULT_TZ = "UTC";

/** Non-hotel, non-transport stops in a single day. Four is a day nobody enjoys. */
const MAX_ACTIVITIES_PER_DAY = 3;

type Item = {
  id: string;
  title: string;
  type: string;
  description: string | null;
  duration_min: number;
  base_cost: number;
  opens_at: string | null;
  tags: string[];
  city: string | null;
  time_zone: string | null;
  tier: string | null;
};

export type ComposedStop = {
  inventoryId: string;
  day: number;
  localTime: string;
  title: string;
  cost: number;
  city: string;
  /** The must-do phrase this stop exists to satisfy, if any. */
  satisfies?: string;
};

export type ComposeResult = {
  stops: ComposedStop[];
  cities: string[];
  /**
   * Where each day actually happens, by day number.
   *
   * Not derivable from the stops, which is why it is carried. A travel day's
   * first stop is the train, and a train's `city` is where it *leaves* from —
   * so a day that starts in Zurich and spends the afternoon in Lucerne reads
   * as "Zurich" to anything that looks at the first stop, which is the wrong
   * answer to "where am I on Tuesday".
   */
  cityByDay: Record<number, string>;
  /** IANA zone the local times above are written in. Carried on the result
   *  rather than looked up again at commit time, so the instants that get
   *  stored are the ones the traveler was shown. */
  timeZone: string;
  dayCount: number;
  /** Summed from the catalogue rows, so it is in `currency`. */
  total: number;
  /** What the plan is priced in — the destination's money, not the traveler's. */
  currency: string;
  /** The traveler's budget, in `budgetCurrency`. */
  budget: number | null;
  budgetCurrency: string;
  /** `total` converted into `budgetCurrency`; null when no rate was found. */
  totalInBudget: number | null;
  /**
   * The budget expressed in `currency`, so the trip can be denominated in one
   * money throughout.
   *
   * A composed trip stores its items in the destination's currency, so a trip
   * carrying a rupee budget and a franc price list renders "under budget by CHF
   * 398,078 of CHF 400,000" — rupees wearing a franc sign, and an answer off by
   * a factor of a hundred. Null when there was no rate to convert with, which
   * the trip then treats as no budget rather than a wrong one.
   */
  budgetInPlanCurrency: number | null;
  /** Places they named that the catalogue cannot serve at all. */
  unservedDestinations: string[];
  /** Must-dos nothing in the catalogue matched. */
  unmetMustDo: string[];
  /** Everything the traveler should be told before they look at the plan. */
  warnings: string[];
};

/* ------------------------------------------------------------------ match -- */

const STOPWORDS = new Set([
  "in", "at", "the", "a", "an", "and", "to", "for", "of", "on", "do", "go",
  "i", "want", "we", "my", "me", "those", "some", "compulsorily", "include",
  "everything", "live", "stay", "visit", "see", "with", "is", "it", "be",
]);

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

/** How well a catalogue row answers a phrase. Token overlap over title,
 *  description, tags and town — deliberately blunt, because the alternative is
 *  a second model call to decide whether "tents" means the camp in Chopta. */
function score(item: Item, phrase: string): number {
  const hay = new Set(
    tokens(`${item.title} ${item.description ?? ""} ${item.tags.join(" ")} ${item.city ?? ""}`)
  );
  const want = tokens(phrase);
  if (!want.length) return 0;
  let hits = 0;
  for (const t of want) {
    if (hay.has(t)) hits += 1;
    // "rafting" should find "white-water rafting"; "trek" should find "trekking".
    else if ([...hay].some((h) => h.startsWith(t) || t.startsWith(h))) hits += 0.5;
  }
  return hits / want.length;
}

function matchCity(requested: string, cities: string[]): string | null {
  const want = requested.trim().toLowerCase();
  return (
    cities.find((c) => c.toLowerCase() === want) ??
    cities.find((c) => c.toLowerCase().startsWith(want.slice(0, 4))) ??
    null
  );
}

/* ------------------------------------------------------------------ plan --- */

type DayPlan = { day: number; city: string; legs: Leg[]; items: Item[] };

/**
 * Walk the corridor with a given number of activity days per town and see how
 * many calendar days it costs. Travel days fall out of the walk rather than
 * being budgeted for: two towns either side of a mountain range cost what they
 * cost, and the only honest way to know is to lay the legs down and count.
 */
function simulate(
  graph: LegGraph,
  cities: string[],
  nights: Map<string, number>,
  /** Where the trip has to end. A one-way plan that abandons someone in Auli
   *  on the last morning is not a plan, and the legs home cost a real day. */
  returnTo?: string
): DayPlan[] {
  const plans = new Map<number, DayPlan>();
  const activityDays = new Set<number>();
  let day = 1;

  const at = (d: number, city: string): DayPlan => {
    const existing = plans.get(d);
    if (existing) return existing;
    const fresh: DayPlan = { day: d, city, legs: [], items: [] };
    plans.set(d, fresh);
    return fresh;
  };

  cities.forEach((city, i) => {
    const stayDays = nights.get(city) ?? 1;
    for (let n = 0; n < stayDays; n++) {
      at(day, city).city = city;
      activityDays.add(day);
      if (n < stayDays - 1) day++;
    }

    const next = cities[i + 1] ?? (returnTo && returnTo !== city ? returnTo : null);
    if (!next) return;

    for (const leg of graph.route(city, next)) {
      if (leg.overnight) {
        at(day, city).legs.push(leg);
        day++;
      } else {
        if (activityDays.has(day)) day++;
        const plan = at(day, leg.to);
        plan.legs.push(leg);
        plan.city = leg.to;
      }
    }
  });

  return [...plans.values()].sort((a, b) => a.day - b.day);
}

export type PlanOptions = {
  /**
   * Towns to build the trip out of, in travelling order — the research pass's
   * answer to "where should these thirteen days actually go".
   *
   * When it is present the composer trusts it for *which* towns and *what
   * order*, because a traveler who typed "Switzerland" named a country and the
   * catalogue holds towns; there is nothing to resolve their words against.
   * Everything after that — how many days each town earns, what fits in one,
   * whether the whole thing fits at all — is still the solver's, unchanged.
   *
   * Absent, the composer works the way it always did: match what they typed
   * against the catalogue and order it along the seeded corridor.
   */
  cityHint?: readonly string[];
  /** IANA zone for the local times in the result. */
  timeZone?: string;
  /** What the catalogue rows for this trip are priced in. Defaults to the
   *  traveler's own currency, which is right for a single-country trip and
   *  wrong for every other one. */
  currency?: string;
  /** Multiply a `currency` amount by this to get the traveler's currency. */
  fxToBudget?: number | null;
};

/**
 * Decide the whole itinerary. Writes nothing.
 *
 * The counterpart is `commitItinerary`, and the gap between them is where the
 * traveler says yes.
 */
export async function planItinerary(
  spec: TripSpec,
  options: PlanOptions = {}
): Promise<ComposeResult> {
  const supabase = createAdminClient();

  const hint = [...new Set(options.cityHint ?? [])].filter(Boolean);

  /**
   * Scope the catalogue read to the towns actually in play.
   *
   * This filter used to be `SERVED_CITIES` — a constant derived from nine
   * hard-coded Indian legs, and the single line that made every destination
   * outside north India impossible. Now it is either the towns research chose,
   * or, for a plan with no research behind it, everything the catalogue holds.
   * A catalogue that grows with every trip planned makes the unscoped read
   * worth avoiding when we can.
   */
  const query = supabase
    .from("inventory")
    .select("id, title, type, description, duration_min, base_cost, opens_at, tags, city, time_zone, tier")
    .not("city", "is", null);

  const { data, error } = await (hint.length ? query.in("city", hint) : query);
  if (error) throw new Error(`planItinerary: ${error.message}`);

  const catalogue = (data ?? []) as unknown as Item[];
  const cityNames = [...new Set(catalogue.map((i) => i.city!).filter(Boolean))];

  /* ---- which towns is this trip made of? ---- */

  const unservedDestinations: string[] = [];
  let cities: string[];

  if (hint.length) {
    // Research already decided, and it decided in travelling order. Keep only
    // the towns something actually came back for: a hint city with an empty
    // catalogue is a day with nothing in it.
    cities = hint.filter((c) => cityNames.includes(c) && !TRANSIT_ONLY.has(c));
    if (!cities.length) {
      throw new Error(
        "The research came back with towns but nothing to put in them. " +
          "Try again, or name the places you want directly."
      );
    }
  } else {
    const resolved: string[] = [];
    for (const requested of spec.destinations) {
      const city = matchCity(requested, cityNames);
      if (city && !TRANSIT_ONLY.has(city)) resolved.push(city);
      else unservedDestinations.push(requested);
    }
    if (!resolved.length) {
      const served = await servedCities();
      throw new Error(
        `Nothing in the catalogue matches those places yet. Planning from ` +
          `scratch will research them; the places already stocked are ` +
          `${served.join(", ")}.`
      );
    }
    cities = [...new Set(resolved)];
  }

  const graph = await loadLegGraph(cities);
  // The hint is the geographic running order for a researched trip; SPINE is
  // the one for the seeded corridor. Either way the ordering rule is the same.
  cities = graph.order(cities, hint.length ? hint : SPINE);

  /**
   * The zone the itinerary is read in.
   *
   * Was the module constant `INDIA_TZ`, stamped on every trip this composer
   * ever produced — which was true of the only region it could plan and false
   * the moment it could plan a second. Researched rows carry their own zone,
   * so take it from the catalogue and fall back rather than assume.
   */
  const timeZone =
    options.timeZone ??
    catalogue.find((i) => cities.includes(i.city ?? "") && i.time_zone)?.time_zone ??
    DEFAULT_TZ;

  const currency = options.currency ?? spec.currency;
  const fx = options.fxToBudget ?? null;

  /* ---- how many days do we have, and how do they divide? ---- */

  const dayBudget =
    spec.startsOn && spec.endsOn
      ? Math.max(
          1,
          Math.round(
            (Date.parse(spec.endsOn) - Date.parse(spec.startsOn)) / 86_400_000
          ) + 1
        )
      : cities.length + 2;

  // Rank each town's stops once: the must-dos it answers first, then how well
  // it matches the stated interests. Used both to allocate days and to fill them.
  const interests = new Set(spec.interests);

  /**
   * Each must-do is claimed by exactly one stop — its best match across the
   * whole catalogue.
   *
   * Without this, "golden temple in amritsar" was also answered by the hostel
   * down the road, whose description mentions the walk to the temple. Both
   * scored full marks on the same three words, and the plan then showed a bunk
   * bed taking credit for the thing the traveler actually came for.
   */
  const claimant = new Map<string, string>(); // mustDo phrase -> inventory id
  for (const phrase of spec.mustDo) {
    let best: { id: string; score: number } | null = null;
    for (const item of catalogue) {
      if (!cities.includes(item.city ?? "")) continue;
      const s = score(item, phrase);
      // A stop you sleep in only answers a must-do that is about sleeping.
      const penalty = item.type === "hotel" && !/tent|camp|stay|live|sleep/i.test(phrase) ? 0.5 : 1;
      const weighted = s * penalty;
      if (weighted >= 0.34 && (!best || weighted > best.score)) {
        best = { id: item.id, score: weighted };
      }
    }
    if (best) claimant.set(phrase, best.id);
  }

  const satisfiedBy = (id: string) =>
    [...claimant.entries()].find(([, itemId]) => itemId === id)?.[0];

  const ranked = new Map<string, { item: Item; rank: number; satisfies?: string }[]>();

  for (const city of cities) {
    const rows = catalogue
      .filter((i) => i.city === city && i.type !== "transport")
      .map((item) => {
        const satisfies = satisfiedBy(item.id);
        const interestHits = item.tags.filter((t) => interests.has(t)).length;
        return { item, rank: (satisfies ? 10 : 0) + interestHits, satisfies };
      })
      .sort((a, b) => b.rank - a.rank);
    ranked.set(city, rows);
  }

  // Start everyone at one day, then hand spare days to the town with the most
  // stops it still cannot fit. A trek town with three unplaced stops earns a
  // second day before a city with one.
  // A town holding something that eats a whole day starts with two, not one.
  // The Chandrashila push leaves camp before dawn and gets back mid-afternoon;
  // given one day it was scheduled for 13:00 on the afternoon the traveler
  // arrived, which is a seven-hour summit climb starting after lunch.
  const returnTo = cities[0];
  const nights = new Map<string, number>(
    cities.map((c) => {
      const hasFullDayStop = catalogue.some(
        (i) =>
          i.city === c &&
          i.type !== "transport" &&
          // A hotel's 600 minutes are the night, not the day.
          i.type !== "hotel" &&
          i.duration_min >= 300
      );
      return [c, hasFullDayStop ? 2 : 1];
    })
  );

  for (let guard = 0; guard < 20; guard++) {
    const used = simulate(graph, cities, nights, returnTo).length;
    if (used >= dayBudget) break;

    const hungriest = cities
      .map((city) => {
        const stops = (ranked.get(city) ?? []).filter((r) => r.item.type !== "hotel");
        const capacity = (nights.get(city) ?? 1) * MAX_ACTIVITIES_PER_DAY;
        return { city, unplaced: stops.length - capacity };
      })
      .sort((a, b) => b.unplaced - a.unplaced)[0];

    if (!hungriest || hungriest.unplaced <= 0) break;
    nights.set(hungriest.city, (nights.get(hungriest.city) ?? 1) + 1);
  }

  /**
   * Spend the days that are left over.
   *
   * The loop above stops once no town has stops it cannot fit, which for five
   * Swiss towns and three activities a day runs out at ten of a thirteen-day
   * trip. It then reported "3 days are yours to spend freely", which sounds
   * generous and is really an itinerary that ends on the tenth night and leaves
   * the traveler in Zermatt with no bed booked for the eleventh.
   *
   * They asked for those dates. So the remaining nights are handed round the
   * towns — the ones with the most still to see first — and become real days
   * with a room and a slower morning. A rest day in Lucerne is a normal part of
   * a fortnight; an unaccounted night is not.
   *
   * Still bounded by `dayBudget`, so this never invents time nobody asked for.
   */
  for (let guard = 0; guard < 20; guard++) {
    const used = simulate(graph, cities, nights, returnTo).length;
    if (used >= dayBudget) break;

    const roomiest = cities
      .map((city) => ({
        city,
        // Prefer somewhere with things left to do, then somewhere short-stayed,
        // so the spare nights do not all pile into one town.
        spare: (ranked.get(city) ?? []).filter((r) => r.item.type !== "hotel").length,
        nights: nights.get(city) ?? 1,
      }))
      .sort((a, b) => a.nights - b.nights || b.spare - a.spare)[0];

    if (!roomiest) break;
    nights.set(roomiest.city, roomiest.nights + 1);
  }

  const plans = simulate(graph, cities, nights, returnTo);

  /* ---- fill the days ---- */

  const stops: ComposedStop[] = [];
  const placed = new Set<string>();
  /**
   * What has been placed, by name rather than by row.
   *
   * `placed` holds inventory ids, which is the right guard against booking one
   * row twice and no guard at all against two rows for the same thing. A
   * catalogue built by repeated research accumulates those — "Mount Pilatus
   * golden round trip" and "Mount Pilatus – Golden Round Trip", eighty-four
   * francs and seventy-two — and an itinerary that climbs the same mountain
   * twice on consecutive days is the kind of mistake nobody needs to be an
   * expert to see.
   *
   * Ingestion now merges those on the way in; this catches the ones already
   * stored, and anything a future source spells differently again.
   */
  const placedTitles: string[] = [];
  const metMustDo = new Set<string>();

  /**
   * Where the group sleeps in a town.
   *
   * This used to be `find(first hotel in the city)`, which was correct while
   * every city had exactly one — and silently wrong the moment the catalogue
   * had three. PS-7 asks for accommodation preferences by name, so the bracket
   * the traveler asked for wins, and the shortfall is recorded rather than
   * swallowed: a mountain meadow has no five-star option and the honest answer
   * is to book the tent and say why, not to pretend the preference was met.
   *
   * With no preference stated it takes the cheapest, which is what it did
   * before by accident of insertion order and is now on purpose.
   */
  const wanted = spec.lodging ?? null;
  const lodgingFallbacks: { city: string; asked: string; got: string }[] = [];

  const stayFor = (city: string) => {
    const beds = catalogue
      .filter((i) => i.city === city && i.type === "hotel")
      .sort((a, b) => Number(a.base_cost) - Number(b.base_cost));
    if (!beds.length) return null;
    if (!wanted) return beds[0];

    const exact = beds.find((b) => b.tier === wanted);
    if (exact) return exact;

    /**
     * Nearest bracket, not "anything". Someone who asked for luxury and cannot
     * have it wants the dearest bed in town; someone who asked for budget and
     * cannot have it wants the cheapest. Walking the ladder outward from where
     * they asked gets both, and the list is ordered so the distance is real.
     */
    const ladder = ["budget", "midrange", "boutique", "luxury"];
    const target = ladder.indexOf(wanted);
    const nearest = [...beds]
      .filter((b) => b.tier)
      .sort(
        (a, b) =>
          Math.abs(ladder.indexOf(a.tier!) - target) -
          Math.abs(ladder.indexOf(b.tier!) - target)
      )[0];

    const bed = nearest ?? beds[0];
    lodgingFallbacks.push({
      city,
      asked: wanted,
      got: bed.tier ?? "unrated",
    });
    return bed;
  };

  for (const plan of plans) {
    // Legs first: they set the shape of the day, and an overnight one means
    // there is no bed to book at either end of it.
    for (const leg of plan.legs) {
      const item = catalogue.find((i) => i.id === leg.inventoryId);
      if (!item) continue;
      stops.push({
        inventoryId: item.id,
        day: plan.day,
        localTime: leg.departsAt,
        title: item.title,
        cost: Number(item.base_cost),
        city: leg.from,
      });
    }

    if (TRANSIT_ONLY.has(plan.city)) continue;

    const sleepsHere = !plan.legs.some((l) => l.overnight);
    const isLastDay = plan.day === plans[plans.length - 1].day;

    // The last day is the journey home. No bed, and nothing booked on top of a
    // ten-hour descent and a train.
    if (isLastDay) continue;

    if (sleepsHere && !isLastDay) {
      const stay = stayFor(plan.city);
      if (stay) {
        stops.push({
          inventoryId: stay.id,
          day: plan.day,
          // Late, because a bed is where the day ends. At 15:00 it collided
          // with whatever was actually happening that afternoon.
          localTime: "21:00",
          title: stay.title,
          cost: Number(stay.base_cost),
          city: plan.city,
          satisfies: satisfiedBy(stay.id),
        });
        const m = satisfiedBy(stay.id);
        if (m) metMustDo.add(m);
      }
    }

    // Activities, best-ranked first, laid down a clock that starts after the
    // last leg lands rather than at a fixed hour.
    const arrivalLeg = plan.legs.find((l) => !l.overnight);
    let cursor = arrivalLeg ? 13 * 60 : 9 * 60;

    const pool = (ranked.get(plan.city) ?? []).filter(
      (r) =>
        r.item.type !== "hotel" &&
        !placed.has(r.item.id) &&
        !placedTitles.some((t) => samePlace(t, r.item.title, plan.city))
    );

    let count = 0;
    for (const { item, satisfies } of pool) {
      if (count >= MAX_ACTIVITIES_PER_DAY) break;

      const opens = item.opens_at ? toMinutes(item.opens_at) : 0;
      let start = Math.max(cursor, opens);

      // A dawn start is part of what the stop *is*: the Chandrashila push
      // leaves at 04:00 to be on the summit for sunrise. Pushed to 09:00 it is
      // a different, worse day out. So it takes the morning when the morning
      // is free, and waits for one when it is not.
      const needsDawn = item.duration_min >= 300 && opens < 8 * 60;
      if (needsDawn && count === 0 && !arrivalLeg) start = opens;
      else if (needsDawn && start > opens + 180) continue;

      if (start + item.duration_min > 22 * 60) continue;

      stops.push({
        inventoryId: item.id,
        day: plan.day,
        localTime: fromMinutes(start),
        title: item.title,
        cost: Number(item.base_cost),
        city: plan.city,
        satisfies,
      });
      placed.add(item.id);
      placedTitles.push(item.title);
      if (satisfies) metMustDo.add(satisfies);
      cursor = start + item.duration_min + 30;
      count++;
    }
  }

  stops.sort((a, b) =>
    a.day === b.day ? a.localTime.localeCompare(b.localTime) : a.day - b.day
  );

  const cityByDay: Record<number, string> = {};
  for (const plan of plans) cityByDay[plan.day] = plan.city;

  const total = stops.reduce((sum, s) => sum + s.cost, 0);
  const totalInBudget =
    currency === spec.currency ? total : fx !== null ? total * fx : null;
  const budgetInPlanCurrency =
    spec.budget === null
      ? null
      : currency === spec.currency
        ? spec.budget
        : fx !== null && fx > 0
          ? spec.budget / fx
          : null;
  const dayCount = plans.length;
  const unmetMustDo = spec.mustDo.filter((m) => !metMustDo.has(m));

  /* ---- what they need to be told ---- */

  const warnings: string[] = [];
  if (unservedDestinations.length) {
    warnings.push(
      `Not in this catalogue yet: ${unservedDestinations.join(", ")}. Everything else is planned.`
    );
  }
  if (dayCount > dayBudget) {
    // Name the legs that actually cost the nights, rather than a sentence
    // written about one particular route. The first version of this said
    // "Amritsar and Manali sit on opposite sides of the corridor", which was
    // true of the trip it was written for and false of every other one.
    const overnight = plans
      .flatMap((p) => p.legs)
      .filter((l) => l.overnight)
      .map((l) => `${l.from} → ${l.to}`);

    warnings.push(
      `These towns need ${dayCount} days, not ${dayBudget}.` +
        (overnight.length
          ? ` ${overnight.length} of the legs are overnight ones — ${overnight.join(", ")} — ` +
            `and each costs a night rather than an hour.`
          : "")
    );
  }
  /**
   * Compare like with like, or say nothing.
   *
   * `total` is summed from catalogue rows and is in the destination's money;
   * `spec.budget` is what the traveler typed and is in theirs. For a trip
   * inside one country those are the same and this is arithmetic. For Delhi to
   * Zurich they are not, and comparing 1,900 to 200,000 without converting
   * reports a trip that is nearly double the budget as comfortably inside it.
   */
  /**
   * Say so when the trip is shorter than the trip they asked for.
   *
   * The composer hands spare days to whichever town still has stops it cannot
   * fit, and stops when no town does — so a thin catalogue produces a genuinely
   * good eight-day plan for someone who asked for thirteen, and says nothing
   * about the five days it did not fill. There was a warning for needing *more*
   * days than the traveler had and none for needing fewer, which is the half
   * that looks like success.
   */
  if (dayCount < dayBudget) {
    const short = dayBudget - dayCount;
    warnings.push(
      `This fills ${dayCount} of your ${dayBudget} days. I could only find ` +
        `enough in ${cities.join(", ")} to justify that many — name another town ` +
        `or two and I will spread it out, otherwise ${short} ` +
        `${short === 1 ? "day is" : "days are"} yours to spend freely.`
    );
  }
  if (spec.budget !== null) {
    const comparable = totalInBudget ?? (currency === spec.currency ? total : null);
    if (comparable !== null && comparable > spec.budget) {
      warnings.push(
        `The plan comes to ${Math.round(comparable)} ${spec.currency} against a ` +
          `${Math.round(spec.budget)} ${spec.currency} budget` +
          (currency === spec.currency
            ? "."
            : ` — ${Math.round(total)} ${currency} converted at ${fx}.`)
      );
    } else if (comparable === null) {
      warnings.push(
        `The plan comes to ${Math.round(total)} ${currency}, and your budget is in ` +
          `${spec.currency}. I could not find a reliable exchange rate, so check ` +
          `the conversion yourself before committing to this.`
      );
    }
  }
  if (unmetMustDo.length) {
    warnings.push(`Nothing in the catalogue matched: ${unmetMustDo.join("; ")}.`);
  }
  /**
   * Only report the towns that were actually booked. `stayFor` is called while
   * the composer is still deciding, so a town it considered and dropped can
   * leave a fallback behind for a night nobody is spending there.
   */
  const bookedCities = new Set(stops.map((s) => s.city));
  const missedLodging = new Map<string, string>();
  for (const f of lodgingFallbacks) {
    // A four-night town calls `stayFor` four times, so the raw list names it
    // once per night. Keyed by city, because the traveler is being told about
    // a place, not about a booking.
    if (bookedCities.has(f.city)) missedLodging.set(f.city, f.got);
  }
  if (missedLodging.size) {
    warnings.push(
      `You asked for ${wanted} rooms. ` +
        [...missedLodging]
          .map(([city, got]) => `${city} only has ${got}`)
          .join(", ") +
        ` — booked the closest thing there.`
    );
  }

  return {
    stops,
    cities,
    cityByDay,
    timeZone,
    dayCount,
    total,
    currency,
    budget: spec.budget,
    budgetCurrency: spec.currency,
    totalInBudget,
    budgetInPlanCurrency,
    unservedDestinations,
    unmetMustDo,
    warnings,
  };
}

/**
 * Turn an accepted plan into rows.
 *
 * Stops are written in chronological order because that is what makes the
 * result a graph rather than a list: `addItem` -> `chainInto` hangs each new
 * stop off the one before it, so the disruption engine, the blast radius walk
 * and the re-planner all work on a composed trip exactly as they do on the
 * seeded one. Writing them out of order would produce the same itinerary with
 * the dependencies pointing the wrong way, and nothing would complain until a
 * storm hit day four.
 *
 * Separate from `planItinerary` so that everything above this line can run,
 * be shown to a person, and be thrown away without touching the database.
 */
export async function commitItinerary(
  tripId: string,
  plan: ComposeResult,
  spec: TripSpec
): Promise<void> {
  const supabase = createAdminClient();

  /**
   * One insert, not one per stop.
   *
   * This was `for (const stop of plan.stops) await addItem(...)`, and `addItem`
   * makes four round trips — read the trip, read the inventory row, ask what to
   * chain onto, write. For a 52-stop itinerary against a hosted Postgres that
   * is over two hundred sequential requests and the better part of a minute,
   * spent with the traveler watching a button that says "Building the trip…".
   *
   * `addItems` builds the same rows and the same dependency chain in memory and
   * writes them once. Same seq, same depends_on, same DAG.
   */
  await addItems({ tripId, timeZone: plan.timeZone, stops: plan.stops });

  /**
   * Make the trip re-plannable.
   *
   * Without a grid on its own inventory, a composed trip has no substitutes and
   * the re-planner reaches for whatever else in the catalogue happens to have
   * one. Doing it here rather than at ingest time is what makes the dates
   * right: only now do we know which days the trip actually covers.
   */
  if (spec.startsOn) {
    await ensureAvailability(
      [...new Set(plan.stops.map((s) => s.inventoryId))],
      spec.startsOn,
      addDays(spec.startsOn, plan.dayCount)
    );
  }

  await supabase
    .from("trips")
    .update({
      destinations: plan.cities,
      currency: plan.currency,
      time_zone: plan.timeZone,
      // The composed length is the real one; the form's guess was a guess.
      ends_on: spec.startsOn ? addDays(spec.startsOn, plan.dayCount - 1) : null,
    })
    .eq("id", tripId);
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
}

function fromMinutes(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
