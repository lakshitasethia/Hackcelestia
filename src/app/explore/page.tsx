import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Search } from "lucide-react";
import AppNav from "@/components/layout/AppNav";
import { getInventory } from "@/lib/db/queries";
import { formatMoney } from "@/lib/format";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Explore" };

/**
 * Discover — the first stage in the brief, and the one with no screen.
 *
 * PS-7 asks that travelers "explore destinations and experiences" before they
 * commit to anything. Until now the only way to see what existed was to create
 * a trip first and look at the builder's sidebar, which is the wrong order:
 * you had to decide where you were going in order to find out what was there.
 *
 * Deliberately not a search engine. It is the catalogue, grouped by town, with
 * three filters that map to how someone actually narrows a list — where, what
 * kind of thing, and how much. Filtering happens in the URL rather than in
 * client state, so a filtered view is a link somebody can send to the person
 * they are travelling with.
 */
export default async function ExplorePage({
  searchParams,
}: {
  searchParams: { city?: string; type?: string; tag?: string; max?: string };
}) {
  const inventory = await getInventory();

  const cities = [
    ...new Set(inventory.map((i) => i.city).filter((c): c is string => Boolean(c))),
  ].sort();
  const types = [...new Set(inventory.map((i) => i.type))].sort();
  const tags = [...new Set(inventory.flatMap((i) => i.tags ?? []))].sort();

  const max = Number(searchParams.max || 0);

  const shown = inventory.filter((item) => {
    if (searchParams.city && item.city !== searchParams.city) return false;
    if (searchParams.type && item.type !== searchParams.type) return false;
    if (searchParams.tag && !(item.tags ?? []).includes(searchParams.tag)) {
      return false;
    }
    if (max > 0 && Number(item.base_cost) > max) return false;
    // Legs between towns are inventory too, and they are not an experience
    // anyone browses for. They belong to the route, not to the destination.
    return item.type !== "transport";
  });

  const byCity = new Map<string, typeof shown>();
  for (const item of shown) {
    const key = item.city ?? "Elsewhere";
    if (!byCity.has(key)) byCity.set(key, []);
    byCity.get(key)!.push(item);
  }

  const filtered = Boolean(
    searchParams.city || searchParams.type || searchParams.tag || max > 0
  );

  const chip =
    "font-sans text-xs uppercase tracking-wider border px-3 py-2 transition-colors";
  const on = "bg-fg text-bg border-fg font-bold";
  const off = "border-line text-muted hover:text-fg hover:border-fg";

  /** Toggling: pressing the active value clears it, which is what a chip that
   *  looks pressed is expected to do. */
  const href = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    const merged = { ...searchParams, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) next.set(k, v);
    const qs = next.toString();
    return qs ? `/explore?${qs}` : "/explore";
  };

  return (
    <main
      data-scroll-theme="dark"
      className="min-h-screen bg-surface text-fg selection:bg-fg selection:text-bg"
    >
      <AppNav />

      <div className="max-w-[110rem] mx-auto px-5 sm:px-8 lg:px-12 pt-28 pb-24">
        <span className="eyebrow">· Discover ·</span>
        <h1 className="font-display text-display-lg font-semibold uppercase text-fg text-balance max-w-3xl">
          What is out there.
        </h1>
        <p className="mt-6 text-body-lg text-muted max-w-2xl">
          Everything bookable, by town. Nothing here commits you to anything.
          When you have a shape in mind, plan the trip and these are the stops
          it is built from.
        </p>

        {/* -------------------------------------------------- filters -- */}

        <div className="mt-12 flex flex-col gap-5">
          <div>
            <span className="font-display uppercase text-label tracking-label text-accent block mb-3">
              Where
            </span>
            <div className="flex flex-wrap gap-2">
              {cities.map((city) => (
                <Link
                  key={city}
                  href={href({ city: searchParams.city === city ? undefined : city })}
                  className={`${chip} ${searchParams.city === city ? on : off}`}
                >
                  {city}
                </Link>
              ))}
            </div>
          </div>

          <div>
            <span className="font-display uppercase text-label tracking-label text-accent block mb-3">
              What kind
            </span>
            <div className="flex flex-wrap gap-2">
              {types
                .filter((t) => t !== "transport")
                .map((type) => (
                  <Link
                    key={type}
                    href={href({ type: searchParams.type === type ? undefined : type })}
                    className={`${chip} ${searchParams.type === type ? on : off}`}
                  >
                    {type}
                  </Link>
                ))}
            </div>
          </div>

          <div>
            <span className="font-display uppercase text-label tracking-label text-accent block mb-3">
              Interests
            </span>
            <div className="flex flex-wrap gap-2">
              {tags.map((tag) => (
                <Link
                  key={tag}
                  href={href({ tag: searchParams.tag === tag ? undefined : tag })}
                  className={`${chip} ${searchParams.tag === tag ? on : off}`}
                >
                  {tag}
                </Link>
              ))}
            </div>
          </div>

          {filtered && (
            <Link
              href="/explore"
              className="font-sans text-xs uppercase tracking-wider text-accent hover:text-fg transition-colors self-start"
            >
              Clear all filters
            </Link>
          )}
        </div>

        {/* --------------------------------------------------- results -- */}

        <p className="mt-12 font-sans text-sm text-muted flex items-center gap-2">
          <Search className="w-4 h-4" />
          {shown.length} {shown.length === 1 ? "thing" : "things"} to do
          {searchParams.city && ` in ${searchParams.city}`}
          {byCity.size > 1 && ` across ${byCity.size} towns`}
        </p>

        {shown.length === 0 ? (
          <p className="mt-8 text-body-lg text-muted max-w-2xl">
            Nothing matches all of those at once. Clear a filter, or describe
            the trip you want on the planner — it searches the web for places
            the catalogue has never heard of.
          </p>
        ) : (
          <div className="mt-8 flex flex-col gap-16">
            {[...byCity]
              .sort((a, b) => a[0].localeCompare(b[0]))
              .map(([city, list]) => (
                <section key={city}>
                  <h2 className="font-display text-display-sm font-semibold uppercase text-fg border-b border-line pb-3">
                    {city}
                    <span className="ml-3 font-sans text-xs uppercase tracking-wider text-muted">
                      {list.length} {list.length === 1 ? "option" : "options"}
                    </span>
                  </h2>

                  <ul className="mt-6 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {list
                      .sort((a, b) => Number(a.base_cost) - Number(b.base_cost))
                      .map((item) => (
                        <li key={item.id} className="surface p-5 flex flex-col">
                          <div className="flex items-start justify-between gap-3">
                            <h3 className="font-display text-base font-semibold uppercase text-fg">
                              {item.title}
                            </h3>
                            <span className="font-display font-semibold text-fg tabular-nums shrink-0">
                              {formatMoney(Number(item.base_cost), "INR")}
                            </span>
                          </div>

                          <p className="font-sans text-xs text-muted mt-1">
                            {item.vendors?.name} · {item.type} ·{" "}
                            {item.duration_min} min
                            {item.tier && ` · ${item.tier}`}
                          </p>

                          {item.description && (
                            <p className="font-sans text-sm text-muted mt-3 flex-1">
                              {item.description}
                            </p>
                          )}

                          {(item.tags ?? []).length > 0 && (
                            <p className="font-sans text-xs text-muted mt-3">
                              {(item.tags ?? []).join(" · ")}
                            </p>
                          )}

                          {/* Honest about what a researched row is: a price
                              read off a web page, not a seat somebody holds. */}
                          {item.provisional && (
                            <p className="font-sans text-xs text-accent mt-2">
                              Found on the web: price is an estimate until an
                              operator confirms it.
                            </p>
                          )}
                        </li>
                      ))}
                  </ul>
                </section>
              ))}
          </div>
        )}

        <div className="mt-20 pt-8 border-t border-line flex flex-wrap items-center justify-between gap-6">
          <p className="font-sans text-sm text-muted max-w-xl">
            Seen enough? Describe the trip and the planner will build an
            itinerary out of these, or anywhere else in the world.
          </p>
          <Link href="/plan" className="btn-solid px-6 py-3 text-xs tracking-wider group">
            <span>Plan a trip</span>
            <ArrowRight className="w-4 h-4 ml-2 inline group-hover:translate-x-1 transition-transform" />
          </Link>
        </div>
      </div>
    </main>
  );
}
