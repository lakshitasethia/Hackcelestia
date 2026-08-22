"use client";

import { useEffect } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";

/**
 * Two-tone scroll themes sampled from sondaven.com/en.
 *
 * The reference site works by inverting exactly two colours — #2C2824 warm
 * dark brown and #A89474 warm tan — as you move down the page. Each theme
 * pairs a background with a foreground guaranteed legible against it, so
 * sections pick a theme rather than hand-picking colours and text can never
 * end up invisible.
 */
export const SCROLL_THEMES = {
  dark: {
    "--bg-scroll": "#2C2824",
    "--fg-scroll": "#A89474",
    "--fg-muted-scroll": "rgba(168,148,116,0.62)",
    "--line-scroll": "rgba(168,148,116,0.22)",
    "--accent-scroll": "#FFFFFF",
    "--surface-scroll": "#211E1A",
  },
  tan: {
    "--bg-scroll": "#A89474",
    "--fg-scroll": "#2C2824",
    "--fg-muted-scroll": "rgba(44,40,36,0.68)",
    "--line-scroll": "rgba(44,40,36,0.26)",
    "--accent-scroll": "#2C2824",
    "--surface-scroll": "#B9A88C",
  },
  deep: {
    "--bg-scroll": "#171512",
    "--fg-scroll": "#A89474",
    "--fg-muted-scroll": "rgba(168,148,116,0.58)",
    "--line-scroll": "rgba(168,148,116,0.2)",
    "--accent-scroll": "#FFFFFF",
    "--surface-scroll": "#211E1A",
  },
} as const;

export type ScrollThemeName = keyof typeof SCROLL_THEMES;

export default function ScrollEffects() {
  useEffect(() => {
    gsap.registerPlugin(ScrollTrigger);
    document.documentElement.classList.add("gsap-ready");

    const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    /* ---------- 1. Lenis smooth scroll, driving ScrollTrigger ---------- */
    let lenis: Lenis | null = null;
    let rafId = 0;

    if (!prefersReduced) {
      lenis = new Lenis({
        duration: 1.1,
        easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
        smoothWheel: true,
        touchMultiplier: 1.6,
      });

      lenis.on("scroll", ScrollTrigger.update);

      const raf = (time: number) => {
        lenis?.raf(time);
        rafId = requestAnimationFrame(raf);
      };
      rafId = requestAnimationFrame(raf);
    }

    const ctx = gsap.context(() => {
      /* ---------- 2. Scroll-driven background + text colour ----------
         One source of truth: whichever themed section covers the viewport
         centre wins. Per-section onEnter/onEnterBack triggers overlap and
         fight, which strands the tween on a blend of two themes and destroys
         contrast — so resolve the winner once per update instead. */
      const themed = gsap.utils.toArray<HTMLElement>("[data-scroll-theme]");
      const root = document.documentElement;
      let currentTheme: string | null = null;

      const themeAtCentre = (): string | null => {
        const mid = window.innerHeight / 2;
        let found: string | null = null;
        for (const section of themed) {
          const { top, bottom } = section.getBoundingClientRect();
          if (top <= mid && bottom > mid) found = section.dataset.scrollTheme ?? null;
        }
        return found;
      };

      const syncTheme = () => {
        const name = themeAtCentre();
        // No themed section under the centre (a gap) — keep what we have.
        if (!name || name === currentTheme) return;
        const theme = SCROLL_THEMES[name as ScrollThemeName];
        if (!theme) return;
        currentTheme = name;
        gsap.to(root, {
          ...theme,
          duration: 0.6,
          ease: "power2.out",
          overwrite: true,
        });
      };

      ScrollTrigger.create({
        start: 0,
        end: "max",
        onUpdate: syncTheme,
        onRefresh: syncTheme,
      });

      syncTheme();

      /* ---------- 3. Fade-up reveals ----------
         Per-element fromTo rather than ScrollTrigger.batch: batch resolves its
         start positions once and, under Lenis' virtual scroll, silently fails
         to fire for elements that were off-screen at creation — leaving whole
         sections stranded at opacity 0. */
      const revealEls = gsap.utils.toArray<HTMLElement>("[data-reveal]");
      revealEls.forEach((el) => {
        gsap.fromTo(
          el,
          { opacity: 0, y: 24 },
          {
            opacity: 1,
            y: 0,
            duration: 0.9,
            ease: "power3.out",
            scrollTrigger: {
              trigger: el,
              start: "top 90%",
              once: true,
              invalidateOnRefresh: true,
            },
          }
        );
      });

      /* ---------- 4. Subtle parallax ---------- */
      gsap.utils.toArray<HTMLElement>("[data-parallax]").forEach((el) => {
        const strength = parseFloat(el.dataset.parallax || "12");
        gsap.to(el, {
          yPercent: strength,
          ease: "none",
          scrollTrigger: {
            trigger: el,
            start: "top bottom",
            end: "bottom top",
            scrub: true,
          },
        });
      });
    });

    // Sections may settle after fonts/images load; recalc once stable.
    const refresh = () => ScrollTrigger.refresh();
    window.addEventListener("load", refresh);
    const refreshTimer = window.setTimeout(refresh, 600);

    return () => {
      window.removeEventListener("load", refresh);
      window.clearTimeout(refreshTimer);
      cancelAnimationFrame(rafId);
      ctx.revert();
      lenis?.destroy();
    };
  }, []);

  return null;
}
