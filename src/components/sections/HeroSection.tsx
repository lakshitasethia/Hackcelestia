"use client";

import { useState } from "react";
import Photo from "@/components/ui/Photo";
import { ArrowRight, Sparkles, SlidersHorizontal, Check, RefreshCw, MapPin, Clock, Calendar } from "lucide-react";

export default function HeroSection() {
  // Interactive mini-preview state for the floating mockup
  const [selectedDay, setSelectedDay] = useState(2);
  const [isYachtUpgraded, setIsYachtUpgraded] = useState(true);
  const [hotelTier, setHotelTier] = useState<"boutique" | "cliffside">("cliffside");

  // Dynamic price calculation for the preview
  const basePrice = 2740;
  const yachtPrice = isYachtUpgraded ? 680 : 0;
  const hotelPrice = hotelTier === "cliffside" ? 540 : 220;
  const totalPrice = basePrice + yachtPrice + hotelPrice;

  return (
    <section data-scroll-theme="dark" className="relative min-h-screen pt-28 sm:pt-36 pb-20 sm:pb-32 overflow-hidden flex flex-col justify-center">
      {/* Background Full-bleed Travel Photography */}
      <div className="absolute inset-0 -z-10 overflow-hidden">
        <Photo
          src="https://images.unsplash.com/photo-1533105079780-92b9be482077?q=80&w=2000&auto=format&fit=crop"
          alt="Santorini and Mediterranean coastline"
          fill
          priority
          className="object-cover object-center scale-105 filter brightness-[0.88] contrast-[1.05]"
          sizes="100vw"
        />
        {/* Warm overlay — dark enough for legible type, light enough to keep the photo */}
        <div className="absolute inset-0 bg-gradient-to-t from-umber-700 via-umber-700/60 to-umber-900/70" />
      </div>

      <div className="max-w-[110rem] mx-auto px-5 sm:px-8 lg:px-12 w-full relative z-10">
        <div className="max-w-6xl mx-auto text-center flex flex-col items-center">
          {/* Top Pill / Badge */}
          <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-surface border border-line mb-6 rounded-none backdrop-blur-sm animate-in fade-in slide-in-from-bottom-3 duration-500">
            <Sparkles className="w-3.5 h-3.5 text-accent" />
            <span className="font-sans text-xs font-bold uppercase tracking-[0.2em] text-fg">
              Skip the fixed package
            </span>
          </div>

          {/* Large 3-beat Statement Headline */}
          <h1 className="font-display text-display-xl font-semibold uppercase text-fg text-balance">
            Your trip. Your rules.<br />
            <span className="text-accent">Still handled.</span>
          </h1>

          {/* Subheadline */}
          <p className="mt-8 text-body-lg text-muted max-w-2xl">
            Build custom tours from real hotels, private transport, and vetted local
            experiences — priced live, and re-routed automatically when weather or
            delays hit mid-trip.
          </p>

          {/* Dual CTAs */}
          <div className="mt-8 sm:mt-10 flex flex-col sm:flex-row items-center justify-center gap-4 w-full sm:w-auto">
            <a
              href="#destinations"
              className="btn-solid w-full sm:w-auto px-8 py-4 text-sm tracking-wider group"
            >
              <span>Start Planning Your Trip</span>
              <ArrowRight className="w-4 h-4 ml-2 inline group-hover:translate-x-1 transition-transform" />
            </a>
            <a
              href="#how-it-works"
              className="btn-outline w-full sm:w-auto px-8 py-4 text-sm tracking-wider"
            >
              <span>See How It Works</span>
            </a>
          </div>

          {/* Live Status Badge */}
          <div className="mt-6 flex items-center gap-2 text-xs font-sans text-muted">
            <span className="w-2 h-2 rounded-full bg-fg animate-pulse" />
            <span>Instant Dynamic Pricing Engine Active</span>
            <span className="text-muted">·</span>
            <span>Zero Agency Markups</span>
          </div>
        </div>

        {/* Floating Product Mockup Card (Itinerary Builder UI Preview) */}
        <div className="mt-14 sm:mt-20 max-w-5xl mx-auto">
          <div className="surface overflow-hidden">
            {/* macOS Window Chrome Bar */}
            <div className="bg-surface border-b border-line px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-fg border border-line" />
                <span className="w-3 h-3 rounded-full bg-fg border border-line" />
                <span className="w-3 h-3 rounded-full bg-fg border border-line" />
                <span className="ml-3 font-sans text-xs font-bold uppercase tracking-wider text-fg hidden sm:inline">
                  VOYAGE — Dynamic Itinerary Studio
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-sans text-[11px] bg-fg text-bg border border-line px-2 py-0.5 font-bold uppercase tracking-wider">
                  Live Total: ${totalPrice.toLocaleString()}
                </span>
                <span className="font-sans text-[11px] bg-surface text-muted border border-line px-2 py-0.5 font-bold uppercase tracking-wider hidden md:inline">
                  Auto-Adapt: ON
                </span>
              </div>
            </div>

            {/* Mockup Workspace Body */}
            <div className="p-4 sm:p-6 lg:p-8 bg-surface">
              {/* Trip Header Strip */}
              <div className="flex flex-col md:flex-row md:items-center justify-between pb-6 border-b border-line gap-4">
                <div>
                  <div className="flex items-center gap-2 text-accent font-sans text-xs font-bold uppercase tracking-widest">
                    <MapPin className="w-3.5 h-3.5" />
                    Amalfi Coast & Capri, Italy
                  </div>
                  <h3 className="font-display text-2xl font-semibold uppercase tracking-tight text-fg mt-1">
                    4-Day Mediterranean Horizon
                  </h3>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5 font-sans text-xs text-fg bg-surface border border-line px-3 py-1.5">
                    <Calendar className="w-3.5 h-3.5 text-accent" />
                    Sep 14 – Sep 18, 2026
                  </div>
                  <div className="flex items-center gap-1.5 font-sans text-xs text-fg bg-surface border border-line px-3 py-1.5">
                    <Clock className="w-3.5 h-3.5 text-muted" />
                    2 Guests
                  </div>
                </div>
              </div>

              {/* Day Selection Tabs */}
              <div className="flex items-center gap-2 mt-6 overflow-x-auto pb-2 scrollbar-none">
                {[
                  { day: 1, title: "Day 1: Arrival & Positano" },
                  { day: 2, title: "Day 2: Private Capri Yacht" },
                  { day: 3, title: "Day 3: Ravello & Wine" },
                  { day: 4, title: "Day 4: Cliffside & Heli" },
                ].map((item) => (
                  <button
                    key={item.day}
                    onClick={() => setSelectedDay(item.day)}
                    className={`font-sans text-xs uppercase tracking-wider font-bold px-4 py-2 border border-line transition-all whitespace-nowrap ${
 selectedDay === item.day
 ? "bg-fg text-bg -translate-y-0.5"
 : "bg-surface text-fg hover:bg-surface"
 }`}
                  >
                    {item.title}
                  </button>
                ))}
              </div>

              {/* Interactive Day Component Cards */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mt-6">
                {/* Component 1: Accommodation */}
                <div className="border border-line p-4 bg-surface relative">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-sans text-[10px] uppercase font-bold tracking-widest text-muted bg-surface px-2 py-0.5 border border-line">
                      Stay · Positano
                    </span>
                    <span className="font-sans text-xs font-bold text-fg">
                      ${hotelPrice}/night
                    </span>
                  </div>
                  <h4 className="font-display font-bold text-base text-fg mb-1">
                    {hotelTier === "cliffside" ? "Le Sirenuse Cliffside Suite" : "Villa Franca Positano"}
                  </h4>
                  <p className="text-xs text-muted mb-3">
                    Panoramic balcony, breakfast included, private funicular to beach.
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setHotelTier(hotelTier === "cliffside" ? "boutique" : "cliffside")}
                      className="text-[11px] font-sans font-bold uppercase tracking-wider px-2.5 py-1 bg-surface border border-line hover:bg-surface flex items-center gap-1"
                    >
                      <RefreshCw className="w-3 h-3 text-accent" />
                      Swap ({hotelTier === "cliffside" ? "Boutique -$320" : "Cliffside +$320"})
                    </button>
                  </div>
                </div>

                {/* Component 2: Primary Activity */}
                <div className="border border-line p-4 bg-surface relative">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-sans text-[10px] uppercase font-bold tracking-widest text-bg bg-fg px-2 py-0.5 border border-line">
                      Experience · Capri
                    </span>
                    <span className="font-sans text-xs font-bold text-fg">
                      ${yachtPrice > 0 ? yachtPrice : 180}
                    </span>
                  </div>
                  <h4 className="font-display font-bold text-base text-fg mb-1">
                    {isYachtUpgraded ? "Private 38ft Riva Yacht & Blue Grotto" : "Shared Catamaran Tour"}
                  </h4>
                  <p className="text-xs text-muted mb-3">
                    Skipper, champagne, secluded swimming coves, towel service.
                  </p>
                  <button
                    onClick={() => setIsYachtUpgraded(!isYachtUpgraded)}
                    className="text-[11px] font-sans font-bold uppercase tracking-wider px-2.5 py-1 bg-surface border border-line hover:bg-surface flex items-center gap-1"
                  >
                    <SlidersHorizontal className="w-3 h-3 text-muted" />
                    {isYachtUpgraded ? "Downgrade (-$500)" : "Upgrade to Riva (+$500)"}
                  </button>
                </div>

                {/* Component 3: Live Adaptation & Routing Status */}
                <div className="border border-line p-4 bg-surface text-fg relative">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-sans text-[10px] uppercase font-bold tracking-widest text-accent bg-surface px-2 py-0.5 border border-line">
                      Auto-Adapt Guard
                    </span>
                    <span className="w-2 h-2 rounded-full bg-fg animate-ping" />
                  </div>
                  <h4 className="font-display font-bold text-base text-fg mb-1">
                    Weather & Sea Sentinel
                  </h4>
                  <p className="text-xs text-muted mb-3">
                    If sea swells exceed 1.2m on Capri day, the yacht moves to Day 3 and Ravello gardens switch seamlessly.
                  </p>
                  <div className="flex items-center gap-1.5 text-[11px] font-sans text-accent font-bold">
                    <Check className="w-3.5 h-3.5 text-accent" />
                    Contingency Route Linked
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
