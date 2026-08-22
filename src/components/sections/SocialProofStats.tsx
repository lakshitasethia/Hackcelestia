"use client";

import { useEffect, useRef, useState } from "react";

export default function SocialProofStats() {
  const [hasAnimated, setHasAnimated] = useState(false);
  const containerRef = useRef<HTMLElement>(null);

  const [stats, setStats] = useState({
    destinations: 0,
    trips: 0,
    adaptationRate: 0,
    rating: 0,
  });

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !hasAnimated) {
          setHasAnimated(true);

          // Animate count-ups
          const duration = 1800; // ms
          const startTime = performance.now();

          const animate = (now: number) => {
            const elapsed = now - startTime;
            const progress = Math.min(1, elapsed / duration);
            
            // Ease out cubic
            const easeOut = 1 - Math.pow(1 - progress, 3);

            setStats({
              destinations: Math.floor(easeOut * 500),
              trips: Math.floor(easeOut * 50000),
              adaptationRate: Math.floor(easeOut * 98),
              rating: Number((easeOut * 4.96).toFixed(2)),
            });

            if (progress < 1) {
              requestAnimationFrame(animate);
            }
          };

          requestAnimationFrame(animate);
        }
      },
      { threshold: 0.25 }
    );

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => observer.disconnect();
  }, [hasAnimated]);

  return (
    <section
      ref={containerRef}
      data-scroll-theme="dark"
      className="py-16 sm:py-20 border-b border-line relative"
    >
      <div className="max-w-[110rem] mx-auto px-5 sm:px-8 lg:px-12">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 sm:gap-8">
          
          {/* Stat 1 */}
          <div className="border border-line bg-surface p-6 flex flex-col justify-between">
            <span className="font-sans text-xs uppercase font-bold text-accent tracking-wider">
              CURATED CATALOG
            </span>
            <div className="my-2">
              <span className="font-sans text-3xl sm:text-5xl font-black text-fg">
                {stats.destinations}+
              </span>
            </div>
            <p className="text-xs sm:text-sm text-muted font-medium">
              Vetted worldwide destinations with live pricing APIs.
            </p>
          </div>

          {/* Stat 2 */}
          <div className="border border-line bg-surface p-6 flex flex-col justify-between">
            <span className="font-sans text-xs uppercase font-bold text-muted tracking-wider">
              JOURNEYS BUILT
            </span>
            <div className="my-2">
              <span className="font-sans text-3xl sm:text-5xl font-black text-fg">
                {stats.trips.toLocaleString()}+
              </span>
            </div>
            <p className="text-xs sm:text-sm text-muted font-medium">
              Custom multi-day bespoke itineraries planned to date.
            </p>
          </div>

          {/* Stat 3 */}
          <div className="border border-line bg-surface p-6 flex flex-col justify-between">
            <span className="font-sans text-xs uppercase font-bold text-accent tracking-wider">
              AUTO-RESOLUTION
            </span>
            <div className="my-2">
              <span className="font-sans text-3xl sm:text-5xl font-black text-fg">
                {stats.adaptationRate}%
              </span>
            </div>
            <p className="text-xs sm:text-sm text-muted font-medium">
              On-time dynamic itinerary re-routings without penalties.
            </p>
          </div>

          {/* Stat 4 */}
          <div className="border border-line bg-surface p-6 flex flex-col justify-between">
            <span className="font-sans text-xs uppercase font-bold text-muted tracking-wider">
              TRAVELER SATISFACTION
            </span>
            <div className="my-2">
              <span className="font-sans text-3xl sm:text-5xl font-black text-fg">
                {stats.rating > 0 ? stats.rating.toFixed(2) : "4.96"} <span className="text-lg text-muted">/ 5.0</span>
              </span>
            </div>
            <p className="text-xs sm:text-sm text-muted font-medium">
              Verified review average across independent travelers.
            </p>
          </div>

        </div>
      </div>
    </section>
  );
}
