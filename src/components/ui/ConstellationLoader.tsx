"use client";

import { useEffect, useState, useRef } from "react";
import gsap from "gsap";
import { Plane, Building2, MapPin, Compass, Sparkles } from "lucide-react";

export default function ConstellationLoader() {
  const [visible, setVisible] = useState(true);
  const [phaseText, setPhaseText] = useState("CHARTING YOUR COURSE");
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const textRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    // Check if user already saw the intro loader in this session
    const hasSeen = sessionStorage.getItem("voyage_loader_shown");
    if (hasSeen) {
      setVisible(false);
      return;
    }

    let dismissed = false;
    const dismiss = (immediate = false) => {
      if (dismissed) return;
      dismissed = true;
      sessionStorage.setItem("voyage_loader_shown", "true");
      if (immediate || !containerRef.current) {
        setVisible(false);
        return;
      }
      // Quick cross-fade out
      gsap.to(containerRef.current, {
        opacity: 0,
        scale: 1.04,
        duration: 0.45,
        ease: "power2.inOut",
        onComplete: () => setVisible(false),
      });
    };

    // Hard ceiling. If the main thread stalls (heavy image decode, slow device)
    // the GSAP timeline can crawl and strand the overlay over the whole page —
    // never let the loader outlive this regardless of animation progress.
    const failsafe = window.setTimeout(() => dismiss(true), 2600);

    const tl = gsap.timeline({ onComplete: () => dismiss() });

    // 1. Text cycle phrases
    const phrases = ["CHARTING YOUR COURSE", "ALIGNING YOUR STARS", "MAPPING YOUR JOURNEY"];
    
    // Animate lines drawing in sequence
    const lines = svgRef.current?.querySelectorAll(".constellation-line");
    const nodes = svgRef.current?.querySelectorAll(".constellation-node");
    const icons = svgRef.current?.querySelectorAll(".constellation-icon");

    if (lines && nodes && icons && lines.length > 0 && nodes.length > 0) {
      // Initial states
      gsap.set(Array.from(lines), { strokeDasharray: 200, strokeDashoffset: 200 });
      gsap.set(Array.from(nodes), { scale: 0, transformOrigin: "center center" });
      if (icons.length > 0) {
        gsap.set(Array.from(icons), { opacity: 0, scale: 0.5, transformOrigin: "center center" });
      }

      // Sequenced line and node appearances
      nodes.forEach((node, idx) => {
        tl.to(
          node,
          {
            scale: 1,
            duration: 0.25,
            ease: "back.out(2)",
          },
          idx * 0.2
        );

        if (icons && icons[idx]) {
          tl.to(
            icons[idx],
            {
              opacity: 1,
              scale: 1,
              duration: 0.2,
              ease: "power2.out",
            },
            idx * 0.2 + 0.05
          );
        }

        if (lines[idx]) {
          tl.to(
            lines[idx],
            {
              strokeDashoffset: 0,
              duration: 0.3,
              ease: "power2.inOut",
            },
            idx * 0.2 + 0.1
          );
        }

        // Change status text at 3 points
        if (idx === 1) {
          tl.call(() => {
            setPhaseText(phrases[1]);
            if (textRef.current) {
              gsap.fromTo(textRef.current, { opacity: 0, y: 5 }, { opacity: 1, y: 0, duration: 0.2 });
            }
          }, undefined, idx * 0.2);
        } else if (idx === 3) {
          tl.call(() => {
            setPhaseText(phrases[2]);
            if (textRef.current) {
              gsap.fromTo(textRef.current, { opacity: 0, y: 5 }, { opacity: 1, y: 0, duration: 0.2 });
            }
          }, undefined, idx * 0.2);
        }
      });

      // Quick convergence pulse before transition
      tl.to(".constellation-group", {
        scale: 0.92,
        duration: 0.2,
        ease: "power2.in",
      }, "+=0.15");

      tl.to(".constellation-group", {
        scale: 1.15,
        opacity: 0.8,
        duration: 0.2,
        ease: "power3.out",
      });
    }

    return () => {
      window.clearTimeout(failsafe);
      tl.kill();
    };
  }, []);

  if (!visible) return null;

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-[10000] flex flex-col items-center justify-center bg-umber-900 text-tan-500 select-none overflow-hidden"
    >
      {/* Background Starfield */}
      <div className="absolute inset-0 pointer-events-none opacity-60">
        {[
          { top: "15%", left: "20%", size: 2, delay: "0s" },
          { top: "25%", left: "75%", size: 3, delay: "0.7s" },
          { top: "70%", left: "15%", size: 2, delay: "1.2s" },
          { top: "80%", left: "80%", size: 3, delay: "0.4s" },
          { top: "40%", left: "85%", size: 2, delay: "1.8s" },
          { top: "60%", left: "30%", size: 2, delay: "0.9s" },
          { top: "10%", left: "55%", size: 4, delay: "1.5s" },
        ].map((star, i) => (
          <div
            key={i}
            className="absolute rounded-full bg-tan-500 animate-twinkle"
            style={{
              top: star.top,
              left: star.left,
              width: `${star.size}px`,
              height: `${star.size}px`,
              animationDelay: star.delay,
              boxShadow: "0 0 6px rgba(245, 158, 11, 0.9)",
            }}
          />
        ))}

        {/* 4-point sparkle stars */}
        <Sparkles className="absolute top-[18%] left-[82%] w-5 h-5 text-tan-500/40 animate-pulse" />
        <Sparkles className="absolute bottom-[22%] left-[12%] w-4 h-4 text-tan-500/50 animate-pulse" />
      </div>

      {/* Constellation Canvas */}
      <div className="relative z-10 constellation-group flex flex-col items-center justify-center">
        <svg
          ref={svgRef}
          viewBox="0 0 420 220"
          className="w-[320px] sm:w-[420px] h-[170px] sm:h-[220px] overflow-visible"
        >
          {/* Glowing Connecting Lines */}
          <line
            x1="50"
            y1="110"
            x2="130"
            y2="45"
            stroke="#A89474"
            strokeWidth="2.5"
            strokeLinecap="round"
            className="constellation-line filter drop-shadow-[0_0_8px_#A89474]"
          />
          <line
            x1="130"
            y1="45"
            x2="210"
            y2="130"
            stroke="#FFFFFF"
            strokeWidth="2.5"
            strokeLinecap="round"
            className="constellation-line filter drop-shadow-[0_0_8px_#FFFFFF]"
          />
          <line
            x1="210"
            y1="130"
            x2="290"
            y2="55"
            stroke="#A89474"
            strokeWidth="2.5"
            strokeLinecap="round"
            className="constellation-line filter drop-shadow-[0_0_8px_#A89474]"
          />
          <line
            x1="290"
            y1="55"
            x2="370"
            y2="110"
            stroke="#FFFFFF"
            strokeWidth="2.5"
            strokeLinecap="round"
            className="constellation-line filter drop-shadow-[0_0_8px_#FFFFFF]"
          />

          {/* Node 1: Plane (Flight) */}
          <g className="constellation-node" transform="translate(50, 110)">
            <circle r="18" fill="#2C2824" stroke="#A89474" strokeWidth="2.5" />
            <foreignObject x="-9" y="-9" width="18" height="18" className="constellation-icon">
              <Plane className="w-4 h-4 text-tan-500" />
            </foreignObject>
          </g>

          {/* Node 2: Hotel (Stay) */}
          <g className="constellation-node" transform="translate(130, 45)">
            <circle r="18" fill="#2C2824" stroke="#FFFFFF" strokeWidth="2.5" />
            <foreignObject x="-9" y="-9" width="18" height="18" className="constellation-icon">
              <Building2 className="w-4 h-4 text-tan-500" />
            </foreignObject>
          </g>

          {/* Node 3: Compass (Discover) */}
          <g className="constellation-node" transform="translate(210, 130)">
            <circle r="22" fill="#A89474" stroke="#A89474" strokeWidth="3" />
            <foreignObject x="-10" y="-10" width="20" height="20" className="constellation-icon">
              <Compass className="w-5 h-5 text-umber-900" />
            </foreignObject>
          </g>

          {/* Node 4: Pin (Activity) */}
          <g className="constellation-node" transform="translate(290, 55)">
            <circle r="18" fill="#2C2824" stroke="#FFFFFF" strokeWidth="2.5" />
            <foreignObject x="-9" y="-9" width="18" height="18" className="constellation-icon">
              <MapPin className="w-4 h-4 text-tan-500" />
            </foreignObject>
          </g>

          {/* Node 5: Destination Sparkle */}
          <g className="constellation-node" transform="translate(370, 110)">
            <circle r="18" fill="#2C2824" stroke="#A89474" strokeWidth="2.5" />
            <foreignObject x="-9" y="-9" width="18" height="18" className="constellation-icon">
              <Sparkles className="w-4 h-4 text-tan-500" />
            </foreignObject>
          </g>
        </svg>

        {/* Dynamic cycling small-caps status text */}
        <div className="mt-8 text-center">
          <p
            ref={textRef}
            className="font-sans text-xs sm:text-sm tracking-[0.3em] font-semibold text-tan-500 uppercase"
          >
            {phaseText}
          </p>
          <div className="mt-2 flex items-center justify-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-tan-500 animate-ping" />
            <span className="text-[10px] font-sans tracking-widest text-tan-500/70 uppercase">
              VOYAGE
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
