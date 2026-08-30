import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft, Bot, Lock, Sparkles, User } from "lucide-react";
import AppNav from "@/components/layout/AppNav";
import LiveRefresh from "@/components/realtime/LiveRefresh";
import { assessDisruption } from "@/lib/disruption/engine";
import { getAgentRuns, getItems, getProposals } from "@/lib/db/queries";
import TracePanel from "@/components/agent/TracePanel";
import ProposalCard from "@/components/agent/ProposalCard";
import { runAgentAction } from "./actions";
import { formatDateLong, formatMoney, formatTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Impact assessment" };

export default async function DisruptionPage({
  params,
}: {
  params: { id: string };
}) {
  const assessment = await assessDisruption(params.id);
  if (!assessment) notFound();

  const [runs, proposals, allItems] = await Promise.all([
    getAgentRuns(params.id),
    getProposals(params.id),
    getItems(assessment.disruption.trip_id),
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
