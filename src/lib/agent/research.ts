import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { MODEL, CHAT_MODEL, RESEARCH_MODEL, groqClient, withRateLimitRetry } from "./runtime";
import type { TripSpec } from "./intake";

/**
 * The research agent — where a trip to somewhere nobody seeded comes from.
 *
 * Before this, the planner could only plan what was already in the database:
 * ask for Switzerland and the composer answered "None of those places are in
 * the catalogue yet", which was true and useless. Nothing in the project
 * fetched anything from the internet.
 *
 * ## Why this is two passes rather than one
 *
 * The obvious design — ask a web-searching model what there is to do in
 * Lucerne — does not work on Groq's free tier, and it took a while to see why.
 * `groq/compound-mini` runs Groq's `web_search` server-side and injects the
 * fetched pages into its own context before writing a word. That context is
 * small and travel content is enormous, so the request comes back 413
 * `request_too_large` *after* the searching has happened. Measured, on a fresh
 * organization with a full budget:
 *
 *   "Lucerne: 4 things to do with prices"            -> 413
 *   "Best 5 towns for 13 days in Switzerland"        -> 413
 *   "Switzerland 13 day itinerary which towns"       -> 413
 *   "price of the Swiss Travel Pass and of Lindt"    -> OK, 7,190 tokens
 *
 * The pattern is not query length, it is query *kind*. Asking to discover
 * things returns listicles and blog posts and blows the context. Asking the
 * price of two named entities returns structured pages and fits. Even then it
 * is roughly a coin flip, because which pages come back is not ours to choose.
 * `groq/compound` behaves identically, and `openai/gpt-oss-120b` with
 * `browser_search` reads pages beautifully but bills you the page content —
 * one city query measured 153,000 prompt tokens against a 200,000 daily
 * allowance.
 *
 * So the work is split by what each tool is actually good for:
 *
 *   1. **The skeleton, with no web access at all.** Which towns, in what order,
 *      what is in them, what the trains are, the currency and the timezone.
 *      This is stable general knowledge — Zermatt has been under the Matterhorn
 *      for some time — and a model answers it reliably and cheaply. Nothing
 *      here needs a citation because nothing here is a live fact.
 *
 *   2. **Price verification, on the web, best-effort.** Narrow queries naming
 *      two specific things, which is the shape that works. Prices *are* live
 *      facts and are the thing worth checking.
 *
 * Pass two is allowed to fail, in whole or in part, and the trip survives it.
 * What changes is honesty, not availability: a place whose price came back from
 * a real page carries `verified` and the URL it was read off; one that did not
 * carries the model's estimate and says so. A plan full of estimates clearly
 * labelled is worth more than no plan, and much more than estimates presented
 * as quotes.
 *
 * ## What research is still not allowed to decide
 *
 * The order of the days, what goes on which morning, whether it all fits. That
 * is `compose.ts`, which is a solver, and the rule this project keeps is that
 * feasibility is a solver and not a model. Research widens what the solver can
 * choose from.
 */

/* ------------------------------------------------------------------ types -- */

export type ResearchedPlace = {
  title: string;
  type: "hotel" | "activity" | "restaurant" | "guide";
  description: string;
  city: string;
  /** Minutes the visit actually takes, door to door. */
  durationMin: number;
  /** Per person, in the destination's currency. */
  cost: number;
  opensAt: string | null;
  closesAt: string | null;
  tags: string[];
  sourceUrl: string | null;
  weatherSensitive: boolean;
  /**
   * True when the price above came off a page we actually fetched.
   *
   * The distinction the whole second pass exists to create. False means the
   * figure is a model's estimate — usable for planning and for a rough total,
   * and not something to put in front of a supplier.
   */
  verified: boolean;
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
  verified: boolean;
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
   * Somebody in Delhi planning Switzerland thinks in rupees and pays in francs,
   * and without this the plan sums 1,900 CHF of catalogue rows and compares it
   * to a 200,000 budget as though both were the same money — which reads as
   * comfortably under budget and is roughly double it.
   */
  fxToBudget: number | null;
  /** True when that rate came off a page rather than out of a model. */
  fxVerified: boolean;
  places: ResearchedPlace[];
  legs: ResearchedLeg[];
  /** Every page any pass actually read, deduped. Shown with the proposal. */
  sources: { title: string; url: string }[];
  /** Things the traveler should know that are not a row: seasonal closures, a
   *  pass that is cheaper than the sum of its tickets, a visa. */
  notes: string[];
  /** How much of this was checked against a live page, for the UI to be honest
   *  about without counting rows itself. */
  verifiedCount: number;
};

/* ---------------------------------------------------------------- schemas -- */

const SkeletonSchema = z.object({
  country: z.string(),
  currency: z.string(),
  time_zone: z.string(),
  fx_to_budget: z.number().nullish(),
  cities: z
    .array(
      z.object({
        name: z.string(),
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
              weather_sensitive: z.boolean().nullish(),
            })
          )
          .max(10),
      })
    )
    .max(6),
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
      })
    )
    .max(12),
  notes: z.array(z.string()).max(6).nullish(),
});

const PriceSchema = z.object({
  prices: z
    .array(
      z.object({
        title: z.string(),
        cost: z.number().nullish(),
        source_url: z.string().nullish(),
      })
    )
    .max(8),
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
 * Groq answers a request whose fetched pages overflow its context with a 413,
 * *after* doing the searching. The first version of this assumed that was a
 * deterministic property of the question and only ever retried with a narrower
 * one — which was wrong, and measurably so: the identical query for the
 * Gornergrat fare failed inside a run and succeeded thirty seconds later on its
 * own. Which pages a search returns varies, and so does whether they fit.
 *
 * So the ladder is: the same question again after a pause, then a narrower one,
 * then nothing. The pause matters as much as the retry — two concurrent
 * searches at ~7,000 prompt tokens each will also brush the per-minute ceiling,
 * and backing off is what lets the next one through.
 *
 * Returning empty is a normal outcome, not a failure. A price we could not
 * confirm keeps the planner's estimate and is labelled as one; losing the whole
 * trip because a museum's page was long would be absurd.
 */
async function trySearch(
  question: string,
  fallback: string
): Promise<SearchOutput> {
  const overflow = (e: unknown) =>
    /too large|entity too large|413/i.test(e instanceof Error ? e.message : String(e));

  try {
    return await search(question);
  } catch (first) {
    if (!overflow(first)) throw first;
  }

  await new Promise((r) => setTimeout(r, 2500));

  try {
    return await search(question);
  } catch (second) {
    if (!overflow(second)) throw second;
  }

  try {
    return await search(fallback, 500);
  } catch {
    console.warn(`[research] unverified: ${fallback.slice(0, 70)}`);
    return { brief: "", sources: [] };
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
        /**
         * The suffix is not decoration. Groq rejects `response_format:
         * json_object` outright — 400, not a degraded answer — unless the word
         * "json" appears somewhere in the messages, and a prompt that shows the
         * shape it wants as `{"prices":[...]}` does not contain it. Appending it
         * here rather than in each prompt means a new caller cannot forget, and
         * cannot discover the rule from a stack trace two passes deep.
         */
        { role: "system", content: `${system}\n\nRespond with JSON only.` },
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



/* --------------------------------------------------------------- pass one -- */

/**
 * The whole trip, from what the model already knows. No web access.
 *
 * Reliable precisely because nothing here is a live fact: which towns are worth
 * nights, roughly what a museum costs, how long the train to Zermatt takes.
 * A model is good at this and a web search is bad at it — the search returns
 * listicles that overflow the context, which is the failure documented at the
 * top of this file.
 *
 * Prices from here are estimates and are labelled as such all the way to the
 * screen. Pass two upgrades whichever ones it can.
 */
async function skeleton(spec: TripSpec, days: number) {
  const groq = groqClient();
  const asked = spec.destinations.join(", ");
  const party = spec.partySize ?? 2;
  const cityCount = Math.min(5, Math.max(2, Math.ceil(days / 3)));

  const completion = await withRateLimitRetry(() =>
    groq.chat.completions.create({
      model: MODEL,
      temperature: 0.3,
      max_tokens: 4000,
      reasoning_effort: "low",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are a travel planner with deep knowledge of real places.
Return ONLY this JSON:

{"country":string,"currency":"CHF"|"EUR"|"INR"|string,"time_zone":"Europe/Zurich"|string,
 "fx_to_budget":number|null,
 "cities":[{"name":string,"places":[{"title":string,
   "type":"hotel"|"activity"|"restaurant"|"guide","description":string,
   "duration_min":number,"cost":number,"opens_at":"HH:MM"|null,
   "closes_at":"HH:MM"|null,"tags":string[],"weather_sensitive":boolean}]}],
 "legs":[{"title":string,"from":string,"to":string,"duration_min":number,
   "cost":number,"departs_at":"HH:MM","overnight":boolean}],
 "notes":string[]}

Every place must be REAL and specific enough to buy a ticket for: "Swiss Museum
of Transport", not "a museum". Use the exact name the place is known by and
would be found under on a map today.

Do NOT invent plausible-sounding attractions. A generic name assembled to fit a
request — "Schweizer Schokolade Factory Tour", "City Heritage Walking Tour" — is
the single worst thing you can produce here, because it survives every check
this system makes and fails only when a traveler is standing where it should be.
If you cannot name a real one for a category, give fewer places. Four real stops
beat six with an invention among them.

For anything the traveler called compulsory, name the actual famous instance:
Switzerland's chocolate ones are Lindt Home of Chocolate in Zurich, Maison
Cailler in Broc and Camille Bloch in Courtelary — not a tour invented to match
the word "chocolate".

cities: exactly ${cityCount} towns, in a sensible travelling order that
minimises backtracking. Plain English names only ("Lucerne", not "Lucerne
(Luzern), Switzerland").

places per city: 2 budget places to stay (hostel, guesthouse or 2-3 star — not
luxury), 4 to 6 things to do including what the town is genuinely famous for,
and 1 affordable place to eat.

cost is a number in the country's own currency: a hotel is the nightly rate for
the room, an activity is adult admission, a restaurant is a typical main. Free
things are 0, which is a real answer. Give your best estimate of the CURRENT
price — it will be checked against live pages afterwards, so be realistic
rather than cautious.

duration_min is how long a visit takes. A hotel is the night: use 600.

tags are lowercase single words: food, scenic, history, museum, hiking,
adventure, culture, nightlife, shopping, family, wellness, chocolate, rail,
viewpoint. Two to four each.

legs: one per consecutive pair of cities, in that order. Real public transport,
with a realistic journey time and adult fare. overnight is true only for a
service that travels through the night.

fx_to_budget: how many ${spec.currency} one unit of the local currency buys.
Null if the local currency IS ${spec.currency}. Get the direction right: if
1 CHF is about 105 INR and the budget is in INR, this is 105, not 0.0095.

notes: seasonal warnings and money-saving facts for this specific period, one
sentence each.`,
        },
        {
          role: "user",
          content:
            `${days} days in ${asked} for ${party} ${party === 1 ? "person" : "people"}, ` +
            `${spec.startsOn ?? "soon"} to ${spec.endsOn ?? ""}.` +
            (spec.budget ? ` Total budget ${spec.budget} ${spec.currency}, so keep it affordable.` : "") +
            (spec.interests.length ? ` They are into: ${spec.interests.join(", ")}.` : "") +
            (spec.mustDo.length ? ` COMPULSORY, must appear: ${spec.mustDo.join("; ")}.` : "") +
            (spec.dietary.length ? ` Dietary: ${spec.dietary.join(", ")}.` : ""),
        },
      ],
    })
  );

  try {
    const parsed = JSON.parse(completion.choices[0]?.message?.content ?? "{}");
    const result = SkeletonSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/* --------------------------------------------------------------- pass two -- */

/**
 * How many price checks one trip is allowed.
 *
 * Each costs about 7,000 prompt tokens, and each may be retried twice, against
 * a 70,000-per-minute ceiling. Eight of them concurrently overran that window
 * and the retries then failed for want of budget rather than context — which is
 * how a run ended up verifying one price out of sixteen attempts.
 *
 * Five, paced, verifies more than eight in a hurry. They are also the five that
 * matter: the must-do and the expensive stops, where a wrong estimate actually
 * distorts the total.
 */
const MAX_PRICE_CHECKS = 5;

/**
 * One subject per query, and one query at a time.
 *
 * Two subjects means two searches, and two searches means twice the fetched
 * page text in a context that barely holds one lot. Measured against a fresh
 * organization with the budget untouched: the two-subject form verified 1 of 16
 * attempts and then 0 of 10, while the identical single-subject question
 * ("current adult price of the Gornergrat Railway return from Zermatt")
 * succeeded every time it was asked on its own, at around 7,900 prompt tokens.
 *
 * So this is slower and it works, which is the correct trade for a number that
 * ends up in front of a traveler. Concurrency is 1 for the same reason: the
 * failures were not independent, and two of these in flight took each other
 * down.
 */
const SUBJECTS_PER_CHECK = 1;

/**
 * How long to wait between price checks.
 *
 * One search costs about 7,500 tokens against a per-minute allowance of 8,000,
 * so the honest spacing is a minute. Fifty seconds leaves the window most of
 * the way refilled and keeps a five-check warm-up around four minutes.
 */
const PRICE_CHECK_SPACING_MS = 50_000;

/**
 * Which stops are worth spending a web search on.
 *
 * Not all of them, and not the cheapest. A wrong price on a 210-franc mountain
 * railway distorts the total and the budget warning; a wrong price on a 4-franc
 * coffee does not. So: anything answering a must-do first, because that is what
 * the traveler came for and the one they will check themselves; then by cost,
 * because that is where an estimate does the most damage.
 */
function worthChecking(
  places: ResearchedPlace[],
  mustDo: string[]
): ResearchedPlace[] {
  const wanted = mustDo.map((m) => m.toLowerCase());
  const score = (p: ResearchedPlace) => {
    const hay = `${p.title} ${p.description} ${p.tags.join(" ")}`.toLowerCase();
    const isMustDo = wanted.some((w) =>
      w.split(/\s+/).filter((t) => t.length > 3).some((t) => hay.includes(t))
    );
    return (isMustDo ? 1_000_000 : 0) + p.cost;
  };
  return [...places].sort((a, b) => score(b) - score(a));
}

/**
 * Check a couple of prices against live pages. Allowed to come back empty.
 *
 * Returns only what it could actually confirm, keyed by the title it was asked
 * about. Everything absent from the map keeps its estimate.
 */
async function verifyPrices(
  batch: ResearchedPlace[],
  currency: string
): Promise<{
  found: Map<string, { cost: number; sourceUrl: string | null }>;
  sources: { title: string; url: string }[];
}> {
  const found = new Map<string, { cost: number; sourceUrl: string | null }>();
  const sources: { title: string; url: string }[] = [];
  if (!batch.length) return { found, sources };

  const subjects = batch
    .map((p) => `${p.title}, ${p.city}${p.type === "hotel" ? ", nightly double room" : ", adult admission"}`)
    .join("; and ");

  const search = await trySearch(
    `Search the web: what is the current price in ${currency} of ${subjects}? ` +
      `Give the number and cite the page.`,
    /**
     * The last attempt is a shorter *question*, not keywords.
     *
     * It was `"<title> <city> ticket price"` for one run, on the theory that
     * less text means less fetched. That is backwards: a bare keyword string is
     * a discovery query, and discovery queries are precisely what return the
     * listicles and blog round-ups that overflow the context. A specific
     * question ending in "cite the page" steers the search at official pages,
     * which are the small ones. Shape matters here and length does not.
     */
    `Search the web: what does a ticket for ${batch[0].title} in ` +
      `${batch[0].city} cost? Cite the page.`
  );

  if (!search.brief.trim()) return { found, sources };
  sources.push(...search.sources);

  const structured = await structure(
    `Pull prices out of a research brief. Return ONLY:
{"prices":[{"title":string,"cost":number|null,"source_url":string|null}]}

title must be copied EXACTLY from this list, character for character:
${batch.map((p) => `- ${p.title}`).join("\n")}

cost is the number in ${currency}. Use null — not a guess, not a range, not a
number from a different attraction — when the brief does not clearly state a
price for that exact thing. A null leaves the planner's own estimate in place,
which is the correct outcome; a wrong number replaces a reasonable estimate
with a confident error.

source_url must be a URL that appears in the brief, or null. Never invent one.`,
    search.brief,
    PriceSchema
  );

  for (const row of structured?.prices ?? []) {
    const match = batch.find(
      (p) => p.title.toLowerCase() === row.title.trim().toLowerCase()
    );
    const cost = Number(row.cost);
    if (!match || !Number.isFinite(cost) || cost < 0) continue;
    // A verified price ten times the estimate is far more likely to be the
    // wrong row than a bargain missed. Reject the outliers rather than let one
    // mis-parsed table wreck the total.
    if (match.cost > 0 && (cost > match.cost * 8 || cost < match.cost / 8)) continue;
    found.set(match.title, { cost, sourceUrl: url(row.source_url) });
  }

  return { found, sources };
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
 * things that change what gets searched — where, how long, which month, what is
 * compulsory, and the currency the prices get converted to.
 *
 * Dates are reduced to a length rather than kept: the same twelve days in
 * October research identically whether they start on the 2nd or the 3rd. The
 * month is kept because "closed for the season" is a real answer.
 *
 * `interests` are deliberately NOT in here, and that is the one entry worth
 * explaining. They do steer the search a little, but they are drawn from the
 * catalogue's own tag list — which grows every time research adds rows. So the
 * same prompt, unchanged, fingerprints differently next week purely because the
 * catalogue learned the word "chocolate", and the cache misses for a reason
 * that has nothing to do with the trip. Interests matter far more when the
 * composer ranks stops than when the researcher looks for them, and a cache key
 * that drifts on its own is worse than one that is slightly too coarse.
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
      // A stored row is verified exactly when it kept the page it was read off.
      // `source_url` is only ever written for a price that was confirmed, so it
      // is the record of that, not a separate claim to keep in step.
      verified: Boolean(row.source_url),
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

export async function researchTrip(
  spec: TripSpec,
  /** Who asked. A research run happens before any trip exists, so this is the
   *  only thing that keeps it out of a stranger's reach — see the
   *  `runs_via_trip` policy. */
  travelerId?: string | null,
  options: {
    /** Skip both caches. For "the prices look stale, go and look again". */
    fresh?: boolean;
    /**
     * Check prices against live pages.
     *
     * Off by default, and that default is forced by a hard number rather than
     * chosen: `openai/gpt-oss-120b` allows 8,000 tokens per minute on the free
     * tier, `groq/compound-mini` runs on it, and one web search costs about
     * 7,500 of them. So the ceiling is roughly one search per minute, and five
     * price checks is a five-minute wait — which is fine for a script and
     * absurd for somebody watching a spinner.
     *
     * So verification is offline work. `npm run research:warm` turns it on,
     * takes as long as it takes, and writes the verified result to the cache;
     * every later request for that trip gets the citations for free. The
     * interactive path runs the skeleton alone, answers in about fifteen
     * seconds, and labels every price as an estimate — which is what it is.
     */
    verify?: boolean;
  } = {}
): Promise<ResearchResult> {
  const supabase = createAdminClient();

  /**
   * The cheapest research is the research you already did.
   *
   * Checked before the run row is even opened, so a hit costs one indexed
   * lookup and no tokens at all. This is what makes rehearsing, or two people
   * trying the same prompt, not cost a day's allowance each time.
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
        planner: MODEL,
        checker: RESEARCH_MODEL,
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

    /* ---- pass one: the trip, without the internet ---- */

    const plan = await skeleton(spec, days);
    if (!plan || !plan.cities.length) {
      throw new Error(
        "I could not work out an itinerary for that. Try naming the country, " +
          "or a few towns you already know you want."
      );
    }

    const currency = plan.currency.trim().toUpperCase().slice(0, 3) || spec.currency;

    const places: ResearchedPlace[] = plan.cities.flatMap((city) =>
      city.places.map(
        (p): ResearchedPlace => ({
          title: p.title.trim(),
          type: p.type,
          description: p.description.trim(),
          city: city.name.trim(),
          durationMin: clampDuration(p.duration_min, p.type),
          cost: Math.max(0, Number(p.cost) || 0),
          opensAt: clock(p.opens_at),
          closesAt: clock(p.closes_at),
          tags: (p.tags ?? []).map((t) => t.toLowerCase().trim()).filter(Boolean),
          sourceUrl: null,
          weatherSensitive: Boolean(p.weather_sensitive),
          verified: false,
        })
      )
    );

    const cities = plan.cities.map((c) => c.name.trim()).filter(Boolean);

    await step(1, "plan:skeleton", { days, cities: cities.length }, {
      places: places.length,
      legs: plan.legs.length,
      currency,
    });

    /* ---- pass two: check the prices that matter, best-effort ---- */

    const queue = options.verify
      ? worthChecking(places, spec.mustDo).slice(0, MAX_PRICE_CHECKS * SUBJECTS_PER_CHECK)
      : [];

    const batches: ResearchedPlace[][] = [];
    for (let i = 0; i < queue.length; i += SUBJECTS_PER_CHECK) {
      batches.push(queue.slice(i, i + SUBJECTS_PER_CHECK));
    }

    /**
     * Paced, not concurrent.
     *
     * The 8,000-per-minute ceiling means two searches in the same minute take
     * each other down — which is exactly what the earlier runs did, failing
     * fifteen checks out of sixteen while the identical queries succeeded when
     * asked alone. Waiting is the only thing that makes them work.
     */
    const checked: Awaited<ReturnType<typeof verifyPrices>>[] = [];
    for (const [i, batch] of batches.entries()) {
      if (i > 0) await new Promise((r) => setTimeout(r, PRICE_CHECK_SPACING_MS));
      checked.push(await verifyPrices(batch, currency));
    }

    const sources: { title: string; url: string }[] = [];
    let verifiedCount = 0;

    for (const { found, sources: got } of checked) {
      sources.push(...got);
      for (const place of places) {
        const hit = found.get(place.title);
        if (!hit) continue;
        place.cost = hit.cost;
        place.sourceUrl = hit.sourceUrl;
        place.verified = true;
        verifiedCount++;
      }
    }

    await step(2, "web:verify_prices", { attempted: queue.length }, {
      verified: verifiedCount,
      sources: sources.length,
    });

    /* ---- the exchange rate, which is a live fact worth one query ---- */

    let fxToBudget = fxRate(plan.fx_to_budget, currency, spec.currency);
    let fxVerified = false;

    if (options.verify && currency !== spec.currency) {
      await new Promise((r) => setTimeout(r, PRICE_CHECK_SPACING_MS));
      const fx = await trySearch(
        `Search the web: what is 1 ${currency} worth in ${spec.currency} today? Give the number.`,
        // A question, not keywords — same reason as the price fallback above.
        `Search the web: how many ${spec.currency} is one ${currency} today?`
      );
      if (fx.brief.trim()) {
        const found = await structure(
          `Return ONLY {"rate":number|null} — how many ${spec.currency} one ${currency} buys, ` +
            `as the brief states it. Null if it does not say.`,
          fx.brief,
          z.object({ rate: z.number().nullish() })
        );
        const live = fxRate(found?.rate, currency, spec.currency);
        if (live !== null) {
          fxToBudget = live;
          fxVerified = true;
          sources.push(...fx.sources);
        }
      }
    }

    /* ---- what came back ---- */

    const legs: ResearchedLeg[] = plan.legs
      .filter((l) => cities.includes(l.from) && cities.includes(l.to) && l.from !== l.to)
      .map((l) => ({
        title: l.title.trim(),
        from: l.from,
        to: l.to,
        durationMin: Math.min(Math.max(Math.round(l.duration_min) || 60, 15), 24 * 60),
        cost: Math.max(0, Number(l.cost) || 0),
        departsAt: clock(l.departs_at) ?? "09:00",
        overnight: Boolean(l.overnight),
        sourceUrl: null,
        verified: false,
      }));

    const result: ResearchResult = {
      cities,
      country: plan.country.trim(),
      currency,
      timeZone: plan.time_zone.trim() || "UTC",
      fxToBudget,
      fxVerified,
      places,
      legs,
      sources: dedupeSources(sources),
      notes: (plan.notes ?? []).map((n) => n.trim()).filter(Boolean),
      verifiedCount,
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
            verified: verifiedCount,
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
