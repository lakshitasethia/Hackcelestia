import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { CHAT_MODEL, RESEARCH_MODEL, groqClient, withRateLimitRetry } from "./runtime";
import type { TripSpec } from "./intake";

/**
 * The research agent — the web pass the catalogue never had.
 *
 * Everything before this could only plan a trip that was already seeded. Ask
 * for Switzerland and the composer answered "None of those places are in the
 * catalogue yet", which was true and useless. There was no code path anywhere
 * in the project that fetched anything from the internet.
 *
 * This is that path. It runs on `groq/compound-mini`, whose built-in
 * `web_search` tool is executed server-side by Groq and comes back with the
 * pages it read attached to the message. That matters for two reasons: it
 * needs no second vendor and no second API key beyond the GROQ_API_KEY this
 * project already requires, and every price it reports arrives with the URL it
 * was read off, so a researched row is auditable rather than a plausible
 * number with a UUID.
 *
 * ## Two models, on purpose
 *
 * Search and structure are separate calls. The compound models run Groq's own
 * tools and are not reliable at strict JSON while they do it, and asking one
 * model to both browse and emit a schema produced exactly the failure you would
 * expect — well-researched prose wrapped in JSON that half-parsed. So the
 * searcher writes a brief in prose with its citations, and a second, cheaper
 * call turns that brief into rows. The structurer never browses, so it cannot
 * invent a source: it only has the text the searcher brought back.
 *
 * ## What research is allowed to decide
 *
 * Facts, and nothing else. What exists, what it costs, how long it takes, when
 * it opens, how you get from one town to the next and whether that journey eats
 * a night. It does not decide the order of the days, which stop goes on which
 * morning, or whether the trip fits — that is `compose.ts`, which is a solver,
 * and the rule this project already states is that feasibility is a solver and
 * not a model. Research widens what the solver can choose from. It does not
 * replace it.
 */

/* ------------------------------------------------------------------ types -- */

export type ResearchedPlace = {
  title: string;
  type: "hotel" | "activity" | "restaurant" | "guide";
  description: string;
  city: string;
  /** Minutes the visit actually takes, door to door. */
  durationMin: number;
  /** Per person, in the trip's currency. */
  cost: number;
  opensAt: string | null;
  closesAt: string | null;
  tags: string[];
  sourceUrl: string | null;
  weatherSensitive: boolean;
};

export type ResearchedLeg = {
  title: string;
  from: string;
  to: string;
  durationMin: number;
  cost: number;
  departsAt: string;
  overnight: boolean;
  sourceUrl: string | null;
};

export type ResearchResult = {
  /** Towns worth basing days in, in the order the research suggests travelling
   *  them. The composer re-orders along the leg graph; this is only a hint. */
  cities: string[];
  country: string;
  currency: string;
  timeZone: string;
  /**
   * What one unit of `currency` is worth in the traveler's budget currency.
   *
   * Somebody in Delhi planning Switzerland thinks in rupees and pays in
   * francs, and without this the plan sums 1,900 CHF of catalogue rows and
   * compares it to a 200,000 budget as though both were the same money — which
   * reads as comfortably under budget and is roughly double it. Null when the
   * two currencies are the same, or when the research could not find a rate.
   */
  fxToBudget: number | null;
  places: ResearchedPlace[];
  legs: ResearchedLeg[];
  /** Every page any pass actually read, deduped. Shown with the proposal. */
  sources: { title: string; url: string }[];
  /** Things the traveler should know that are not a row: seasonal closures,
   *  a pass that is cheaper than the sum of its tickets, a visa. */
  notes: string[];
};

/* ---------------------------------------------------------------- schemas -- */

const ShapeSchema = z.object({
  country: z.string(),
  currency: z.string(),
  fx_to_budget: z.number().nullish(),
  time_zone: z.string(),
  cities: z.array(z.string()).max(8),
  legs: z
    .array(
      z.object({
        title: z.string(),
        from: z.string(),
        to: z.string(),
        duration_min: z.number(),
        cost: z.number(),
        departs_at: z.string(),
        overnight: z.boolean(),
        source_url: z.string().nullish(),
      })
    )
    .max(24),
  notes: z.array(z.string()).max(8).nullish(),
});

const PlacesSchema = z.object({
  places: z
    .array(
      z.object({
        title: z.string(),
        type: z.enum(["hotel", "activity", "restaurant", "guide"]),
        description: z.string(),
        duration_min: z.number(),
        cost: z.number(),
        opens_at: z.string().nullish(),
        closes_at: z.string().nullish(),
        tags: z.array(z.string()).nullish(),
        source_url: z.string().nullish(),
        weather_sensitive: z.boolean().nullish(),
      })
    )
    .max(20),
});

/* ------------------------------------------------------------------ search -- */

type SearchOutput = { brief: string; sources: { title: string; url: string }[] };

/**
 * How much room a search pass gets to answer in.
 *
 * Deliberately small. Groq injects the pages it fetched into the context
 * before the model writes anything, and one search costs about 5,500 prompt
 * tokens on its own — so the completion budget is the only part of the request
 * we control, and a generous one is what turns a working pass into a 413. This
 * is enough for a dense list of prices and not enough for an essay, which is
 * exactly what the system prompt asks for anyway.
 */
const SEARCH_TOKENS = 900;

/**
 * Keep each pass to a single search.
 *
 * `groq/compound-mini` injects the pages it fetched into its own context before
 * it writes a word, and that context is small. One search costs roughly 3,400
 * tokens of it, so two fit and three do not — and a request that overflows
 * comes back 413 `request_too_large`, *after* the searching is done and paid
 * for. Left to itself the model happily runs four searches for "list five
 * things to do in Lucerne" and fails every time, while the same question about
 * one named attraction succeeds.
 *
 * So the number of searches is the thing to control, and this is the only lever
 * on it. It is a request, not a guarantee — which is why `trySearch` still
 * exists.
 */
const SEARCH_SYSTEM =
  "You are a travel researcher. Run AT MOST ONE web search, then answer from " +
  "those results alone — never run a second search, even if the first was " +
  "disappointing. Report only what the results actually say. Every price must " +
  "carry its currency and the page it came from. If a price is not in the " +
  "results, say so rather than estimating: a missing number is recoverable and " +
  "an invented one is not. Be terse — a dense list, no prose, no itinerary.";

/**
 * Web passes to run at once.
 *
 * The free tier allows 70,000 tokens a minute across this model, and a single
 * search pass costs somewhere north of 6,000 of them. Five cities fired off
 * together reliably 429s partway through, which meant a trip whose research
 * half-succeeded. Two at a time keeps a five-city trip inside the window and
 * still finishes in about a third of the time sequential would take.
 */
const SEARCH_CONCURRENCY = 2;

/** Run `work` over `items`, `limit` at a time, keeping input order. */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  work: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;

  const worker = async () => {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await work(items[i], i);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker)
  );
  return out;
}

/**
 * One web pass. Returns the model's prose and the pages it actually opened.
 *
 * The sources come from `executed_tools[].search_results` rather than from
 * anything the model wrote, which is the whole point: a URL in the prose is a
 * claim, and a URL in the tool output is a page that was really fetched.
 */
async function search(question: string, maxTokens = SEARCH_TOKENS): Promise<SearchOutput> {
  const groq = groqClient();

  const completion = await withRateLimitRetry(() =>
    groq.chat.completions.create({
      model: RESEARCH_MODEL,
      temperature: 0.2,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: SEARCH_SYSTEM },
        { role: "user", content: question },
      ],
      // Groq executes this itself; there is no tool loop to drive here.
      compound_custom: { tools: { enabled_tools: ["web_search"] } },
    } as never)
  );

  const message = completion.choices[0]?.message as
    | {
        content?: string | null;
        executed_tools?: {
          search_results?: { results?: { title?: string; url?: string }[] } | unknown;
        }[];
      }
    | undefined;

  const sources: { title: string; url: string }[] = [];
  for (const tool of message?.executed_tools ?? []) {
    const results = (tool.search_results as { results?: { title?: string; url?: string }[] })
      ?.results;
    for (const row of results ?? []) {
      if (row.url) sources.push({ title: row.title ?? row.url, url: row.url });
    }
  }

  return { brief: message?.content ?? "", sources };
}

/**
 * A search pass that is allowed to come back empty.
 *
 * Groq answers a request whose fetched pages overflow the context with a 413,
 * and that is a property of the *question*: a broad one ("things to do in
 * Bern") pulls far more page text than a narrow one ("adult admission price of
 * X"). Retrying it unchanged is guaranteed to fail identically, which is why
 * `withRateLimitRetry` refuses to — so the retry here has to be a smaller
 * question, not the same one again.
 *
 * And if the second attempt fails too, one town's research is worth less than
 * the whole trip: the pass returns nothing and the composer plans around the
 * cities that did come back. A thirteen-day itinerary missing one town's
 * restaurants is a usable answer; an exception is not.
 */
async function trySearch(
  question: string,
  fallback: string
): Promise<SearchOutput> {
  try {
    return await search(question);
  } catch (first) {
    const tooLarge = /too large|entity too large|413/i.test(
      first instanceof Error ? first.message : String(first)
    );
    if (!tooLarge) throw first;

    try {
      return await search(fallback, 500);
    } catch {
      console.warn(`[research] gave up on a pass: ${fallback.slice(0, 80)}`);
      return { brief: "", sources: [] };
    }
  }
}

/**
 * JSON out of a brief, with no web access of its own.
 *
 * Runs on `CHAT_MODEL` rather than the bigger `MODEL`, and the reason is a
 * shared budget rather than a judgement about capability. `groq/compound-mini`
 * is itself built on `openai/gpt-oss-120b`, and everything it spends — the
 * fetched pages included — is billed against *that* model's daily token
 * allowance. Structuring on the 120b too means the research passes and the
 * calls that make sense of them compete for one pool, and a trip that
 * researched five towns successfully then fails to structure the last two.
 * The 20b has its own allowance, and turning a brief into rows is exactly the
 * kind of work it is good at.
 */
async function structure<T>(
  system: string,
  brief: string,
  schema: z.ZodType<T>
): Promise<T | null> {
  const groq = groqClient();

  const completion = await withRateLimitRetry(() =>
    groq.chat.completions.create({
      model: CHAT_MODEL,
      temperature: 0,
      // The structuring models run an 8,000 token-per-minute window, and two of
      // these in flight at once has to fit inside it alongside the brief.
      max_tokens: 1800,
      reasoning_effort: "low",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: brief },
      ],
    })
  );

  try {
    const parsed = JSON.parse(completion.choices[0]?.message?.content ?? "{}");
    const result = schema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ cache -- */

/**
 * How long a researched price is worth reusing.
 *
 * A fortnight is a compromise between two real costs. Museums and railways do
 * not change their opening hours weekly, so re-searching them daily is pure
 * waste — a research pass is ~40,000 Groq tokens and the free tier allows
 * 200,000 a day *per organization*, which is five trips. But hotel rates do
 * move, and a quote built on a month-old number is a quote that will embarrass
 * somebody at a reception desk. Fourteen days, and every row carries
 * `sourced_at` so a traveler can see how old the claim is.
 */
const CACHE_DAYS = 14;

/**
 * What makes two requests "the same research".
 *
 * Deliberately not the prose. Two people describing the same fortnight in
 * Switzerland in different words should share an answer, and a fingerprint over
 * the raw description would miss every time on a comma. So it hashes only the
 * things that actually change what gets searched — where, how long, what they
 * are into, what is compulsory, and the currency the prices get converted to.
 *
 * Dates are reduced to a length rather than kept: the same twelve days in
 * October research identically whether they start on the 2nd or the 3rd. The
 * month is kept because "closed for the season" is a real answer.
 */
export function fingerprint(spec: TripSpec): string {
  const days =
    spec.startsOn && spec.endsOn
      ? Math.round((Date.parse(spec.endsOn) - Date.parse(spec.startsOn)) / 86_400_000) + 1
      : 0;

  const parts = [
    spec.destinations.map((d) => d.toLowerCase().trim()).sort().join("|"),
    String(days),
    spec.startsOn?.slice(0, 7) ?? "",
    [...spec.interests].sort().join("|"),
    spec.mustDo.map((m) => m.toLowerCase().trim()).sort().join("|"),
    spec.currency,
  ];

  return createHash("sha256").update(parts.join("::")).digest("hex");
}

async function readCache(key: string): Promise<ResearchResult | null> {
  const supabase = createAdminClient();

  const { data } = await supabase
    .from("research_cache")
    .select("result, created_at, hits")
    .eq("fingerprint", key)
    .maybeSingle();

  const row = data as { result: unknown; created_at: string; hits: number } | null;
  if (!row) return null;

  const ageDays = (Date.now() - Date.parse(row.created_at)) / 86_400_000;
  if (ageDays > CACHE_DAYS) return null;

  /**
   * Awaited, despite being bookkeeping nobody waits on.
   *
   * This was `void supabase.from(...).update(...)`, which does nothing at all:
   * the query builder is a lazy thenable, so it only issues a request when
   * something awaits it, and `void` is precisely the operator that guarantees
   * nothing will. The counter sat at zero and the only symptom was a statistic
   * that stayed wrong — no error, no failed request, nothing to notice.
   *
   * It is one indexed update on a primary key, so awaiting it costs nothing
   * worth measuring. The error is logged rather than thrown, which keeps the
   * original intent: a failed counter is not a reason to refuse a hit and go
   * spend forty thousand tokens.
   */
  const { error } = await supabase
    .from("research_cache")
    .update({ hits: row.hits + 1, used_at: new Date().toISOString() })
    .eq("fingerprint", key);
  if (error) console.warn(`[research] cache hit counter: ${error.message}`);

  return row.result as ResearchResult;
}

export async function writeCache(key: string, spec: TripSpec, result: ResearchResult) {
  const supabase = createAdminClient();
  const days =
    spec.startsOn && spec.endsOn
      ? Math.round((Date.parse(spec.endsOn) - Date.parse(spec.startsOn)) / 86_400_000) + 1
      : null;

  await supabase.from("research_cache").upsert(
    {
      fingerprint: key,
      destinations: spec.destinations,
      day_count: days,
      result: result as never,
      created_at: new Date().toISOString(),
      used_at: new Date().toISOString(),
      hits: 0,
    } as never,
    { onConflict: "fingerprint" }
  );
}

/**
 * Towns already researched recently enough to skip.
 *
 * The second layer, and the one that helps when the prompt is *not* identical.
 * A different Swiss trip still wants Lucerne, and Lucerne is already sitting in
 * the catalogue with its sources and its prices. Reading it back costs a query;
 * researching it again costs a seventh of a day's tokens.
 */
async function catalogued(
  cities: string[]
): Promise<Map<string, ResearchedPlace[]>> {
  const supabase = createAdminClient();
  const since = new Date(Date.now() - CACHE_DAYS * 86_400_000).toISOString();

  const { data } = await supabase
    .from("inventory")
    .select(
      "title, type, description, duration_min, base_cost, opens_at, closes_at, tags, city, source_url, weather_sensitive"
    )
    .in("city", cities.length ? cities : [" none"])
    .neq("type", "transport")
    .eq("provisional", true)
    .gte("sourced_at", since);

  type Row = {
    title: string; type: string; description: string | null;
    duration_min: number; base_cost: number; opens_at: string | null;
    closes_at: string | null; tags: string[] | null; city: string | null;
    source_url: string | null; weather_sensitive: boolean | null;
  };

  const byCity = new Map<string, ResearchedPlace[]>();
  for (const row of ((data ?? []) as Row[])) {
    if (!row.city) continue;
    const list = byCity.get(row.city) ?? [];
    list.push({
      title: row.title,
      type: row.type as ResearchedPlace["type"],
      description: row.description ?? "",
      city: row.city,
      durationMin: row.duration_min,
      cost: Number(row.base_cost),
      opensAt: row.opens_at ? row.opens_at.slice(0, 5) : null,
      closesAt: row.closes_at ? row.closes_at.slice(0, 5) : null,
      tags: row.tags ?? [],
      sourceUrl: row.source_url,
      weatherSensitive: Boolean(row.weather_sensitive),
    });
    byCity.set(row.city, list);
  }

  // A town with two rows is not a researched town; it is a town whose research
  // failed halfway. Re-search it rather than planning three days around a
  // museum and a bus stop.
  for (const [city, rows] of byCity) {
    if (rows.length < 4) byCity.delete(city);
  }

  return byCity;
}

/* -------------------------------------------------------------- the agent -- */

/** Chosen so a 13-day trip is 5 concurrent city passes and not 5 minutes of them. */
const MAX_CITIES = 5;

export async function researchTrip(
  spec: TripSpec,
  /** Who asked. A research run happens before any trip exists, so this is the
   *  only thing that keeps it out of a stranger's reach — see the
   *  `runs_via_trip` policy. */
  travelerId?: string | null,
  /** Skip both caches. For "the prices look stale, go and look again". */
  options: { fresh?: boolean } = {}
): Promise<ResearchResult> {
  const supabase = createAdminClient();

  /**
   * The cheapest research is the research you already did.
   *
   * Checked before the run row is even opened, so a hit costs one indexed
   * lookup and no tokens at all. This is what makes rehearsing a demo, or two
   * people trying the same prompt, not cost a day's allowance each time.
   */
  const key = fingerprint(spec);
  if (!options.fresh) {
    const hit = await readCache(key);
    if (hit) {
      await supabase.from("agent_runs").insert({
        kind: "research",
        status: "succeeded",
        traveler_id: travelerId ?? null,
        input: { destinations: spec.destinations, cached: true },
        output: { cities: hit.cities, places: hit.places.length, cached: true } as never,
        ended_at: new Date().toISOString(),
      });
      return hit;
    }
  }

  const { data: run } = await supabase
    .from("agent_runs")
    .insert({
      kind: "research",
      status: "running",
      traveler_id: travelerId ?? null,
      input: {
        destinations: spec.destinations,
        starts_on: spec.startsOn,
        ends_on: spec.endsOn,
        model: RESEARCH_MODEL,
        structurer: CHAT_MODEL,
      },
    })
    .select("id")
    .single();
  const runId = (run as { id: string } | null)?.id ?? null;

  const step = async (seq: number, name: string, input: unknown, output: unknown) => {
    if (!runId) return;
    await supabase.from("agent_steps").insert({
      run_id: runId,
      seq,
      tool_name: name,
      tool_input: input as never,
      tool_output: output as never,
    });
  };

  try {
    const days =
      spec.startsOn && spec.endsOn
        ? Math.round((Date.parse(spec.endsOn) - Date.parse(spec.startsOn)) / 86_400_000) + 1
        : 7;
    const window = spec.startsOn ? `${spec.startsOn} to ${spec.endsOn}` : "the near future";
    const asked = spec.destinations.join(", ");
    const party = spec.partySize ?? 2;
    const budget = spec.budget
      ? `Their total budget for ${party} ${party === 1 ? "person" : "people"} is ` +
        `${spec.budget} ${spec.currency}, so lean towards places that fit inside it.`
      : "They did not give a budget, so prefer good value over luxury.";

    /* ---- pass one: the shape of the trip, and how you move through it ---- */

    const shapeBrief = await trySearch(
      `A traveler is spending ${days} days in ${asked}, ${window}. ${budget}\n\n` +
        `Answer briefly and factually:\n` +
        `1. Which ${Math.min(MAX_CITIES, Math.max(2, Math.ceil(days / 3)))} towns should ` +
        `they base nights in, in travelling order?\n` +
        `2. For each consecutive pair, the train or bus between them: journey time, ` +
        `adult fare with currency, a usual departure time, and whether it runs overnight.\n` +
        `3. The country, its currency code, its IANA timezone, and what 1 unit of that ` +
        `currency is worth in ${spec.currency} today.\n` +
        `4. Anything closed or seasonal in ${window}.` +
        (spec.mustDo.length
          ? `\n5. Which town each of these is in: ${spec.mustDo.join("; ")}.`
          : ""),
      // The fallback drops everything but the two facts nothing else can be
      // derived from. A trip can be planned without knowing the fare; it cannot
      // be planned without knowing which towns.
      `List ${Math.min(MAX_CITIES, Math.max(2, Math.ceil(days / 3)))} towns to visit in ` +
        `${asked} over ${days} days, in travelling order, and give the country's ` +
        `currency code and IANA timezone. Nothing else.`
    );
    await step(1, "web_search:shape", { asked, days }, {
      sources: shapeBrief.sources.length,
      brief: shapeBrief.brief.slice(0, 4000),
    });

    const shape = await structure(
      `Turn a research brief into JSON. Return ONLY:
{"country":string,"currency":"CHF"|"EUR"|"USD"|"GBP"|"INR"|"JPY"|string,
 "fx_to_budget":number|null,"time_zone":"Europe/Zurich"|string,"cities":string[],
 "legs":[{"title":string,"from":string,"to":string,"duration_min":number,
          "cost":number,"departs_at":"HH:MM","overnight":boolean,
          "source_url":string|null}],
 "notes":string[]}

cities: the towns to base nights in, in travelling order, at most ${MAX_CITIES}.
Use the plain English name only — "Lucerne", not "Lucerne (Luzern), Switzerland".

legs: one per consecutive pair of cities in that order, both directions NOT
needed. duration_min is the journey in minutes. cost is the adult fare as a
number in the currency above. departs_at is a plausible "HH:MM" departure.
overnight is true ONLY for a service that travels through the night.
source_url must be a URL that appears in the brief, or null. Never invent one.

fx_to_budget: how many ${spec.currency} one unit of the local currency buys,
as the brief states it. Null if the brief does not say, or if the local
currency IS ${spec.currency}. Get the direction right: if the brief says
"1 CHF = 105 INR" and ${spec.currency} is INR, this is 105, not 0.0095.

notes: seasonal warnings and money-saving facts, one sentence each. Only things
the brief actually says.`,
      shapeBrief.brief,
      ShapeSchema
    );

    if (!shape || !shape.cities.length) {
      throw new Error(
        "The research pass came back without any usable destinations. " +
          "Try naming the towns you want, or a country and a rough region."
      );
    }

    const cities = shape.cities.slice(0, MAX_CITIES);

    /* ---- pass two: what is actually in each town ---- */

    const interests = spec.interests.length
      ? `They are into: ${spec.interests.join(", ")}.`
      : "";
    const mustDo = spec.mustDo.length
      ? `Non-negotiables somewhere on this trip: ${spec.mustDo.join("; ")}.`
      : "";
    const dietary = spec.dietary.length
      ? `Dietary needs: ${spec.dietary.join(", ")}.`
      : "";

    /**
     * Towns the catalogue can already answer for.
     *
     * Only the rest get a web pass. A second Swiss trip that asks for something
     * different still reuses Lucerne, which is both the right answer and the
     * difference between one town's worth of tokens and five.
     */
    const known = options.fresh ? new Map() : await catalogued(cities);
    const toSearch = cities.filter((c) => !known.has(c));
    if (known.size) {
      console.log(
        `[research] reusing ${known.size} town(s) from the catalogue: ` +
          `${[...known.keys()].join(", ")}`
      );
    }

    // Concurrent, but only two at a time: five sequential passes is a minute
    // the traveler spends watching a spinner, and five at once exhausts the
    // per-minute token budget partway through and researches half a trip.
    const cityBriefs = await mapLimit(toSearch, SEARCH_CONCURRENCY, async (city) => {
      const brief = await trySearch(
        `${city}, ${shape.country}, for a visitor ${window}. ${budget} ${interests} ` +
          `${mustDo} ${dietary}\n\n` +
          `List, each with its price in ${shape.currency} and the page you read it on:\n` +
          `- 2 budget places to stay (hostel/guesthouse/2-3 star), nightly double rate.\n` +
          `- 5 things to do, including what ${city} is best known for: admission price, ` +
          `how long a visit takes, opening and closing time.\n` +
          `- 1 affordable place to eat, typical main course price.\n` +
          `Mark which are outdoors and weather-dependent. No prose.`,
        // Narrower second attempt: the stops matter more than the beds, and a
        // shorter question pulls less page text into the context.
        `List 4 top things to do in ${city}, ${shape.country}, each with adult ` +
          `admission price in ${shape.currency}, visit duration and opening hours.`
      );
      return { city, ...brief };
    });

    for (const [i, b] of cityBriefs.entries()) {
      await step(2 + i, "web_search:city", { city: b.city }, {
        sources: b.sources.length,
        brief: b.brief.slice(0, 4000),
      });
    }

    // One at a time: an 8,000-token-per-minute window does not fit two of
    // these plus their briefs, and a 429 here loses a town that was already
    // successfully researched.
    const structured = await mapLimit(
      cityBriefs.filter((b) => b.brief.trim()),
      1,
      async ({ city, brief }) => {
        const rows = await structure(
          `Turn a research brief about ${city} into JSON. Return ONLY:
{"places":[{"title":string,"type":"hotel"|"activity"|"restaurant"|"guide",
 "description":string,"duration_min":number,"cost":number,
 "opens_at":"HH:MM"|null,"closes_at":"HH:MM"|null,"tags":string[],
 "source_url":string|null,"weather_sensitive":boolean}]}

Every place must be one the brief actually names. Do not add famous places the
brief does not mention, however obvious they seem — an invented row is a stop
the traveler will turn up to and find is not there.

cost is a number in ${shape.currency}: for a hotel the nightly rate for the
room, for an activity the adult admission, for a restaurant a typical main.
Free things are 0, which is a real answer and not a missing one.

duration_min is how long a visit takes. A hotel is the night: use 600.

tags are lowercase single words describing it — food, scenic, history, museum,
hiking, adventure, culture, nightlife, shopping, family, wellness, chocolate,
rail, viewpoint. Two to four of them.

source_url must be a URL that appears in the brief, or null. Never invent one.
weather_sensitive is true only for something outdoors that rain or storm
cancels outright.`,
          brief,
          PlacesSchema
        );

        return (rows?.places ?? []).map(
          (p): ResearchedPlace => ({
            title: p.title.trim(),
            type: p.type,
            description: p.description.trim(),
            city,
            durationMin: clampDuration(p.duration_min, p.type),
            cost: Math.max(0, Number(p.cost) || 0),
            opensAt: clock(p.opens_at),
            closesAt: clock(p.closes_at),
            tags: (p.tags ?? []).map((t) => t.toLowerCase().trim()).filter(Boolean),
            sourceUrl: url(p.source_url),
            weatherSensitive: Boolean(p.weather_sensitive),
          })
        );
      }
    );

    const places = [...structured.flat(), ...[...known.values()].flat()];
    if (!places.length) {
      throw new Error(
        "The research found the towns but nothing to do in them. This is " +
          "usually a rate limit rather than an empty world — try again in a minute."
      );
    }

    /* ---- what came back ---- */

    const legs: ResearchedLeg[] = shape.legs
      .filter((l) => cities.includes(l.from) && cities.includes(l.to) && l.from !== l.to)
      .map((l) => ({
        title: l.title.trim(),
        from: l.from,
        to: l.to,
        durationMin: Math.min(Math.max(Math.round(l.duration_min) || 60, 15), 24 * 60),
        cost: Math.max(0, Number(l.cost) || 0),
        departsAt: clock(l.departs_at) ?? "09:00",
        overnight: Boolean(l.overnight),
        sourceUrl: url(l.source_url),
      }));

    const sources = dedupeSources([
      ...shapeBrief.sources,
      ...cityBriefs.flatMap((b) => b.sources),
    ]);

    const result: ResearchResult = {
      cities,
      country: shape.country.trim(),
      currency: shape.currency.trim().toUpperCase().slice(0, 3) || spec.currency,
      timeZone: shape.time_zone.trim() || "UTC",
      fxToBudget: fxRate(shape.fx_to_budget, shape.currency, spec.currency),
      places,
      legs,
      sources,
      notes: (shape.notes ?? []).map((n) => n.trim()).filter(Boolean),
    };

    await writeCache(key, spec, result);

    if (runId) {
      await supabase
        .from("agent_runs")
        .update({
          status: "succeeded",
          output: {
            cities: result.cities,
            places: result.places.length,
            legs: result.legs.length,
            sources: result.sources.length,
          } as never,
          ended_at: new Date().toISOString(),
        })
        .eq("id", runId);
    }

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (runId) {
      await supabase
        .from("agent_runs")
        .update({ status: "failed", error: message, ended_at: new Date().toISOString() })
        .eq("id", runId);
    }
    throw error;
  }
}

/* ----------------------------------------------------------------- tidy up -- */

/**
 * A duration the composer can lay on a clock.
 *
 * The structurer returns 1440 for a hotel about as often as it returns 600,
 * and a stop that is 24 hours long consumes every day after it. The type says
 * what the sane range is far better than the model does.
 */
function clampDuration(value: number, type: ResearchedPlace["type"]): number {
  const minutes = Math.round(value) || 60;
  if (type === "hotel") return 600;
  if (type === "restaurant") return Math.min(Math.max(minutes, 45), 150);
  return Math.min(Math.max(minutes, 30), 10 * 60);
}

/** "9:00", "09:00:00" and "9am" all mean 09:00; anything else means null. */
function clock(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = value.trim().match(/^(\d{1,2})[:.]?(\d{2})?\s*(am|pm)?/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  const meridiem = match[3]?.toLowerCase();
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** A source is a link somebody might click, so it has to survive being one. */
function url(value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

/**
 * A rate we are willing to multiply real money by.
 *
 * The structurer inverts this roughly one time in ten — reporting 0.0095 when
 * the brief said 1 CHF = 105 INR — and an inverted rate does not look wrong,
 * it looks like a very cheap holiday. There is no way to tell 0.0095 from a
 * legitimate rate by staring at it, so the guard is the two things that are
 * actually knowable: same currency means no conversion, and a rate outside a
 * wide sanity band means we did not understand the answer and should say
 * nothing rather than something confidently wrong.
 */
function fxRate(
  value: number | null | undefined,
  local: string,
  budget: string
): number | null {
  if (local.trim().toUpperCase() === budget.trim().toUpperCase()) return null;
  const rate = Number(value);
  if (!Number.isFinite(rate) || rate <= 0) return null;
  return rate >= 0.0001 && rate <= 10_000 ? rate : null;
}

function dedupeSources(rows: { title: string; url: string }[]) {
  const seen = new Set<string>();
  const out: { title: string; url: string }[] = [];
  for (const row of rows) {
    if (seen.has(row.url)) continue;
    seen.add(row.url);
    out.push(row);
  }
  return out.slice(0, 40);
}
