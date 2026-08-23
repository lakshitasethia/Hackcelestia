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
 *
 * The page runs dark → tan → dark and then stays dark: one light block
 * (FeatureShowcase) breaking up an otherwise dark page. Inverting on every
 * section read as restless.
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
} as const;

export type ScrollThemeName = keyof typeof SCROLL_THEMES;

/**
 * Clearance for the fixed header, used only on the reduced-motion path below.
 * Lenis reads `scroll-margin-top` off the target itself, so the rule in
 * globals.css is the source of truth for the smooth path — applying this offset
 * there as well would double-count it. Keep the two values in step.
 */
const HEADER_OFFSET = 88;

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

    /* ---------- 1b. Same-page anchor navigation ----------
       Lenis owns the scroll position, so a native hash jump would fight it and
       land the section under the fixed header. One delegated listener handles
       every in-page link on the site — nav, footer, and section CTAs alike —
       so no individual link has to know about the offset. */
    const scrollToTarget = (hash: string): boolean => {
      if (hash === "#" || hash === "#top") {
        if (lenis) lenis.scrollTo(0, { duration: 1.2 });
        else window.scrollTo({ top: 0, behavior: prefersReduced ? "auto" : "smooth" });
        return true;
      }

      let target: Element | null = null;
      try {
        target = document.querySelector(hash);
      } catch {
        return false;
      }
      if (!target) return false;

      if (lenis) {
        // No `offset` here on purpose — Lenis subtracts the target's own
        // scroll-margin-top, which globals.css already sets to the header height.
        lenis.scrollTo(target as HTMLElement, { duration: 1.2 });
      } else {
        const top =
          target.getBoundingClientRect().top + window.scrollY - HEADER_OFFSET;
        window.scrollTo({ top, behavior: prefersReduced ? "auto" : "smooth" });
      }
      return true;
    };

    const onDocumentClick = (event: MouseEvent) => {
      // Leave modified clicks (new tab/window) and anything already handled alone.
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      const anchor = (event.target as HTMLElement | null)?.closest?.("a");
      const href = anchor?.getAttribute("href");
      if (!href || !href.startsWith("#")) return;

      event.preventDefault();

      // The mobile menu unlocks body scroll in the same tick; scroll on the
      // next frame so the lock is gone before the tween starts.
      requestAnimationFrame(() => {
        if (!scrollToTarget(href)) return;
        const isTop = href === "#" || href === "#top";
        window.history.replaceState(
          null,
          "",
          isTop ? window.location.pathname + window.location.search : href
        );
      });
    };

    document.addEventListener("click", onDocumentClick);

    // Honour a hash the page was opened with, once layout has settled.
    const initialHash = window.location.hash;
    const deepLinkTimer = initialHash
      ? window.setTimeout(() => scrollToTarget(initialHash), 250)
      : 0;

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

      // Only *set* the variables — the CSS transition on :root does the
      // animating (see globals.css). No tween to strand, and nothing here can
      // feed back into ScrollTrigger, so there is no refresh loop.
      const syncTheme = () => {
        const name = themeAtCentre();
        // No themed section under the centre (a gap) — keep what we have.
        if (!name || name === currentTheme) return;
        const theme = SCROLL_THEMES[name as ScrollThemeName];
        if (!theme) return;
        currentTheme = name;
        for (const [prop, value] of Object.entries(theme)) {
          root.style.setProperty(prop, value);
        }
      };

      ScrollTrigger.create({
        start: 0,
        end: "max",
        onUpdate: syncTheme,
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
      document.removeEventListener("click", onDocumentClick);
      window.clearTimeout(deepLinkTimer);
      window.removeEventListener("load", refresh);
      window.clearTimeout(refreshTimer);
      cancelAnimationFrame(rafId);
      ctx.revert();
      lenis?.destroy();
    };
  }, []);

  return null;
}
