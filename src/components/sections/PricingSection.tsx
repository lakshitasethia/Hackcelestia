"use client";

import { Check, Sparkles, ArrowRight } from "lucide-react";

export default function PricingSection() {
  const plans = [
    {
      name: "Traveler Free",
      eyebrow: "FOR INDEPENDENT EXPLORERS",
      price: "$0",
      period: "forever",
      description: "Build, customize, and share unlimited bespoke multi-day itineraries with live pricing.",
      features: [
        "Interactive day-by-day itinerary builder",
        "Live wholesale supplier price lookup",
        "Direct accommodation & experience booking",
        "Automated flight delay monitoring",
        "Digital wallet passes & synchronized offline map",
      ],
      cta: "Start Planning Free",
      ctaLink: "#destinations",
      highlight: false,
    },
    {
      name: "Voyage Sentinel Plus",
      eyebrow: "FOR FREQUENT TRAVELERS",
      price: "$29",
      period: "per trip",
      description: "Full automated disruption resolution with 1-click rebooking and priority concierge.",
      features: [
        "Everything in Traveler Free",
        "Autonomous reservation re-routing on delays",
        "Zero cancellation penalty guarantee on partnered stays",
        "24/7 dedicated satellite concierge support",
        "Real-time weather contingency swaps",
      ],
      cta: "Unlock Protection",
      ctaLink: "#destinations",
      highlight: true,
    },
    {
      name: "Operator Studio",
      eyebrow: "FOR DMCs & TOUR OPERATORS",
      price: "$199",
      period: "per month",
      description: "Complete operations back office for managing custom tours, driver fleets, and live margins.",
      features: [
        "White-label client itinerary builder",
        "Multi-supplier PNR and invoice consolidation",
        "Live fleet & driver dispatch tracking",
        "Automated guest WhatsApp update bot",
        "Custom markup & margin rules engine",
      ],
      cta: "Apply for Operator Access",
      ctaLink: "#for-operators",
      highlight: false,
    },
  ];

  return (
    <section id="pricing" data-scroll-theme="tan" className="py-20 sm:py-28 border-b border-line">
      <div className="max-w-[110rem] mx-auto px-5 sm:px-8 lg:px-12">
        {/* Heading */}
        <div data-reveal className="max-w-3xl mx-auto text-center mb-16 sm:mb-20">
          <span className="eyebrow text-center">· TRANSPARENT PLANS ·</span>
          <h2 className="font-display text-display-lg font-semibold uppercase text-fg">
            Simple, honest pricing. <br />
            No hidden agency commissions.
          </h2>
          <p className="mt-4 text-base sm:text-lg text-muted font-medium">
            Plan for free as a traveler or supercharge your tour business with our back-office automation suite.
          </p>
        </div>

        {/* Pricing Cards Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-stretch">
          {plans.map((plan) => (
            <div
              key={plan.name}
              className={`surface p-8 flex flex-col justify-between relative ${
 plan.highlight
 ? "bg-surface border border-line ring-1 ring-line"
 : "bg-surface"
 }`}
            >
              {plan.highlight && (
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-fg text-bg font-sans text-[10px] uppercase font-bold tracking-widest px-3 py-1 border border-line flex items-center gap-1">
                  <Sparkles className="w-3 h-3 text-accent" />
                  Most Popular for Travelers
                </div>
              )}

              <div>
                <span className="font-sans text-xs font-bold uppercase tracking-wider text-accent block mb-1">
                  {plan.eyebrow}
                </span>
                <h3 className="font-display text-display-sm font-semibold uppercase text-fg mb-3">
                  {plan.name}
                </h3>
                <p className="text-xs sm:text-sm text-muted mb-6 font-medium leading-relaxed">
                  {plan.description}
                </p>

                {/* Price Display */}
                <div className="flex items-baseline gap-1 pb-6 mb-6 border-b border-line">
                  <span className="font-sans text-4xl sm:text-5xl font-black text-fg">
                    {plan.price}
                  </span>
                  <span className="font-sans text-xs text-muted font-bold uppercase">
                    / {plan.period}
                  </span>
                </div>

                {/* Features List */}
                <ul className="space-y-3 font-sans text-xs mb-8">
                  {plan.features.map((feat, i) => (
                    <li key={i} className="flex items-start gap-2.5 text-fg">
                      <Check className="w-4 h-4 text-accent shrink-0 mt-0.5" />
                      <span>{feat}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Action Button */}
              <a
                href={plan.ctaLink}
                className={
                  plan.highlight
                    ? "btn-solid w-full py-3.5 text-xs tracking-wider"
                    : "btn-outline w-full py-3.5 text-xs tracking-wider"
                }
              >
                <span>{plan.cta}</span>
                <ArrowRight className="w-3.5 h-3.5 ml-1.5 inline" />
              </a>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
