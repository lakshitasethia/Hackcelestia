"use client";

import Photo from "@/components/ui/Photo";
import { ArrowRight, Check } from "lucide-react";

export default function FinalCTA() {
  return (
    <section data-scroll-theme="dark" className="py-20 sm:py-28 border-b border-line relative overflow-hidden">
      {/* Background collage with low opacity for depth */}
      <div className="absolute inset-0 opacity-20 pointer-events-none mix-blend-luminosity">
        <div className="grid grid-cols-3 h-full gap-2">
          <div className="relative h-full">
            <Photo
              src="/images/cta_coastal_arch.jpg"
              alt="Beach collage"
              fill
              className="object-cover"
              sizes="33vw"
            />
          </div>
          <div className="relative h-full">
            <Photo
              src="/images/cta_parisian_facade.jpg"
              alt="Paris collage"
              fill
              className="object-cover"
              sizes="33vw"
            />
          </div>
          <div className="relative h-full">
            <Photo
              src="/images/cta_alpine_silhouette.jpg"
              alt="Mountain collage"
              fill
              className="object-cover"
              sizes="33vw"
            />
          </div>
        </div>
      </div>

      <div data-reveal className="max-w-5xl mx-auto px-5 sm:px-8 lg:px-12 text-center relative z-10">
        <h2 className="font-display text-display-lg font-semibold uppercase text-balance">
          Stop settling for someone else’s itinerary.
        </h2>

        <p className="mt-6 text-base sm:text-xl text-fg max-w-2xl mx-auto font-medium leading-relaxed">
          Craft every day your way. See itemized live pricing, swap hotels with one click, and travel with the confidence of automated real-time adaptive routing.
        </p>

        <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
          <a
            href="/app"
            className="btn-outline w-full sm:w-auto px-10 py-4 text-sm sm:text-base tracking-wider group bg-surface text-fg hover:bg-surface"
          >
            <span>Start Planning Your Trip</span>
            <ArrowRight className="w-4 h-4 ml-2 inline group-hover:translate-x-1 transition-transform" />
          </a>
          <a
            href="#for-operators"
            className="btn-solid w-full sm:w-auto px-8 py-4 text-sm tracking-wider"
          >
            <span>For Tour Operators</span>
          </a>
        </div>

        {/* Feature Checkpoints */}
        <div className="mt-10 flex flex-wrap items-center justify-center gap-6 text-xs font-sans text-fg">
          <div className="flex items-center gap-1.5">
            <Check className="w-4 h-4 text-accent" />
            <span>Instant Dynamic Calculation</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Check className="w-4 h-4 text-accent" />
            <span>Zero Opaque Package Markups</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Check className="w-4 h-4 text-accent" />
            <span>Auto-Adapt Disruption Protection</span>
          </div>
        </div>
      </div>
    </section>
  );
}
