"use client";

import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { Compass, Sliders, CalendarRange, Calculator, CheckCircle2, RefreshCw } from "lucide-react";

export default function JourneyStrip() {
  const [activeStep, setActiveStep] = useState(0);
  const [progress, setProgress] = useState(0);
  const sectionRef = useRef<HTMLElement>(null);

  const steps = [
    {
      num: "01",
      icon: Compass,
      title: "Discover",
      desc: "Browse curated destinations & activities tailored to your travel vibe.",
      detail: "Explore hand-vetted villas, private culinary tours, and off-grid adventures matched to your pace.",
      tag: "Curation Engine",
    },
    {
      num: "02",
      icon: Sliders,
      title: "Personalize",
      desc: "Set your exact dates, guest count, comfort tier, and target budget.",
      detail: "Fine-tune dietary preferences, pace parameters, private transfer needs, and mobility requirements.",
      tag: "Preference Matrix",
    },
    {
      num: "03",
      icon: CalendarRange,
      title: "Plan",
      desc: "Build day-by-day itineraries, swap hotels, and reorder activities.",
      detail: "Drag and drop schedule blocks with automated transit time validation between waypoints.",
      tag: "Dynamic Builder",
    },
    {
      num: "04",
      icon: Calculator,
      title: "Price",
      desc: "Watch transparent itemized totals calculate live with every change.",
      detail: "Direct supplier rates with zero opaque package markups. What you see is exactly what you pay.",
      tag: "Live Ledger",
    },
    {
      num: "05",
      icon: CheckCircle2,
      title: "Book",
      desc: "Confirm flights, stays, and experiences in one consolidated checkout.",
      detail: "Unified reservation voucher, instant operator confirmation, and synchronized digital wallet passes.",
      tag: "Instant Lock",
    },
    {
      num: "06",
      icon: RefreshCw,
      title: "Adapt",
      desc: "Automated real-time re-routing if delays, cancellations, or storms hit.",
      detail: "Dynamic graph solver detects delays, cancels conflicting slots, and reschedules reservations instantly.",
      tag: "Flagship Sentinel",
    },
  ];

  useEffect(() => {
    gsap.registerPlugin(ScrollTrigger);
    if (!sectionRef.current) return;

    // Scrub the constellation line + active node directly against scroll position,
    // instead of a manual scroll listener — smoother, and pauses cleanly off-screen.
    const trigger = ScrollTrigger.create({
      trigger: sectionRef.current,
      start: "top 70%",
      end: "bottom 55%",
      scrub: 0.6,
      onUpdate: (self) => {
        const p = self.progress;
        setProgress(p);
        setActiveStep(Math.min(steps.length - 1, Math.floor(p * steps.length)));
      },
    });

    return () => trigger.kill();
  }, [steps.length]);

  return (
    <section
      id="how-it-works"
      ref={sectionRef}
      data-scroll-theme="dark"
      className="py-20 sm:py-28 border-b border-line relative overflow-hidden"
    >
      <div className="max-w-[110rem] mx-auto px-5 sm:px-8 lg:px-12">
        {/* Section Heading — the copy holds the left, hard numbers hold the
            right, so the full-width container does not run empty. */}
        <div
          data-reveal
          className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-16 items-end mb-16 sm:mb-20"
        >
          <div className="lg:col-span-7">
            <span className="eyebrow">· HOW IT WORKS ·</span>
            <h2 className="font-display text-display-lg font-semibold uppercase text-fg">
              From first spark to mid-trip adaptation.
            </h2>
            <p className="mt-6 text-body-lg text-muted max-w-2xl">
              Unlike fixed agency packages that lock you into rigid templates, Voyage
              treats your trip as an interconnected, living itinerary constellation
              that responds in real time.
            </p>
          </div>

          <dl className="lg:col-span-5 lg:pl-10 lg:border-l border-line grid grid-cols-2 lg:grid-cols-1 gap-x-8 gap-y-8">
            {[
              {
                value: "11 → 6",
                label: "Lifecycle stages",
                note: "Eleven tracked end to end; the six that change your day are shown here.",
              },
              {
                value: "8 sec",
                label: "Median re-plan",
                note: "From disruption detected to a confirmed alternative on your phone.",
              },
              {
                value: "98%",
                label: "Resolved without a call",
                note: "Re-routes that complete automatically, with no agent in the loop.",
              },
            ].map((stat) => (
              <div key={stat.label}>
                <dt className="font-display text-2xl sm:text-3xl font-semibold uppercase tracking-tight text-fg">
                  {stat.value}
                </dt>
                <dd className="mt-1.5">
                  <span className="block font-display uppercase text-label tracking-label text-accent">
                    {stat.label}
                  </span>
                  <span className="mt-2 block text-sm text-muted leading-relaxed max-w-xs">
                    {stat.note}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        </div>

        {/* Desktop Constellation Timeline Strip */}
        <div className="relative mb-16 hidden lg:block">
          {/* Background Track */}
          <div className="absolute top-1/2 left-8 right-8 -translate-y-1/2 h-1 bg-surface border-t border-b border-line -z-0" />
          
          {/* Animated Connecting Line (Constellation Progress) */}
          <div
            className="absolute top-1/2 left-8 -translate-y-1/2 h-1 bg-fg transition-all duration-300 -z-0 shadow-[0_0_8px_rgba(232,93,58,0.8)]"
            style={{ width: `calc(${Math.max(0, Math.min(100, progress * 100))}% - 4rem)` }}
          />

          {/* 6 Constellation Step Nodes */}
          <div className="grid grid-cols-6 gap-4 relative z-10">
            {steps.map((step, idx) => {
              const Icon = step.icon;
              const isPassed = progress >= (idx / (steps.length - 1)) - 0.05;
              const isCurrent = activeStep === idx;

              return (
                <button
                  key={step.num}
                  onClick={() => setActiveStep(idx)}
                  className="group flex flex-col items-center text-center focus:outline-none"
                >
                  {/* Node Circle */}
                  <div
                    className={`w-14 h-14 rounded-full border border-line flex items-center justify-center transition-all duration-300 ${
 isCurrent
 ? "bg-fg text-bg scale-110"
 : isPassed
 ? "bg-surface text-fg"
 : "bg-surface text-fg group-hover:bg-surface"
 }`}
                  >
                    <Icon className="w-6 h-6" />
                  </div>

                  {/* Step Number & Title */}
                  <span className="font-sans text-xs font-bold text-accent mt-3 uppercase tracking-wider">
                    STEP {step.num}
                  </span>
                  <h4 className="font-display font-bold text-lg text-fg mt-0.5">
                    {step.title}
                  </h4>
                  <p className="text-xs text-muted mt-1 line-clamp-2 px-1">
                    {step.desc}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Mobile & Tablet Interactive Accordion Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {steps.map((step, idx) => {
            const Icon = step.icon;
            const isSelected = activeStep === idx;

            return (
              <div
                key={step.num}
                onClick={() => setActiveStep(idx)}
                className={`surface p-6 cursor-pointer transition-all duration-200 relative ${
 isSelected
 ? "bg-surface border-line -translate-y-1 ring-1 ring-line"
 : "bg-surface hover:bg-surface"
 }`}
              >
                <div className="flex items-center justify-between mb-4">
                  <span className="font-sans text-xs font-bold uppercase tracking-wider text-bg bg-fg px-2.5 py-1">
                    {step.num}
                  </span>
                  <span className="font-sans text-xs uppercase font-bold tracking-widest text-muted bg-surface border border-line px-2 py-0.5">
                    {step.tag}
                  </span>
                </div>

                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 border border-line bg-surface flex items-center justify-center text-fg">
                    <Icon className="w-5 h-5 text-accent" />
                  </div>
                  <h3 className="font-display text-display-sm font-semibold uppercase text-fg">
                    {step.title}
                  </h3>
                </div>

                <p className="text-sm text-muted mb-3 font-medium">
                  {step.desc}
                </p>

                <p className="text-xs text-muted border-t border-line pt-3 leading-relaxed">
                  {step.detail}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
