import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { addItem } from "@/lib/db/mutations";
import { SERVED_CITIES, TRANSIT_ONLY, orderAlongSpine, route, type Leg } from "./corridor";
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
 */

export const INDIA_TZ = "Asia/Kolkata";

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
  dayCount: number;
  total: number;
  currency: string;
  budget: number | null;
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

    for (const leg of route(city, next)) {
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

export async function composeItinerary(
  tripId: string,
  spec: TripSpec
): Promise<ComposeResult> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("inventory")
    .select("id, title, type, description, duration_min, base_cost, opens_at, tags, city")
    .not("city", "is", null)
    // Derived from the corridor, not listed again here. A second copy of this
    // list is a second thing to forget: a town added to the spine but not to
    // the copy is silently invisible to the composer, with no error anywhere.
    .in("city", SERVED_CITIES);
  if (error) throw new Error(`composeItinerary: ${error.message}`);

  const catalogue = (data ?? []) as unknown as Item[];
  const cityNames = [...new Set(catalogue.map((i) => i.city!).filter(Boolean))];

  /* ---- which of the towns they named can this catalogue actually serve? ---- */

  const unservedDestinations: string[] = [];
  const resolved: string[] = [];
  for (const requested of spec.destinations) {
    const city = matchCity(requested, cityNames);
    if (city && !TRANSIT_ONLY.has(city)) resolved.push(city);
    else unservedDestinations.push(requested);
  }
  if (!resolved.length) {
    throw new Error(
      `None of those places are in the catalogue yet. This build covers ` +
        `${cityNames.filter((c) => !TRANSIT_ONLY.has(c)).sort().join(", ")}.`
    );
  }

  const cities = orderAlongSpine([...new Set(resolved)]);

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
    const used = simulate(cities, nights, returnTo).length;
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

  const plans = simulate(cities, nights, returnTo);

  /* ---- fill the days ---- */

  const stops: ComposedStop[] = [];
  const placed = new Set<string>();
  const metMustDo = new Set<string>();

  const stayFor = (city: string) =>
    catalogue.find((i) => i.city === city && i.type === "hotel") ?? null;

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
      (r) => r.item.type !== "hotel" && !placed.has(r.item.id)
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
      if (satisfies) metMustDo.add(satisfies);
      cursor = start + item.duration_min + 30;
      count++;
    }
  }

  stops.sort((a, b) =>
    a.day === b.day ? a.localTime.localeCompare(b.localTime) : a.day - b.day
  );

  /* ---- write, in time order, so the DAG builds itself ---- */

  for (const stop of stops) {
    await addItem({
      tripId,
      day: stop.day,
      inventoryId: stop.inventoryId,
      localTime: stop.localTime,
      timeZone: INDIA_TZ,
    });
  }

  const total = stops.reduce((sum, s) => sum + s.cost, 0);
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
  if (spec.budget !== null && total > spec.budget) {
    warnings.push(
      `The plan comes to ${Math.round(total)} against a ${Math.round(spec.budget)} budget.`
    );
  }
  if (unmetMustDo.length) {
    warnings.push(`Nothing in the catalogue matched: ${unmetMustDo.join("; ")}.`);
  }

  await supabase
    .from("trips")
    .update({
      destinations: cities,
      currency: spec.currency,
      time_zone: INDIA_TZ,
      // The composed length is the real one; the form's guess was a guess.
      ends_on: spec.startsOn ? addDays(spec.startsOn, dayCount - 1) : null,
    })
    .eq("id", tripId);

  return {
    stops,
    cities,
    dayCount,
    total,
    currency: spec.currency,
    budget: spec.budget,
    unservedDestinations,
    unmetMustDo,
    warnings,
  };
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
