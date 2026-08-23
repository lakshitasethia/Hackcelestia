import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";
import AppNav from "@/components/layout/AppNav";
import { getInterestTags, getOperators } from "@/lib/db/queries";
import { createTripAction } from "./actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Plan a trip" };

/** Every field the brief asks a traveler to define, in the order they think
 *  about them: where and when, who, how much, then what they actually like. */
export default async function PlanPage() {
  const [tags, operators] = await Promise.all([
    getInterestTags(),
    getOperators(),
  ]);

  const today = new Date().toISOString().slice(0, 10);
  const inAWeek = new Date(Date.now() + 6 * 86400_000).toISOString().slice(0, 10);

  const field =
    "w-full bg-transparent border border-line px-4 py-3 text-fg font-sans text-sm focus:outline-none focus:border-fg transition-colors placeholder:text-muted";
  const label =
    "font-display uppercase text-label tracking-label text-accent block mb-2";

  return (
    <main
      data-scroll-theme="dark"
      className="min-h-screen bg-surface text-fg selection:bg-fg selection:text-bg"
    >
      <AppNav />

      <div className="max-w-[110rem] mx-auto px-5 sm:px-8 lg:px-12 pt-28 pb-24">
        <span className="eyebrow">· New trip ·</span>
        <h1 className="font-display text-display-lg font-semibold uppercase text-fg text-balance max-w-3xl">
          Tell us what you want.
        </h1>
        <p className="mt-6 text-body-lg text-muted max-w-2xl">
          Nothing here is fixed. You will build the itinerary yourself from real
          inventory on the next screen, and change it whenever you like.
        </p>

        <form action={createTripAction} className="mt-14 max-w-3xl">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div className="sm:col-span-2">
              <label className={label} htmlFor="title">
                Trip name
              </label>
              <input
                id="title"
                name="title"
                required
                defaultValue="Amalfi Coast"
                className={field}
                placeholder="Where are you going?"
              />
            </div>

            <div>
              <label className={label} htmlFor="contactName">
                Lead traveler
              </label>
              <input id="contactName" name="contactName" required className={field} />
            </div>

            <div>
              <label className={label} htmlFor="contactEmail">
                Email (optional)
              </label>
              <input
                id="contactEmail"
                name="contactEmail"
                type="email"
                className={field}
              />
            </div>

            <div>
              <label className={label} htmlFor="startsOn">
                Arriving
              </label>
              <input
                id="startsOn"
                name="startsOn"
                type="date"
                required
                defaultValue={today}
                className={field}
              />
            </div>

            <div>
              <label className={label} htmlFor="endsOn">
                Leaving
              </label>
              <input
                id="endsOn"
                name="endsOn"
                type="date"
                required
                defaultValue={inAWeek}
                className={field}
              />
            </div>

            <div>
              <label className={label} htmlFor="partySize">
                Travelers
              </label>
              <input
                id="partySize"
                name="partySize"
                type="number"
                min={1}
                defaultValue={2}
                className={field}
              />
            </div>

            <div>
              <label className={label} htmlFor="budget">
                Budget (EUR, optional)
              </label>
              <input
                id="budget"
                name="budget"
                type="number"
                min={0}
                step={100}
                placeholder="4500"
                className={field}
              />
            </div>

            <div>
              <label className={label} htmlFor="pace">
                Pace
              </label>
              <select id="pace" name="pace" defaultValue="relaxed" className={field}>
                <option value="relaxed">Relaxed</option>
                <option value="moderate">Moderate</option>
                <option value="packed">Packed</option>
              </select>
            </div>

            <div>
              <label className={label} htmlFor="style">
                Style
              </label>
              <input
                id="style"
                name="style"
                placeholder="boutique, luxury, simple…"
                className={field}
              />
            </div>

            {operators.length > 0 && (
              <div className="sm:col-span-2">
                <label className={label} htmlFor="operatorId">
                  Operator
                </label>
                <select
                  id="operatorId"
                  name="operatorId"
                  defaultValue={operators[0].id}
                  className={field}
                >
                  {operators.map((operator) => (
                    <option key={operator.id} value={operator.id}>
                      {operator.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Tags come from the catalogue, so the options can never drift from
                what is actually bookable. */}
            {tags.length > 0 && (
              <fieldset className="sm:col-span-2">
                <legend className={label}>Interests</legend>
                <div className="flex flex-wrap gap-2">
                  {tags.map((tag) => (
                    <label
                      key={tag}
                      className="cursor-pointer font-sans text-xs uppercase tracking-wider border border-line px-3 py-2 text-muted hover:border-fg hover:text-fg transition-colors has-[:checked]:bg-fg has-[:checked]:text-bg has-[:checked]:border-fg"
                    >
                      <input
                        type="checkbox"
                        name="interests"
                        value={tag}
                        className="sr-only"
                      />
                      {tag}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}

            <div>
              <label className={label} htmlFor="dietary">
                Dietary (comma separated)
              </label>
              <input
                id="dietary"
                name="dietary"
                placeholder="vegetarian, no shellfish"
                className={field}
              />
            </div>

            <div>
              <label className={label} htmlFor="mobility">
                Mobility notes
              </label>
              <input
                id="mobility"
                name="mobility"
                placeholder="no steep climbs"
                className={field}
              />
            </div>
          </div>

          <button type="submit" className="btn-solid mt-10 px-8 py-4 text-sm tracking-wider group">
            <span>Build the itinerary</span>
            <ArrowRight className="w-4 h-4 ml-2 inline group-hover:translate-x-1 transition-transform" />
          </button>
        </form>
      </div>
    </main>
  );
}
