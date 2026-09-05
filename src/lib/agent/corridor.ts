import "server-only";

/**
 * The rail-and-road spine of the north Indian catalogue.
 *
 * Routing is config, not inference. A model asked to order six Himalayan towns
 * will cheerfully send you Amritsar → Chopta → Manali, which is two days of
 * driving it has no way to feel. The legs below are the ones that actually
 * exist in the catalogue, so a route is a walk over real inventory and every
 * transfer in the finished itinerary is a bookable row rather than a sentence.
 *
 * `spine` is geographic order along the corridor — it decides which end of the
 * country you start at. `legs` is the graph the router actually walks, and
 * includes transit-only towns (Chandigarh, Haridwar) that nobody asked for and
 * everybody has to pass through.
 */

export const SPINE = [
  "Delhi",
  "Amritsar",
  "Chandigarh",
  "Manali",
  "Haridwar",
  "Rishikesh",
  "Chopta",
  "Auli",
] as const;

export type Leg = {
  from: string;
  to: string;
  /** The catalogue row that is this journey. */
  inventoryId: string;
  /** Local departure time; overnight legs leave in the evening. */
  departsAt: string;
  /** True when the leg eats the night, so no stay is booked at either end. */
  overnight: boolean;
};

export const LEGS: Leg[] = [
  { from: "Delhi",      to: "Amritsar",   inventoryId: "29000000-0000-4000-a000-000000000010", departsAt: "18:30", overnight: true },
  { from: "Amritsar",   to: "Chandigarh", inventoryId: "29000000-0000-4000-a000-000000000011", departsAt: "09:00", overnight: false },
  { from: "Chandigarh", to: "Manali",     inventoryId: "29000000-0000-4000-a000-000000000012", departsAt: "20:00", overnight: true },
  { from: "Manali",     to: "Haridwar",   inventoryId: "29000000-0000-4000-a000-000000000013", departsAt: "16:00", overnight: true },
  { from: "Haridwar",   to: "Rishikesh",  inventoryId: "29000000-0000-4000-a000-000000000014", departsAt: "08:00", overnight: false },
  { from: "Rishikesh",  to: "Chopta",     inventoryId: "29000000-0000-4000-a000-000000000015", departsAt: "06:00", overnight: false },
  { from: "Chopta",     to: "Auli",       inventoryId: "29000000-0000-4000-a000-000000000016", departsAt: "07:00", overnight: false },
  { from: "Auli",       to: "Haridwar",   inventoryId: "29000000-0000-4000-a000-000000000017", departsAt: "05:00", overnight: false },
  { from: "Haridwar",   to: "Delhi",      inventoryId: "29000000-0000-4000-a000-000000000018", departsAt: "17:00", overnight: false },
];

/**
 * Every town the corridor touches — the spine plus anything reachable on a leg.
 *
 * The composer queries the catalogue with this rather than its own list, so a
 * town is served the moment it has a leg, and cannot be half-added.
 */
export const SERVED_CITIES: string[] = [
  ...new Set<string>([...SPINE, ...LEGS.flatMap((l) => [l.from, l.to])]),
];

/** Towns you only ever change trains in. They never get a night or a day. */
export const TRANSIT_ONLY = new Set(["Chandigarh", "Haridwar"]);

/**
 * Shortest path between two towns over the leg graph.
 *
 * Breadth-first rather than Dijkstra on purpose: every leg here is a day or a
 * night, so hop count *is* the cost, and the shortest chain of legs is the one
 * that wastes the fewest days.
 */
export function route(from: string, to: string): Leg[] {
  if (from === to) return [];

  const queue: { city: string; path: Leg[] }[] = [{ city: from, path: [] }];
  const seen = new Set([from]);

  while (queue.length) {
    const { city, path } = queue.shift()!;
    for (const leg of LEGS) {
      if (leg.from !== city || seen.has(leg.to)) continue;
      const next = [...path, leg];
      if (leg.to === to) return next;
      seen.add(leg.to);
      queue.push({ city: leg.to, path: next });
    }
  }
  return [];
}

/** Order the towns someone named the way the corridor runs, not the way they
 *  typed them. Anything off the spine keeps its relative position at the end. */
export function orderAlongSpine(cities: string[]): string[] {
  const index = (city: string) => {
    const i = SPINE.indexOf(city as (typeof SPINE)[number]);
    return i === -1 ? SPINE.length : i;
  };
  return [...cities].sort((a, b) => index(a) - index(b));
}
