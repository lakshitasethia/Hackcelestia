"use client";

export default function TrustTicker() {
  const tickerItems = [
    "REAL-TIME PRICING",
    "10,000+ CURATED EXPERIENCES",
    "INSTANT ITINERARY UPDATES",
    "ZERO HIDDEN AGENCY FEES",
    "DYNAMIC MULTI-STOP ROUTING",
    "BUILT FOR HACKCELESTIA 2026",
    "AUTOMATIC WEATHER ADAPTATION",
    "PERSONALIZED TRIP BUILDER",
  ];

  return (
    <div className="relative z-20 bg-fg text-bg py-3.5 border-y border-line overflow-hidden select-none">
      <div className="flex animate-marquee whitespace-nowrap">
        {/* Render twice for seamless continuous loop */}
        {[...tickerItems, ...tickerItems].map((item, idx) => (
          <div key={idx} className="inline-flex items-center mx-6 sm:mx-8">
            {/* The strip is inverted (bg-fg), so its contents take the page background colour. */}
            <span className="text-bg/60 font-sans text-sm mr-3">✦</span>
            <span className="font-sans text-label tracking-wide2 font-medium uppercase text-bg">
              {item}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
