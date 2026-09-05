"use client";

import { ArrowRight, Layers, Radio, Network, Sparkles, Building, Users } from "lucide-react";

export default function OperatorTeaser() {
  const operatorFeatures = [
    {
      title: "Centralized Bookings",
      desc: "Consolidate custom itineraries, supplier invoices, and guest dietary profiles into one single automated dashboard.",
      icon: Layers,
      tag: "Unified PNR",
    },
    {
      title: "Vendor & Schedule Dispatch",
      desc: "Synchronize directly with local private drivers, yacht skippers, and licensed mountain guides with real-time arrival pings.",
      icon: Network,
      tag: "Live Fleet Sync",
    },
    {
      title: "Real-Time Disruption Sentinel",
      desc: "When flight delays or storms hit, auto-renegotiate slot times with partners and push instant itinerary updates to travelers.",
      icon: Radio,
      tag: "Auto-Resolution",
    },
  ];

  return (
    <section id="for-operators" data-scroll-theme="dark" className="py-20 sm:py-28 border-b border-line relative overflow-hidden">
      {/* Background Starfield (Celestial Bookend) */}
      <div className="absolute inset-0 pointer-events-none opacity-40">
        <Sparkles className="absolute top-[15%] right-[15%] w-5 h-5 text-accent animate-pulse" />
        <Sparkles className="absolute bottom-[20%] left-[10%] w-4 h-4 text-accent animate-pulse" />
        <div className="absolute top-1/2 right-1/3 w-2 h-2 rounded-full bg-fg animate-twinkle" />
        <div className="absolute top-1/4 left-1/5 w-1.5 h-1.5 rounded-full bg-fg animate-twinkle" />
      </div>

      <div className="max-w-[110rem] mx-auto px-5 sm:px-8 lg:px-12 relative z-10">
        {/* Section Header */}
        <div data-reveal className="max-w-3xl mb-16 sm:mb-20">
          <span className="eyebrow">· THE OPERATIONS SIDE OF THE SKY ·</span>
          <h2 className="font-display text-display-lg font-semibold uppercase text-fg">
            Running tours? <br />
            <span className="text-accent">We handle the operations.</span>
          </h2>
          <p className="mt-4 text-base sm:text-lg text-muted leading-relaxed font-medium">
            Waypoint isn’t just for travelers. For destination management companies (DMCs) and tour operators, our back-office OS turns chaotic WhatsApp threads and spreadsheet hell into an automated dynamic operations center.
          </p>
        </div>

        {/* 3 Bordered Pipeline Feature Chips */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-14">
          {operatorFeatures.map((feat) => {
            const Icon = feat.icon;
            return (
              <div
                key={feat.title}
                className="bg-surface border border-line p-6 sm:p-8 transition-all duration-200 hover:-translate-y-1 hover:border-line group relative"
              >
                <div className="flex items-center justify-between mb-4">
                  <div className="w-10 h-10 border border-line bg-surface flex items-center justify-center text-accent group-hover:bg-fg group-hover:text-bg transition-colors">
                    <Icon className="w-5 h-5" />
                  </div>
                  <span className="font-sans text-xs uppercase font-bold tracking-widest text-accent bg-surface px-2 py-0.5 border border-line">
                    {feat.tag}
                  </span>
                </div>

                <h3 className="font-display text-display-sm font-semibold uppercase text-fg mb-2 group-hover:text-accent transition-colors">
                  {feat.title}
                </h3>
                <p className="text-xs sm:text-sm text-muted leading-relaxed font-medium">
                  {feat.desc}
                </p>
              </div>
            );
          })}
        </div>

        {/* Operator CTA Bar */}
        <div className="p-6 sm:p-8 bg-surface border border-line flex flex-col sm:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-none bg-fg text-bg flex items-center justify-center shrink-0 border border-line">
              <Building className="w-6 h-6" />
            </div>
            <div>
              <h4 className="font-display text-lg sm:text-xl font-bold text-fg">
                Bespoke Partner Integrations & White-label Engine
              </h4>
              <p className="text-xs text-muted font-sans mt-0.5">
                Join 140+ tour operators currently modernizing on the Waypoint API.
              </p>
            </div>
          </div>

          <a
            href="#pricing"
            className="btn-solid whitespace-nowrap px-8 py-3.5 text-xs sm:text-sm tracking-wider group"
          >
            <span>Explore Operator Tools</span>
            <ArrowRight className="w-4 h-4 ml-2 inline group-hover:translate-x-1 transition-transform" />
          </a>
        </div>
      </div>
    </section>
  );
}
