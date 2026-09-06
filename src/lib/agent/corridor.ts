import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The route graph.
 *
 * This file used to *be* the graph: a hand-written array of nine legs with the
 * catalogue's UUIDs pasted into it, spanning eight north-Indian towns. That
 * made routing code, so a new region meant a code change and a deploy — and
 * `SERVED_CITIES`, derived from it, was the exact reason "plan me a trip to
 * Switzerland" came back as "None of those places are in the catalogue yet".
 *
 * Now a transport row says where it goes (`inventory.to_city`) and whether it
 * eats the night (`inventory.overnight`), so the graph is a query and adding a
 * country is an INSERT. What is left here is the walking: breadth-first
 * shortest path, and the ordering rule.
 *
 * Routing is still config, not inference. A model asked to order six Himalayan
 * towns will cheerfully send you Amritsar → Chopta → Manali, which is two days
 * of driving it has no way to feel. The difference is that the config now lives
 * in the same table as the inventory it describes, instead of in a second copy
 * that drifts.
 */

/**
 * Geographic order along the north-India corridor.
 *
 * Kept as a constant because it is a fact about that region that no row
 * carries: `to_city` says Haridwar connects to Rishikesh, not which of them is
 * further up the country. For researched trips the equivalent hint comes from
 * the research pass, which proposes its towns in travelling order.
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

/** Towns you only ever change trains in. They never get a night or a day. */
export const TRANSIT_ONLY = new Set(["Chandigarh", "Haridwar"]);

/**
 * A loaded graph, and everything the composer asks of one.
 *
 * Passed around as a value rather than reached for as a module global, so a
 * plan for Switzerland cannot accidentally route over Indian legs and one
 * database read serves a whole compose.
 */
export class LegGraph {
  readonly legs: Leg[];
  /** Every town any leg touches. This is the honest "what can we serve". */
  readonly cities: string[];

  constructor(legs: Leg[]) {
    this.legs = legs;
    this.cities = [...new Set(legs.flatMap((l) => [l.from, l.to]))];
  }

  /**
   * Shortest path between two towns.
   *
   * Breadth-first rather than Dijkstra on purpose: every leg here is a day or a
   * night, so hop count *is* the cost, and the shortest chain of legs is the
   * one that wastes the fewest days.
   */
  route(from: string, to: string): Leg[] {
    if (from === to) return [];

    const queue: { city: string; path: Leg[] }[] = [{ city: from, path: [] }];
    const seen = new Set([from]);

    while (queue.length) {
      const { city, path } = queue.shift()!;
      for (const leg of this.legs) {
        if (leg.from !== city || seen.has(leg.to)) continue;
        const next = [...path, leg];
        if (leg.to === to) return next;
        seen.add(leg.to);
        queue.push({ city: leg.to, path: next });
      }
    }
    return [];
  }

  /**
   * Order towns the way you would actually travel them.
   *
   * `hint` is the geographic running order — `SPINE` for the seeded corridor,
   * the research pass's own city list for anywhere else. Anything not in the
   * hint keeps its relative position at the end rather than being dropped,
   * because a town nobody sequenced is still a town somebody asked for.
   */
  order(cities: string[], hint: readonly string[]): string[] {
    const index = (city: string) => {
      const i = hint.indexOf(city);
      return i === -1 ? hint.length : i;
    };
    return [...cities].sort((a, b) => index(a) - index(b));
  }
}

/**
 * Load the legs that connect a given set of towns.
 *
 * Scoped to the towns in play rather than reading every transport row on the
 * planet: once the catalogue holds several countries, a Swiss route has no
 * business walking Indian legs, and the BFS above would happily try.
 *
 * Both endpoints must be in scope. A leg to somewhere nobody asked about is an
 * edge out of the graph, and following it strands the walk.
 */
export async function loadLegGraph(cities: string[]): Promise<LegGraph> {
  if (!cities.length) return new LegGraph([]);

  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("inventory")
    .select("id, city, to_city, opens_at, overnight")
    .eq("type", "transport")
    .is("added_for_trip", null)
    .not("to_city", "is", null)
    .in("city", cities)
    .in("to_city", cities);

  if (error) throw new Error(`loadLegGraph: ${error.message}`);

  type Row = {
    id: string;
    city: string | null;
    to_city: string | null;
    opens_at: string | null;
    overnight: boolean | null;
  };

  const legs = ((data ?? []) as Row[])
    .filter((r) => r.city && r.to_city)
    .map(
      (r): Leg => ({
        from: r.city!,
        to: r.to_city!,
        inventoryId: r.id,
        // Seeded rows store the departure in `opens_at`; 09:00 is the fallback
        // for a row that never got one rather than a reason to drop the edge.
        departsAt: (r.opens_at ?? "09:00").slice(0, 5),
        overnight: Boolean(r.overnight),
      })
    );

  return new LegGraph(legs);
}

/**
 * Every town the catalogue can put someone in for a day.
 *
 * Was a constant derived from the hard-coded legs, and was the gate that
 * refused every destination outside north India. It is a query now, and it is
 * used to *report* what is available when a plan fails — not to decide in
 * advance what may be asked for, because research can add a town that was not
 * there a minute ago.
 */
export async function servedCities(): Promise<string[]> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("inventory")
    .select("city")
    .not("city", "is", null)
    // One person adding a stop in Rovaniemi does not make Rovaniemi a town
    // this catalogue can plan a trip through.
    .is("added_for_trip", null)
    .neq("type", "transport");

  const cities = new Set<string>();
  for (const row of (data ?? []) as { city: string | null }[]) {
    if (row.city && !TRANSIT_ONLY.has(row.city)) cities.add(row.city);
  }
  return [...cities].sort();
}
