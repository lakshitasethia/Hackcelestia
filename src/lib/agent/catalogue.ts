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
const FILLER = new Set(["the", "a", "an", "an", "and", "of", "to", "in", "at", "de", "du", "la", "le"]);

/**
 * Words that describe what a place *is*, not which place it is.
 *
 * "Mount Pilatus", "Mount Pilatus – Golden Round Trip" and "Pilatus cable car"
 * are one mountain sold three ways, and every distinguishing word between them
 * is a noun about transport or scenery. Strip those and what is left is the
 * name: pilatus. Nationality adjectives are here too — "Swiss" appears in half
 * the catalogue and identifies nothing.
 */
const GENERIC = new Set([
  "mount", "mountain", "railway", "rail", "train", "cable", "car", "cablecar",
  "funicular", "lift", "gondola", "trail", "walk", "walking", "tour", "trip",
  "ride", "cruise", "boat", "ferry", "round", "golden", "panorama", "panoramic",
  "viewpoint", "view", "summit", "peak", "glacier", "paradise", "top", "europe",
  "experience", "visit", "entry", "ticket", "pass", "day", "half", "full",
  "museum", "gallery", "centre", "center", "park", "garden", "old", "town",
  "city", "village", "bridge", "tower", "water", "lake", "river", "valley",
  "swiss", "switzerland", "national", "grand", "classic", "scenic", "express",
]);

export function normaliseTitle(title: string): string {
  return words(title).sort().join(" ");
}

function words(title: string): string[] {
  return title
    .toLowerCase()
    .normalize("NFKD")
    // Strip accents, so "Waldstätterhof" and "Waldstatterhof" are one hotel.
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !FILLER.has(w));
}

/** The words that actually name the place, once the category words are gone. */
function distinctive(title: string): string[] {
  const kept = words(title).filter((w) => !GENERIC.has(w) && w.length > 2);
  // A title made entirely of category words ("Old Town walk") has to fall back
  // to all of them, or every such stop in a city collapses into one.
  return kept.length ? kept : words(title);
}

/**
 * Are these two titles, in the same town, the same place?
 *
 * Exact matching let one attraction in under three spellings — "Jungfrau
 * Railway – Top of Europe", "Jungfraujoch railway" and "Jungfrau Railway to
 * Jungfraujoch" all landed in a single itinerary, as did Chapel Bridge three
 * times and the Matterhorn cable car twice. Nothing downstream can tell them
 * apart: the composer dedupes by inventory id, and they are three rows.
 *
 * The rule is: strip the words that say what kind of thing it is, then two
 * titles match when *every* naming word of the shorter one is present in the
 * longer, allowing prefixes so "jungfrau" catches "jungfraujoch".
 *
 * Requiring the shorter one to be fully covered is what keeps it safe. "Swiss
 * National Museum" and "Swiss Museum of Transport" share a word and are not the
 * same museum — neither is a subset of the other, so they stay apart.
 */
export function samePlace(a: string, b: string, city?: string): boolean {
  /**
   * The town's own name identifies nothing inside that town.
   *
   * Without this, "Lake Zurich Boat Ride" and "Old Town Zurich walk" both
   * reduce to {zurich} — every category word stripped, the city left standing —
   * and the whole of Zurich collapses into one attraction. Passed in rather
   * than guessed, because only the caller knows which town these are in.
   */
  const cityWords = new Set(city ? words(city) : []);
  const strip = (t: string) => distinctive(t).filter((w) => !cityWords.has(w));

  const x = strip(a);
  const y = strip(b);
  // Nothing left but the town name: not enough to call them the same place.
  if (!x.length || !y.length) return false;

  /**
   * The same place is described with the same number of naming words.
   *
   * Without this, one naming word swallowed anything containing it: "Matterhorn
   * Glacier Paradise" reduces to {matterhorn} and "Matterhorn Museum –
   * Zermatlantis" to {matterhorn, zermatlantis}, the first is a subset of the
   * second, and a cable car ate a museum. An extra naming word is a different
   * place; extra *category* words are not, and those are already gone.
   */
  if (x.length !== y.length) return false;

  const [short, long] = x.length <= y.length ? [x, y] : [y, x];

  /**
   * Prefixes only for words long enough to mean something.
   *
   * "jungfrau" matching "jungfraujoch" is the case this exists for. "broc"
   * matching "brocki" is the case it must not: a five-character floor keeps the
   * first and rejects the second.
   */
  const covers = (word: string) =>
    long.some(
      (other) =>
        other === word ||
        (word.length >= 5 && other.startsWith(word)) ||
        (other.length >= 5 && word.startsWith(other))
    );

  return short.every(covers);
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

/**
 * Give researched rows a bookable slot on every day of the trip.
 *
 * `findCandidates` reads `availability`, not `inventory` — a substitute has to
 * be something with a seat free on the day. Seeded rows come with a grid;
 * researched rows had none, so a composed trip had no alternatives of its own
 * and the re-planner offered the only rows that did have a grid: seeded
 * Himalayan treks, priced in euros, as replacements for a Swiss mountain
 * railway.
 *
 * The slots are honest about what they are. A researched row is a claim off a
 * web page, so its vendor is `manual` and `confirmTrip` holds rather than
 * reserves; this grid says "there is plausibly room here", which is exactly what
 * the re-planner needs to offer it and no more than we know.
 */
export async function ensureAvailability(
  inventoryIds: string[],
  startsOn: string,
  endsOn: string
): Promise<number> {
  if (!inventoryIds.length) return 0;
  const supabase = createAdminClient();

  const { data: rows } = await supabase
    .from("inventory")
    .select("id, opens_at, base_cost, provisional")
    .in("id", inventoryIds)
    .eq("provisional", true);

  const days: string[] = [];
  for (let d = new Date(`${startsOn}T00:00:00Z`); d <= new Date(`${endsOn}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    days.push(d.toISOString().slice(0, 10));
  }

  const wanted: Record<string, unknown>[] = [];
  for (const row of (rows ?? []) as { id: string; opens_at: string | null; base_cost: number }[]) {
    for (const day of days) {
      const time = (row.opens_at ?? "09:00").slice(0, 5);
      wanted.push({
        inventory_id: row.id,
        date: day,
        starts_at: new Date(`${day}T${time}:00Z`).toISOString(),
        slots_total: 12,
        slots_taken: 0,
        price: row.base_cost,
      });
    }
  }
  if (!wanted.length) return 0;

  // `availability` is unique on (inventory_id, starts_at), so re-running this
  // for an overlapping trip must not fail — it should simply change nothing.
  const { error } = await supabase
    .from("availability")
    .upsert(wanted as never, { onConflict: "inventory_id,starts_at", ignoreDuplicates: true });
  if (error) throw new Error(`ensureAvailability: ${error.message}`);
  return wanted.length;
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

  const stored = ((existingRows ?? []) as Existing[]).filter((r) => r.city);

  const existing = new Map<string, Existing>();
  for (const row of stored) existing.set(key(row.city!, row.title), row);

  /**
   * Find a stored row for the same place, however it is spelled.
   *
   * The exact-key map above still runs first because it is a hash lookup and
   * catches the common case. This is the fallback that catches "Jungfrau
   * Railway – Top of Europe" already being in the catalogue as "Jungfraujoch
   * railway".
   */
  const findStored = (city: string, title: string): Existing | undefined =>
    existing.get(key(city, title)) ??
    stored.find((r) => r.city === city && samePlace(r.title, title, city));

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
    const hit = findStored(place.city, place.title);
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
