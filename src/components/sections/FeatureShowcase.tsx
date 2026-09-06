"use client";

import { useState } from "react";
import Photo from "@/components/ui/Photo";
import { ArrowRight, Plane, Hotel, Utensils, Sailboat, AlertCircle, CheckCircle2, RefreshCw, Zap, ShieldCheck } from "lucide-react";

export default function FeatureShowcase() {
  // State for the interactive Flagship "Adapt on the Fly" dependency graph simulator
  const [delayTriggered, setDelayTriggered] = useState(false);

  return (
    <section id="features" data-scroll-theme="tan" className="py-20 sm:py-28 border-b border-line">
      <div className="max-w-[110rem] mx-auto px-5 sm:px-8 lg:px-12 flex flex-col gap-24 sm:gap-32">
        
        {/* Section Header — the statement holds the left, an index of what
            follows holds the right, so the full-width container does not run
            empty on wide screens. */}
        <div
          data-reveal
          className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16 items-end"
        >
          <div className="lg:col-span-7">
            <span className="eyebrow">· CAPABILITIES ·</span>
            <h2 className="font-display text-display-lg font-semibold uppercase text-fg">
              Designed for granular control, engineered for effortless flow.
            </h2>
            <p className="mt-6 text-body-lg text-muted max-w-2xl">
              Four architectural decisions separate a Voyage itinerary from a fixed
              agency package: modular components, visible trade-offs, supplier-rate
              pricing, and a plan that repairs itself.
            </p>
          </div>

          {/* Index of the four capabilities detailed below. */}
          <ol className="lg:col-span-5 lg:pl-12 lg:border-l border-line divide-y divide-line">
            {[
              {
                n: "01",
                name: "Modular planning",
                note: "Start blank or from a blueprint, then swap any single component.",
              },
              {
                n: "02",
                name: "Transparent decisions",
                note: "Compare stays side by side with live price deltas, not brochures.",
              },
              {
                n: "03",
                name: "Zero black box",
                note: "Every line itemised at the rate the supplier actually quoted.",
              },
              {
                n: "04",
                name: "Adapt on the fly",
                note: "One disruption re-routes every downstream booking automatically.",
                flagship: true,
              },
            ].map((item) => (
              <li key={item.n} className="flex gap-5 py-5 first:pt-0 last:pb-0">
                <span className="font-display text-label tracking-label text-muted pt-1 shrink-0">
                  {item.n}
                </span>
                <div>
                  <span className="font-display uppercase text-label tracking-label text-fg">
                    {item.name}
                    {item.flagship && (
                      <span className="ml-3 text-accent normal-case">(flagship)</span>
                    )}
                  </span>
                  <p className="mt-2 text-sm text-muted leading-relaxed">{item.note}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>

        {/* Feature 1: Build your own itinerary (Image Left, Text Right) */}
        <div data-reveal className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center">
          <div className="lg:col-span-7">
            <div className="surface overflow-hidden relative group">
              <div className="relative h-[340px] sm:h-[440px] w-full">
                <Photo
                  src="/images/feature_planning_laptop.jpg"
                  alt="Travelers planning custom itinerary"
                  fill
                  className="object-cover group-hover:scale-105 transition-transform duration-500"
                  sizes="(max-width: 1024px) 100vw, 60vw"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent" />
                <div className="absolute bottom-4 left-4 right-4 bg-surface border border-line p-3 backdrop-blur-sm flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-fg" />
                    <span className="font-sans text-xs font-bold uppercase text-fg">Modular Component Builder</span>
                  </div>
                  <span className="font-sans text-xs font-bold text-muted bg-surface border border-line px-2 py-0.5">
                    Drag & Drop Ready
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="lg:col-span-5 flex flex-col justify-center">
            <span className="font-sans text-xs font-bold uppercase tracking-widest text-accent mb-2">
              01 / MODULAR PLANNING
            </span>
            <h3 className="font-display text-display-md font-semibold uppercase text-fg mb-4">
              Build your own itinerary without rigid package locks.
            </h3>
            <p className="text-base text-muted leading-relaxed mb-6 font-medium">
              Start with a blank canvas or a curated baseline. Mix luxury boutique villas with hidden local izakayas, swap morning hikes for museum passes, and control the exact pace of every single day.
            </p>
            <a
              href="#how-it-works"
              className="inline-flex items-center gap-2 font-sans text-xs uppercase font-bold text-accent hover:text-fg transition-colors group"
            >
              <span className="border-b border-line pb-0.5 group-hover:border-line">
                Explore day-by-day builder
              </span>
              <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
            </a>
          </div>
        </div>

        {/* Feature 2: Compare before you commit (Text Left, Image Right) */}
        <div data-reveal className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center">
          <div className="lg:col-span-5 order-2 lg:order-1 flex flex-col justify-center">
            <span className="font-sans text-xs font-bold uppercase tracking-widest text-muted mb-2">
              02 / TRANSPARENT DECISION MAKING
            </span>
            <h3 className="font-display text-display-md font-semibold uppercase text-fg mb-4">
              Compare before you commit side-by-side.
            </h3>
            <p className="text-base text-muted leading-relaxed mb-6 font-medium">
              Torn between a cliffside plunge pool suite in Oia versus a historic cave villa in Imerovigli? Compare verified amenities, live price deltas, cancellation policies, and transit times in a single unified view.
            </p>
            <a
              href="#destinations"
              className="inline-flex items-center gap-2 font-sans text-xs uppercase font-bold text-muted hover:text-fg transition-colors group"
            >
              <span className="border-b border-line pb-0.5 group-hover:border-line">
                Compare verified stays & activities
              </span>
              <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
            </a>
          </div>

          <div className="lg:col-span-7 order-1 lg:order-2">
            <div className="surface p-4 relative">
              <div className="grid grid-cols-2 gap-3 sm:gap-4">
                {/* Option A */}
                <div className="border border-line bg-surface p-3 sm:p-4 relative">
                  <div className="relative h-32 sm:h-44 w-full mb-3 border border-line overflow-hidden">
                    <Photo
                      src="/images/feature_compare_suite.jpg"
                      alt="Luxury Resort Suite"
                      fill
                      className="object-cover"
                      sizes="(max-width: 1024px) 50vw, 25vw"
                    />
                  </div>
                  <span className="font-sans text-xs font-bold text-bg bg-fg border border-line px-1.5 py-0.5">
                    Option A · Suite
                  </span>
                  <h4 className="font-display font-bold text-sm sm:text-base text-fg mt-1.5">
                    Canaves Oia Suites
                  </h4>
                  <div className="mt-2 font-sans text-xs font-bold text-fg">
                    $620 <span className="text-xs font-normal text-muted">/ night</span>
                  </div>
                </div>

                {/* Option B */}
                <div className="border border-line bg-surface p-3 sm:p-4 relative">
                  <div className="relative h-32 sm:h-44 w-full mb-3 border border-line overflow-hidden">
                    <Photo
                      src="/images/feature_compare_cave.jpg"
                      alt="Boutique Cave Hotel"
                      fill
                      className="object-cover"
                      sizes="(max-width: 1024px) 50vw, 25vw"
                    />
                  </div>
                  <span className="font-sans text-xs font-bold text-muted bg-surface border border-line px-1.5 py-0.5">
                    Option B · Cave Villa
                  </span>
                  <h4 className="font-display font-bold text-sm sm:text-base text-fg mt-1.5">
                    Grace Hotel Imerovigli
                  </h4>
                  <div className="mt-2 font-sans text-xs font-bold text-fg">
                    $510 <span className="text-xs font-normal text-muted">/ night</span>
                  </div>
                </div>
              </div>

              {/* Side by side comparison bar */}
              <div className="mt-4 bg-surface border border-line p-3 flex items-center justify-between text-xs font-sans">
                <span className="text-muted font-bold">Delta: -$110/night for Option B</span>
                <span className="text-accent font-bold flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Instant Substitution
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Feature 3: Live Transparent Pricing (Image Left, Text Right) */}
        <div data-reveal className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center">
          <div className="lg:col-span-7">
            <div className="surface p-6 sm:p-8">
              <div className="flex items-center justify-between border-b border-line pb-4 mb-4">
                <div>
                  <span className="font-sans text-xs font-bold text-accent uppercase tracking-wider">
                    Real-Time Ledger
                  </span>
                  <h4 className="font-display text-xl sm:text-2xl font-bold text-fg">
                    Itemized Cost Breakdown
                  </h4>
                </div>
                <div className="text-right">
                  <span className="font-sans text-xs text-muted uppercase">Net Guaranteed</span>
                  <div className="font-sans text-xl sm:text-2xl font-black text-accent">$4,280.00</div>
                </div>
              </div>

              {/* Line item rows */}
              <div className="space-y-3 font-sans text-xs">
                <div className="flex justify-between items-center py-1.5 border-b border-line">
                  <span className="text-fg font-medium">3x Nights · Cliffside Grand Suite</span>
                  <span className="font-bold text-fg">$1,620.00</span>
                </div>
                <div className="flex justify-between items-center py-1.5 border-b border-line">
                  <span className="text-fg font-medium">1x Private Riva 38ft Capri Charter (Full Day)</span>
                  <span className="font-bold text-fg">$680.00</span>
                </div>
                <div className="flex justify-between items-center py-1.5 border-b border-line">
                  <span className="text-fg font-medium">2x Roundtrip Business Heli Transfers (Naples ↔ Positano)</span>
                  <span className="font-bold text-fg">$1,400.00</span>
                </div>
                <div className="flex justify-between items-center py-1.5 border-b border-line">
                  <span className="text-fg font-medium">1x Sommelier Guided Vineyard Dinner</span>
                  <span className="font-bold text-fg">$580.00</span>
                </div>
                <div className="flex justify-between items-center py-1.5 text-muted font-bold bg-surface px-2">
                  <span>Voyage Dynamic Engine Fee & Real-time Support</span>
                  <span className="text-accent">INCLUDED ($0)</span>
                </div>
              </div>
            </div>
          </div>

          <div className="lg:col-span-5 flex flex-col justify-center">
            <span className="font-sans text-xs font-bold uppercase tracking-widest text-accent mb-2">
              03 / ZERO BLACK BOX
            </span>
            <h3 className="font-display text-display-md font-semibold uppercase text-fg mb-4">
              Live, transparent pricing as you build.
            </h3>
            <p className="text-base text-muted leading-relaxed mb-6 font-medium">
              Traditional tour agencies lump everything into an opaque bundled number with 25–40% hidden margins. On Voyage, every hotel night, private guide, and helicopter transfer is priced directly at wholesale live cost.
            </p>
            <div className="flex items-center gap-3 text-xs font-sans text-muted">
              <ShieldCheck className="w-4 h-4 text-accent" />
              <span>Real-time price freeze for 48 hours upon hold</span>
            </div>
          </div>
        </div>

        {/* Feature 4 (FLAGSHIP FEATURE): Adapt on the fly — Constellation Dependency Graph Simulator */}
        <div className="surface text-fg p-6 sm:p-10 lg:p-12 relative overflow-hidden border border-line">
          {/* Subtle starfield background */}
          <div className="absolute inset-0 pointer-events-none opacity-30">
            <div className="absolute top-12 left-1/4 w-2 h-2 rounded-full bg-fg animate-twinkle" />
            <div className="absolute bottom-16 right-1/3 w-1.5 h-1.5 rounded-full bg-fg animate-twinkle" />
          </div>

          <div data-reveal className="relative z-10 grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center">
            <div className="lg:col-span-5">
              <div className="inline-flex items-center gap-2 px-3 py-1 bg-surface border border-line mb-4 text-accent font-sans text-xs font-bold tracking-widest uppercase">
                <Zap className="w-3.5 h-3.5 text-accent" />
                Flagship Differentiator
              </div>
              <h3 className="font-display text-display-lg font-semibold uppercase text-fg mb-4">
                Adapt on the fly when reality happens.
              </h3>
              <p className="text-base text-muted leading-relaxed mb-6 font-medium">
                Flights get delayed, typhoons roll in, mountain passes close. Rather than ruining your trip or leaving you stranded on phone trees, Voyage’s dependency engine automatically calculates downstream impacts and reschedules affected bookings in seconds.
              </p>

              {/* Interactive Simulator Trigger */}
              <div className="bg-surface border border-line p-4 mb-6">
                <span className="font-sans text-xs font-bold text-accent uppercase tracking-wider block mb-2">
                  Try the Live Adaptation Simulator:
                </span>
                <button
                  onClick={() => setDelayTriggered(!delayTriggered)}
                  className={`btn-solid w-full py-3 text-xs tracking-wider font-bold transition-all flex items-center justify-center gap-2 ${
 delayTriggered ? "bg-fg hover:bg-fg" : "bg-fg"
 }`}
                >
                  <RefreshCw className={`w-4 h-4 ${delayTriggered ? "animate-spin" : ""}`} />
                  <span>{delayTriggered ? "Reset Simulation to Normal" : "Simulate: 3-Hour Flight Delay"}</span>
                </button>
              </div>
            </div>

            {/* Dependency Graph Visualizer */}
            <div className="lg:col-span-7 bg-surface border border-line p-6 sm:p-8 relative">
              <div className="flex items-center justify-between border-b border-line pb-3 mb-6">
                <span className="font-sans text-xs uppercase tracking-wider text-muted font-bold">
                  Itinerary Dependency Graph (Day 1)
                </span>
                <span
                  className={`font-sans text-sm font-bold px-2.5 py-0.5 border ${
 delayTriggered
 ? "bg-surface text-accent border-line animate-pulse"
 : "bg-surface text-accent border-line"
 }`}
                >
                  {delayTriggered ? "⚡ DISRUPTION DETECTED & RESOLVED" : "STATUS: NORMAL SCHEDULE"}
                </span>
              </div>

              {/* Graph Nodes */}
              <div className="space-y-4 font-sans text-xs">
                {/* Node 1: Inbound Flight */}
                <div
                  className={`p-4 border transition-all duration-300 flex items-start justify-between ${
 delayTriggered
 ? "border-line bg-surface text-fg"
 : "border-line bg-surface text-fg"
 }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded border ${delayTriggered ? "border-line bg-surface text-accent" : "border-line bg-surface text-fg"}`}>
                      <Plane className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="font-bold text-sm">Flight AF 1420 (CDG → NAP)</div>
                      <div className="text-sm text-muted">Scheduled Inbound Leg</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`font-bold ${delayTriggered ? "text-accent" : "text-accent"}`}>
                      {delayTriggered ? "Delayed to 17:30 (+3h)" : "On-Time · 14:30"}
                    </div>
                    {delayTriggered && <span className="text-xs text-accent uppercase">Trigger Event</span>}
                  </div>
                </div>

                {/* Connecting Graph Arrow */}
                <div className="flex justify-center -my-2 text-accent font-sans text-xs">
                  ↓ <span className="text-xs text-muted ml-1">Automated Cascading Propagation</span>
                </div>

                {/* Node 2: Private Chauffeur */}
                <div
                  className={`p-4 border transition-all duration-300 flex items-start justify-between ${
 delayTriggered
 ? "border-line bg-surface text-fg"
 : "border-line bg-surface text-fg"
 }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded border border-line bg-surface text-fg">
                      <Hotel className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="font-bold text-sm">Mercedes V-Class Transfer (Naples ↔ Amalfi)</div>
                      <div className="text-sm text-muted">Driver: Marco Rossi · Live Flight Tracked</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`font-bold ${delayTriggered ? "text-accent" : "text-muted"}`}>
                      {delayTriggered ? "Auto-shifted to 17:45" : "14:45 Pickup"}
                    </div>
                    {delayTriggered && <span className="text-xs text-accent">Driver Auto-Notified</span>}
                  </div>
                </div>

                {/* Connecting Graph Arrow */}
                <div className="flex justify-center -my-2 text-accent font-sans text-xs">
                  ↓ <span className="text-xs text-muted ml-1">Downstream Reservation Conflict Solver</span>
                </div>

                {/* Node 3: Michelin Dinner & Boat Swap */}
                <div
                  className={`p-4 border transition-all duration-300 flex items-start justify-between ${
 delayTriggered
 ? "border-line bg-surface text-fg"
 : "border-line bg-surface text-fg"
 }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded border border-line bg-surface text-fg">
                      <Utensils className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="font-bold text-sm">Ristorante La Sponda (Positano)</div>
                      <div className="text-sm text-muted">Dinner Reservation & Table 12 Hold</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`font-bold ${delayTriggered ? "text-accent" : "text-muted"}`}>
                      {delayTriggered ? "Rescheduled to 21:00" : "19:00 Table"}
                    </div>
                    {delayTriggered && <span className="text-xs text-accent">Zero Cancellation Penalties</span>}
                  </div>
                </div>
              </div>

              {delayTriggered && (
                <div className="mt-4 p-3 bg-surface border border-line text-accent text-xs font-sans flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-accent" />
                  <span>3 downstream schedule conflicts resolved automatically. No phone calls required.</span>
                </div>
              )}
            </div>
          </div>
        </div>

      </div>
    </section>
  );
}
