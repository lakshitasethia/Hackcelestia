"use client";

import { useEffect, useRef, type ElementType } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

/**
 * Scroll-scrubbed word-by-word text reveal, after the `data-highlight-text`
 * treatment on sondaven.com/en: the passage sits dimmed, and each word lifts to
 * full strength as the block travels up the viewport.
 *
 * Words are split in the DOM but the original string stays intact for screen
 * readers via aria-label, and each space is preserved so copy/paste still works.
 */
export default function HighlightText({
  children,
  as: Tag = "p",
  className = "",
  dim = 0.18,
}: {
  children: string;
  as?: ElementType;
  className?: string;
  /** Opacity of an un-revealed word. */
  dim?: number;
}) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    gsap.registerPlugin(ScrollTrigger);
    const words = el.querySelectorAll<HTMLElement>("[data-word]");
    if (!words.length) return;

    // Reduced motion: show the finished state, skip the scrub entirely.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      gsap.set(words, { opacity: 1 });
      return;
    }

    const ctx = gsap.context(() => {
      gsap.fromTo(
        words,
        { opacity: dim },
        {
          opacity: 1,
          ease: "none",
          stagger: 1,
          scrollTrigger: {
            trigger: el,
            start: "top 82%",
            end: "bottom 55%",
            scrub: true,
          },
        }
      );
    }, el);

    return () => ctx.revert();
  }, [children, dim]);

  const words = children.split(" ");

  return (
    <Tag ref={ref} className={className} aria-label={children}>
      {words.map((word, i) => (
        <span key={i} data-word aria-hidden="true" style={{ opacity: dim }}>
          {word}
          {i < words.length - 1 ? " " : ""}
        </span>
      ))}
    </Tag>
  );
}
