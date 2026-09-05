import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ResearchResult } from "./research";

/**
 * Researched findings, written into the catalogue as real rows.
 *
 * The alternative was to keep them on the proposal and give the composer a
 * second code path for stops that are not in `inventory`. That path would then
 * also be needed by the disruption engine, the blast radius walk, the
 * re-planner's `find_alternatives`, `addItem`, `bookItem` and the concierge —
 * every one of which joins to `inventory` today. One shape of stop is worth a
 * great deal here: a Swiss trip re-plans around a storm using exactly the code
 * that re-plans the seeded Amalfi one, and none of it knows the difference.
 *
 * What keeps that honest is `provisional`. A researched row is a claim read off
 * a web page, not a contract with a supplier, so it is written against a vendor
 * whose `channel` is 'manual'. `confirmTrip` reads that channel and *holds*
 * rather than reserving, which means the booking path already refuses to
 * silently take a seat that nobody has verified exists. That behaviour was
 * already there for manual vendors; this leans on it rather than adding a
 * parallel rule.
 */

/** Everything researched hangs off one operator, so an ops user can find it. */
const RESEARCH_OPERATOR = "3a000000-0000-4000-a000-000000000001";

export type IngestResult = {
  /** Inventory ids by "city title", so the composer can find what it planned. */
  ids: Map<string, string>;
  created: number;
  reused: number;
  /** Stored rows whose price this pass confirmed and corrected. */
  refreshed: number;
};

/**
 * The identity of a place, for deciding whether we already have it.
 *
 * Exact-title matching let the same attraction in twice under two spellings:
 * "Mount Pilatus golden round trip" from one pass and "Mount Pilatus – Golden
 * Round Trip" from another, priced 84 and 72, both landing in one traveler's
 * Lucerne. Nothing downstream can tell those apart — the composer dedupes by
 * inventory id, and they are two rows.
 *
 * So punctuation, case, connecting words and the order of what is left are all
 * discarded. It is aggressive, and deliberately: two rows wrongly merged costs
 * one stop, while two rows wrongly kept puts the same mountain in the itinerary
 * twice at two prices, which is the one a person notices.
 */
const FILLER = new Set(["the", "a", "an", "and", "of", "to", "in", "at", "de", "du", "la", "le"]);

export function normaliseTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    // Strip accents, so "Waldstätterhof" and "Waldstatterhof" are one hotel.
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !FILLER.has(w))
    .sort()
    .join(" ");
}

const key = (city: string, title: string) =>
  `${city.toLowerCase()} ${normaliseTitle(title)}`;

/**
 * A vendor per (country, type).
 *
 * Not one per hotel: a vendor is who you telephone when a booking breaks, and
 * inventing 40 fictional suppliers with no contact details would fill the
 * operator's board with rows nobody can act on. One "Researched stays in
 * Switzerland" vendor is honest about what it is.
 */
async function vendorFor(
  supabase: ReturnType<typeof createAdminClient>,
  country: string,
  type: "hotel" | "activity" | "restaurant" | "guide" | "transport"
): Promise<string> {
  const name = `Researched ${type} — ${country}`;

  const { data: found } = await supabase
    .from("vendors")
    .select("id")
    .eq("name", name)
    .maybeSingle();
  if (found) return (found as { id: string }).id;

  const { data, error } = await supabase
    .from("vendors")
    .insert({
      operator_id: RESEARCH_OPERATOR,
      name,
      type,
      // The whole point: nothing researched is auto-bookable.
      channel: "manual",
      // Honest about what an unverified row is worth. The re-planner scores
      // alternatives by vendor reliability, so a researched option should not
      // outrank a supplier the operator actually has a contract with.
      reliability: 0.6,
      contact: "Unverified — researched from public sources",
    } as never)
    .select("id")
    .single();

  if (error) throw new Error(`vendorFor: ${error.message}`);
  return (data as { id: string }).id;
}

export async function ingestResearch(research: ResearchResult): Promise<IngestResult> {
  const supabase = createAdminClient();

  // The operator row researched vendors hang off. Created here rather than
  // seeded, because a deployment that never ran the India seed still needs it.
  await supabase
    .from("operators")
    .upsert(
      { id: RESEARCH_OPERATOR, name: "Voyage Research", contact: "research@voyage.example" } as never,
      { onConflict: "id" }
    );

  const cities = research.cities;
  const ids = new Map<string, string>();
  let created = 0;
  let reused = 0;

  /**
   * What is already there, read once.
   *
   * Re-researching Lucerne every time somebody plans a Swiss trip would double
   * the catalogue weekly and give the composer four copies of the same
   * chocolate factory to choose between. Matching on (city, title) is blunt,
   * but the failure it prevents — duplicate stops in one itinerary — is the
   * one a traveler actually sees.
   */
  const { data: existingRows } = await supabase
    .from("inventory")
    // `base_cost` and `source_url` are read so a stored row can be *corrected*
    // rather than merely matched — see the refresh list below.
    .select("id, title, city, base_cost, source_url")
    .in("city", cities.length ? cities : [" none"]);

  type Existing = {
    id: string;
    title: string;
    city: string | null;
    base_cost: number;
    source_url: string | null;
  };

  const existing = new Map<string, Existing>();
  for (const row of (existingRows ?? []) as Existing[]) {
    if (row.city) existing.set(key(row.city, row.title), row);
  }

  const sourcedAt = new Date().toISOString();

  /**
   * One row shape, filled in for every insert.
   *
   * PostgREST builds a single INSERT for a batch from the *union* of the keys
   * across its rows, and a row that omits one of those keys is sent an explicit
   * NULL rather than falling back to the column default. So a batch mixing
   * museums (no `overnight`) with trains (no `weather_sensitive`) fails on a
   * not-null constraint naming a column the calling code never mentioned, and
   * fixing the column in the error message just reveals the next one.
   *
   * Every row carrying every column makes that whole class of failure go away.
   */
  const row = (fields: {
    vendorId: string;
    title: string;
    type: string;
    description: string;
    durationMin: number;
    cost: number;
    city: string;
    opensAt?: string | null;
    closesAt?: string | null;
    tags?: string[];
    weatherSensitive?: boolean;
    toCity?: string | null;
    overnight?: boolean;
    sourceUrl?: string | null;
  }) => ({
    vendor_id: fields.vendorId,
    title: fields.title,
    type: fields.type,
    description: fields.description,
    duration_min: fields.durationMin,
    base_cost: fields.cost,
    opens_at: fields.opensAt ?? null,
    closes_at: fields.closesAt ?? null,
    tags: fields.tags ?? [],
    weather_sensitive: fields.weatherSensitive ?? false,
    city: fields.city,
    region: null,
    to_city: fields.toCity ?? null,
    overnight: fields.overnight ?? false,
    lat: null,
    lng: null,
    country: research.country,
    time_zone: research.timeZone,
    source_url: fields.sourceUrl ?? null,
    sourced_at: sourcedAt,
    provisional: true,
  });

  const inserts: ReturnType<typeof row>[] = [];
  const inserted = new Set<string>();

  /**
   * Rows whose price this pass actually confirmed and the catalogue has wrong.
   *
   * Reuse-on-match was the whole dedupe strategy, and it quietly made
   * verification pointless: a later pass would confirm the Lindt ticket at
   * CHF 17 off the official page, find a row from an earlier run saying 15, and
   * keep the 15. The plan then priced the stop from the stale row while the
   * proposal page showed a "verified" badge sourced from the fresh research —
   * two numbers for one ticket, and the wrong one on the invoice.
   *
   * So a verified price wins over whatever is stored. An unverified one never
   * overwrites, because a fresh guess is not better than an old confirmed fact.
   */
  const refresh: { id: string; cost: number; sourceUrl: string | null }[] = [];

  for (const place of research.places) {
    const k = key(place.city, place.title);
    const hit = existing.get(k);
    if (hit) {
      ids.set(k, hit.id);
      reused++;

      if (
        place.verified &&
        (Number(hit.base_cost) !== place.cost || hit.source_url !== place.sourceUrl)
      ) {
        refresh.push({ id: hit.id, cost: place.cost, sourceUrl: place.sourceUrl });
      } else if (!place.verified && hit.source_url) {
        /**
         * The stored row already knows something this pass does not.
         *
         * A plan is priced from `inventory`, but the proposal page reads its
         * "verified" badge from the research blob — so a run that hit a fresh
         * skeleton (unverified by construction) and reused a row somebody had
         * already confirmed showed the *right* price with no badge and the
         * words "estimated price" underneath it. The catalogue was the honest
         * one and the screen was calling it a guess.
         *
         * Copying the stored fact back onto the in-memory place keeps the plan,
         * the page and the database saying the same thing.
         */
        place.cost = Number(hit.base_cost);
        place.sourceUrl = hit.source_url;
        place.verified = true;
      }
      continue;
    }
    // Two research passes in one run can name the same place twice.
    if (inserted.has(k)) continue;

    inserts.push(
      row({
        vendorId: await vendorFor(supabase, research.country, place.type),
        title: place.title,
        type: place.type,
        description: place.description,
        durationMin: place.durationMin,
        cost: place.cost,
        city: place.city,
        opensAt: place.opensAt,
        closesAt: place.closesAt,
        tags: place.tags,
        weatherSensitive: place.weatherSensitive,
        sourceUrl: place.sourceUrl,
      })
    );
    inserted.add(k);
  }

  for (const leg of research.legs) {
    const k = key(leg.from, leg.title);
    const hit = existing.get(k);
    if (hit) {
      ids.set(k, hit.id);
      reused++;
      if (
        leg.verified &&
        (Number(hit.base_cost) !== leg.cost || hit.source_url !== leg.sourceUrl)
      ) {
        refresh.push({ id: hit.id, cost: leg.cost, sourceUrl: leg.sourceUrl });
      }
      continue;
    }
    if (inserted.has(k)) continue;

    inserts.push(
      row({
        vendorId: await vendorFor(supabase, research.country, "transport"),
        title: leg.title,
        type: "transport",
        description: `${leg.from} to ${leg.to}`,
        durationMin: leg.durationMin,
        cost: leg.cost,
        city: leg.from,
        // A departure time on a transport row is what the router reads to lay
        // the leg on a clock; `opens_at` is where every other leg in this
        // catalogue already keeps it.
        opensAt: leg.departsAt,
        tags: ["transport"],
        toCity: leg.to,
        overnight: leg.overnight,
        sourceUrl: leg.sourceUrl,
      })
    );
    inserted.add(k);
  }

  if (inserts.length) {
    const { data, error } = await supabase
      .from("inventory")
      .insert(inserts as never)
      .select("id, title, city");
    if (error) throw new Error(`ingestResearch: ${error.message}`);

    for (const row of (data ?? []) as { id: string; title: string; city: string | null }[]) {
      if (row.city) ids.set(key(row.city, row.title), row.id);
    }
    created = data?.length ?? 0;
  }

  /**
   * One statement per corrected row rather than a batch upsert: these are rare
   * (only prices that changed *and* were confirmed), and an upsert would have
   * to carry every not-null column again to avoid the PostgREST behaviour
   * documented above.
   */
  for (const fix of refresh) {
    await supabase
      .from("inventory")
      .update({
        base_cost: fix.cost,
        source_url: fix.sourceUrl,
        sourced_at: sourcedAt,
      })
      .eq("id", fix.id);
  }

  return { ids, created, reused, refreshed: refresh.length };
}
