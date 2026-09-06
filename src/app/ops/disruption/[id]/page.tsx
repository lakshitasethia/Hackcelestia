import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft, Bot, Lock, Sparkles, User } from "lucide-react";
import AppNav from "@/components/layout/AppNav";
import LiveRefresh from "@/components/realtime/LiveRefresh";
import { assessDisruption } from "@/lib/disruption/engine";
import {
  getAgentRuns,
  getItems,
  getProposals,
  getVendorThread,
} from "@/lib/db/queries";
import TracePanel from "@/components/agent/TracePanel";
import ProposalCard from "@/components/agent/ProposalCard";
import { runAgentAction, recordVendorReplyAction } from "./actions";
import { formatDateLong, formatMoney, formatTime } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * Server actions run under the route they were called from, and a hosting
 * platform's default budget is written for a form post, not for the re-planner, which is the longest-running thing in the product.
 * Vercel's Hobby default is ten seconds and its ceiling is sixty; measured
 * runs here are 16-36s for a chat answer and around 50s for a full re-plan.
 * Without this the agent is killed mid-run and the user is told nothing useful.
 *
 * Sixty is the ceiling, not a comfortable margin. A slow re-plan can still
 * exceed it on a free model tier.
 */
export const maxDuration = 60;

export const metadata: Metadata = { title: "Impact assessment" };

export default async function DisruptionPage({
  params,
}: {
  params: { id: string };
}) {
  const assessment = await assessDisruption(params.id);
  if (!assessment) notFound();

  const [runs, proposals, allItems, thread] = await Promise.all([
    getAgentRuns(params.id),
    getProposals(params.id),
    getItems(assessment.disruption.trip_id),
    getVendorThread(`replan:${params.id}`),
  ]);
  const titleById = new Map(allItems.map((i) => [i.id, i.title]));
  const latestRun = runs[0] ?? null;

  const { disruption, root, affected, locked, exposure, sunk, candidates } =
    assessment;
  const downstream = affected.filter((i) => i.id !== root?.id);

  return (
    <main
      data-scroll-theme="dark"
      className="min-h-screen bg-surface text-fg selection:bg-fg selection:text-bg"
    >
      <AppNav />

      <div className="max-w-[110rem] mx-auto px-5 sm:px-8 lg:px-12 pt-28 pb-24">
        <header>
          <div className="flex items-center gap-4 flex-wrap mb-6">
            <span className="eyebrow flex items-center gap-2 !mb-0">
              <AlertTriangle className="w-3.5 h-3.5" />· {disruption.source} ·{" "}
              {disruption.severity} severity ·
            </span>
            <LiveRefresh tripIds={[disruption.trip_id]} />
          </div>
          <h1 className="font-display text-display-lg font-semibold uppercase text-fg text-balance max-w-4xl">
            {disruption.headline}
          </h1>
          {Object.keys(disruption.payload).length > 0 && (
            <ul className="mt-6 flex flex-wrap gap-2">
              {Object.entries(disruption.payload).map(([key, value]) => (
                <li
                  key={key}
                  className="font-sans text-xs uppercase tracking-wider text-muted border border-line px-2.5 py-1"
                >
                  {key.replace(/_/g, " ")}: {String(value)}
                </li>
              ))}
            </ul>
          )}
        </header>

        <section className="mt-10 border-y border-line py-8">
          <dl className="grid grid-cols-2 lg:grid-cols-4 gap-x-8 gap-y-8">
            {[
              {
                label: "Items affected",
                value: String(affected.length),
                note: `${downstream.length} downstream of the cause`,
              },
              {
                label: "Value exposed",
                value: formatMoney(exposure),
                note: "total across affected items",
              },
              {
                // The number that stops a naive "just cancel it" answer.
                label: "Non-refundable",
                value: formatMoney(sunk),
                note: "lost if these are simply dropped",
              },
              {
                label: "Replacements found",
                value: String(candidates.length),
                note:
                  disruption.source === "weather"
                    ? "weather-proof options only"
                    : "available in the same window",
              },
            ].map((stat) => (
              <div key={stat.label}>
                <dt className="font-display uppercase text-label tracking-label text-accent">
                  {stat.label}
                </dt>
                <dd className="mt-2 font-display text-2xl sm:text-3xl font-semibold uppercase tracking-tight text-fg tabular-nums">
                  {stat.value}
                </dd>
                <dd className="mt-1 font-sans text-xs text-muted">{stat.note}</dd>
              </div>
            ))}
          </dl>
        </section>

        <div className="mt-14 grid grid-cols-1 xl:grid-cols-12 gap-12">
          {/* The blast radius, laid out by hop distance. Indentation carries the
              dependency depth, so it reads as a chain rather than a list — this
              is the "identify impact" the brief asks for, made visible. */}
          <section className="xl:col-span-7">
            <h2 className="font-display text-display-sm font-semibold uppercase text-fg">
              Blast radius
            </h2>
            <p className="mt-2 font-sans text-xs uppercase tracking-wider text-muted">
              Traversed from the cause through {""}
              {Math.max(...affected.map((i) => i.depth), 0)} levels of dependency
            </p>

            <ol className="mt-6 flex flex-col gap-3">
              {affected.map((item) => (
                <li
                  key={item.id}
                  style={{ marginLeft: `${item.depth * 1.5}rem` }}
                  className={`surface p-4 ${
                    item.depth === 0 ? "border-accent" : ""
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <span className="font-sans text-xs uppercase tracking-wider text-muted">
                        {item.depth === 0
                          ? "Cause"
                          : `${item.depth} hop${item.depth > 1 ? "s" : ""} downstream`}
                      </span>
                      <h3 className="font-display text-base font-semibold uppercase text-fg mt-0.5">
                        {item.title}
                      </h3>
                      <p className="font-sans text-xs text-muted mt-1">
                        {formatDateLong(item.starts_at)} ·{" "}
                        {formatTime(item.starts_at)}
                      </p>
                      {item.lock_reason && (
                        <p className="mt-2 flex items-center gap-1.5 font-sans text-xs text-accent">
                          <Lock className="w-3 h-3 shrink-0" />
                          {item.lock_reason}
                        </p>
                      )}
                    </div>
                    <span className="font-display text-base font-semibold text-fg tabular-nums shrink-0">
                      {formatMoney(Number(item.cost))}
                    </span>
                  </div>
                </li>
              ))}
            </ol>

            {locked.length > 0 && (
              <p className="mt-6 font-sans text-xs text-muted border-l-2 border-accent pl-4">
                {locked.length} affected {locked.length === 1 ? "item is" : "items are"}{" "}
                locked and cannot be moved. Any re-plan has to work around{" "}
                {locked.length === 1 ? "it" : "them"}.
              </p>
            )}
          </section>

          <section className="xl:col-span-5">
            <h2 className="font-display text-display-sm font-semibold uppercase text-fg">
              Candidate replacements
            </h2>
            <p className="mt-2 font-sans text-xs uppercase tracking-wider text-muted">
              {disruption.source === "weather"
                ? "Weather-sensitive options excluded"
                : "Same-day availability"}
            </p>

            {candidates.length === 0 ? (
              <p className="mt-6 text-muted">
                Nothing available that survives this disruption.
              </p>
            ) : (
              <ul className="mt-6 flex flex-col gap-3">
                {candidates.map((candidate) => (
                  <li key={candidate.inventory.id} className="surface p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <h3 className="font-display text-base font-semibold uppercase text-fg">
                          {candidate.inventory.title}
                        </h3>
                        <p className="font-sans text-xs text-muted mt-1 flex items-center gap-1.5">
                          {candidate.channel === "auto" ? (
                            <Bot className="w-3 h-3" />
                          ) : (
                            <User className="w-3 h-3" />
                          )}
                          {candidate.vendorName}
                        </p>
                        <p className="font-sans text-xs text-muted mt-1 tabular-nums">
                          {formatTime(candidate.startsAt)}
                          {candidate.distanceKm !== null &&
                            ` · ${candidate.distanceKm} km away`}
                          {` · ${candidate.slotsFree} free`}
                        </p>
                      </div>
                      <span className="font-display text-base font-semibold text-fg tabular-nums shrink-0">
                        {formatMoney(candidate.price)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {/* Everything above this line is deterministic. The agent starts
                here, and it only ever writes drafts. */}
            <div className="mt-8 border border-line p-5">
              <h3 className="font-sans text-xs uppercase tracking-wider font-bold text-accent">
                Re-planner
              </h3>
              <p className="mt-2 font-sans text-sm text-muted leading-relaxed">
                Impact and options above are computed deterministically — graph
                traversal and availability, no model. The agent reads exactly
                that, calls the same tools, and proposes plans for you to accept.
                It cannot change a booking on its own.
              </p>

              {assessment.disruption.state === "open" && (
                <form action={runAgentAction} className="mt-4">
                  <input type="hidden" name="disruptionId" value={assessment.disruption.id} />
                  <input type="hidden" name="tripId" value={assessment.disruption.trip_id} />
                  <button type="submit" className="btn-solid px-6 py-3 text-xs tracking-wider">
                    <Sparkles className="w-3.5 h-3.5 mr-2 inline" />
                    {runs.length > 0 ? "Run again" : "Run the re-planner"}
                  </button>
                </form>
              )}
            </div>
          </section>
        </div>

        {(proposals.length > 0 || latestRun) && (
          <div className="mt-16 grid grid-cols-1 xl:grid-cols-12 gap-12">
            <section className="xl:col-span-7">
              <h2 className="font-display text-display-sm font-semibold uppercase text-fg">
                Proposed plans
              </h2>
              <p className="mt-2 font-sans text-xs uppercase tracking-wider text-muted">
                Drafts — nothing is booked until you accept one
              </p>

              {proposals.length === 0 ? (
                <p className="mt-6 text-muted">
                  The agent has not proposed anything yet.
                </p>
              ) : (
                <div className="mt-6 flex flex-col gap-4">
                  {proposals.map((proposal) => (
                    <ProposalCard
                      key={proposal.id}
                      proposal={proposal}
                      titleById={titleById}
                      disruptionId={assessment.disruption.id}
                    />
                  ))}
                </div>
              )}
            </section>

            <div className="xl:col-span-5">
              {latestRun && <TracePanel run={latestRun} />}
            </div>
          </div>
        )}

        {/* The supplier's side of it.
            `check_vendor` has always written the outbound half; this is where
            the answer comes back. Pasting is the honest prototype of an inbox —
            the work worth showing is not receiving a message, it is turning
            "not at 9, but we could do 2" into a proposal somebody can accept. */}
        <section className="mt-16 border-t border-line pt-10">
          <h2 className="font-display text-display-sm font-semibold uppercase text-fg">
            Supplier thread
          </h2>
          <p className="mt-2 font-sans text-xs uppercase tracking-wider text-muted">
            What the agent asked, and what came back
          </p>

          <div className="mt-6 grid grid-cols-1 xl:grid-cols-12 gap-10">
            <div className="xl:col-span-7 flex flex-col gap-3">
              {thread.length === 0 ? (
                <p className="font-sans text-sm text-muted">
                  Nothing sent yet. The re-planner writes here when it checks a
                  supplier&rsquo;s availability.
                </p>
              ) : (
                thread.map((message) => {
                  const parsed = message.structured as {
                    alternativeTime?: string | null;
                    canAccommodate?: boolean | null;
                    conditions?: string[];
                    maxPartySize?: number | null;
                    price?: number | null;
                  } | null;
                  const inbound = message.direction === "inbound";

                  return (
                    <div
                      key={message.id}
                      className={`surface p-4 ${inbound ? "xl:ml-10" : "xl:mr-10"}`}
                    >
                      <p className="font-sans text-xs uppercase tracking-wider text-muted flex items-center gap-2">
                        {inbound ? (
                          <User className="w-3.5 h-3.5" />
                        ) : (
                          <Bot className="w-3.5 h-3.5" />
                        )}
                        {inbound
                          ? message.vendors?.name ?? "Supplier"
                          : "Voyage"}
                        <span className="ml-auto tabular-nums">
                          {formatTime(message.sent_at)}
                        </span>
                      </p>
                      <p className="mt-2 font-sans text-sm text-fg">
                        {message.body}
                      </p>

                      {inbound && parsed && (
                        <p className="mt-3 pt-3 border-t border-line font-sans text-xs text-muted">
                          <span className="uppercase tracking-wider">Read as</span>{" "}
                          {parsed.canAccommodate === true
                            ? "can take it"
                            : parsed.canAccommodate === false
                              ? "cannot take the time asked"
                              : "no clear yes or no"}
                          {parsed.alternativeTime
                            ? ` · offers ${parsed.alternativeTime}`
                            : ""}
                          {parsed.price !== null && parsed.price !== undefined
                            ? ` · quoted ${parsed.price}`
                            : ""}
                          {parsed.maxPartySize
                            ? ` · max ${parsed.maxPartySize}`
                            : ""}
                          {(parsed.conditions ?? []).length > 0
                            ? ` · ${(parsed.conditions ?? []).join("; ")}`
                            : ""}
                        </p>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            <form
              action={recordVendorReplyAction}
              className="xl:col-span-5 surface p-4 flex flex-col gap-3 self-start"
            >
              <input type="hidden" name="disruptionId" value={disruption.id} />
              <input type="hidden" name="tripId" value={disruption.trip_id} />

              <label className="font-sans text-xs uppercase tracking-wider text-muted">
                Log a reply
              </label>

              <select
                name="itemId"
                defaultValue={root?.id ?? ""}
                aria-label="Which stop the reply is about"
                className="bg-transparent border border-line px-3 py-2 text-fg font-sans text-xs focus:outline-none focus:border-fg transition-colors"
              >
                <option value="">Not about a particular stop</option>
                {affected.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title} · {formatTime(item.starts_at)}
                  </option>
                ))}
              </select>

              <textarea
                name="body"
                required
                rows={4}
                placeholder={'e.g. "sorry, 9 is gone — we could do 2pm, same price, but only 6 people"'}
                aria-label="What the supplier wrote"
                className="bg-transparent border border-line px-3 py-2 text-fg font-sans text-xs focus:outline-none focus:border-fg transition-colors"
              />

              <button
                type="submit"
                className="border border-line px-3 py-2 font-sans text-xs uppercase tracking-wider font-bold text-muted hover:text-fg hover:border-fg transition-colors"
              >
                Read it
              </button>

              <p className="font-sans text-xs text-muted">
                If it changes the plan, it appears above as a proposal you can
                accept. Nothing is booked by reading a message.
              </p>
            </form>
          </div>
        </section>

        <div className="mt-20 pt-8 border-t border-line flex flex-wrap gap-6 justify-between">
          <Link href="/ops" className="link-underline">
            <ArrowLeft className="w-4 h-4" />
            <span>Operations board</span>
          </Link>
          <Link href={`/trip/${disruption.trip_id}`} className="link-underline">
            <span>See it from the traveler&rsquo;s side</span>
          </Link>
        </div>
      </div>
    </main>
  );
}
