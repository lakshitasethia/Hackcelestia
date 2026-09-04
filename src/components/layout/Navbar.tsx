"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { Menu, X, ArrowRight, Sparkles, LogOut } from "lucide-react";
import { signOutAction } from "@/app/login/actions";

/**
 * Every entry points at a section that exists on the page; ScrollEffects
 * intercepts the click and scrolls there smoothly, clear of the fixed header.
 */
const NAV_LINKS = [
  { label: "Discover", href: "#destinations" },
  { label: "How It Works", href: "#how-it-works" },
  { label: "Features", href: "#features" },
  { label: "For Operators", href: "#for-operators" },
  { label: "Pricing", href: "#pricing" },
];

/** "Start Planning" now leads into the product rather than to a section of
 *  the marketing page. A real route, so it is never passed through
 *  sectionHref() — that only prefixes hashes. */
const PLAN_HREF = "/app";

/**
 * The signed-in half of the header.
 *
 * Passed down from the server components that render this one rather than
 * fetched here: the marketing page is a server component and already has the
 * cookie in hand, and doing it client-side would flash "Log In" at a
 * signed-in reader on every load.
 */
export type NavViewer = { name: string } | null;

export default function Navbar({ viewer = null }: { viewer?: NavViewer }) {
  const [isScrolled, setIsScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<string>("");

  // The nav points at sections of the home page. Away from home those anchors
  // do not exist, so send the link back to "/" and let the hash resolve there.
  const pathname = usePathname();
  const isHome = pathname === "/";
  const sectionHref = (hash: string) => (isHome ? hash : `/${hash}`);
  const homeHref = isHome ? "#top" : "/";

  // Off the home page there is no hero image behind the header, so the
  // transparent treatment has nothing to sit on — keep it solid throughout.
  const solid = isScrolled || !isHome;

  useEffect(() => {
    // Lenis scrolls the window natively, so a plain scroll listener stays in
    // sync with it — no separate subscription needed.
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 60);

      // Whichever linked section sits under the upper third of the viewport is
      // the one the reader is on.
      const marker = window.innerHeight * 0.35;
      let current = "";
      for (const { href } of NAV_LINKS) {
        const el = document.getElementById(href.slice(1));
        if (!el) continue;
        const { top, bottom } = el.getBoundingClientRect();
        if (top <= marker && bottom > marker) current = href;
      }
      setActiveSection(current);
    };

    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Lock body scroll when mobile menu is open
  useEffect(() => {
    if (mobileMenuOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "unset";
    }
  }, [mobileMenuOpen]);

  return (
    <>
      <header
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
 solid
 ? "bg-surface backdrop-blur-md border-b border-line shadow-sm py-3.5"
 : "bg-gradient-to-b from-black/60 via-black/20 to-transparent py-5"
 }`}
      >
        <div className="max-w-[110rem] mx-auto px-5 sm:px-8 lg:px-12 flex items-center justify-between">
          {/* Logo / Wordmark */}
          <a
            href={homeHref}
            aria-label={isHome ? "VOYAGE — back to top" : "VOYAGE — home"}
            className="flex items-center gap-3 group focus:outline-none"
          >
            <div
              className={`w-9 h-9 border border-line flex items-center justify-center font-display font-black text-lg transition-transform duration-200 group-hover:scale-105 ${
 solid
 ? "bg-fg text-bg"
 : "bg-surface text-fg"
 }`}
            >
              V
            </div>
            <div className="flex flex-col">
              <span
                className={`font-display font-extrabold text-xl sm:text-2xl tracking-tight leading-none transition-colors ${
 isScrolled ? "text-fg" : "text-fg"
 }`}
              >
                VOYAGE
              </span>
              <span
                className={`font-sans text-xs uppercase tracking-[0.25em] font-semibold mt-0.5 transition-colors ${
 isScrolled ? "text-accent" : "text-accent"
 }`}
              >
                Personalized Tour Planning
              </span>
            </div>
          </a>

          {/* Desktop Center Nav Links */}
          <nav className="hidden md:flex items-center gap-7 lg:gap-9">
            {NAV_LINKS.map((link) => {
              const isActive = activeSection === link.href;
              return (
                <a
                  key={link.label}
                  href={sectionHref(link.href)}
                  aria-current={isActive ? "true" : undefined}
                  className={`font-sans text-xs uppercase tracking-wider font-bold transition-colors duration-150 relative py-1 hover:text-accent ${
 isActive ? "text-accent" : "text-fg hover:text-accent"
 }`}
                >
                  {link.label}
                  <span
                    className={`absolute left-0 -bottom-0.5 h-px bg-accent transition-all duration-300 ${
 isActive ? "w-full opacity-100" : "w-0 opacity-0"
 }`}
                  />
                </a>
              );
            })}
          </nav>

          {/* Desktop Right CTAs */}
          <div className="hidden md:flex items-center gap-4">
            {/* Signed in, the useful thing is a way back into the trip and a
                way out — not an invitation to log in again. */}
            {viewer ? (
              <form action={signOutAction}>
                <button
                  type="submit"
                  className="font-sans text-xs uppercase tracking-wider font-bold py-1 px-3 text-muted hover:text-accent transition-colors duration-150 flex items-center gap-1.5"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  Sign out
                </button>
              </form>
            ) : (
              <a
                href="/login"
                className="font-sans text-xs uppercase tracking-wider font-bold py-1 px-3 text-fg hover:text-accent transition-colors duration-150 relative group"
              >
                Log In
                <span className="absolute left-3 right-3 -bottom-0.5 h-px bg-accent w-0 group-hover:w-[calc(100%-1.5rem)] opacity-0 group-hover:opacity-100 transition-all duration-300" />
              </a>
            )}
            <a
              href={PLAN_HREF}
              className="btn-solid py-2.5 px-5 text-xs tracking-wider"
            >
              <span>{viewer ? `Resume, ${viewer.name}` : "Start Planning"}</span>
              <ArrowRight className="w-3.5 h-3.5 ml-1.5 inline" />
            </a>
          </div>

          {/* Mobile Menu Trigger */}
          <div className="flex md:hidden items-center gap-3">
            <a
              href={PLAN_HREF}
              className="btn-solid py-2 px-3 text-sm"
            >
              Plan Trip
            </a>
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label="Toggle navigation menu"
              className={`p-2 border border-line transition-colors ${
 isScrolled ? "bg-surface text-fg" : "bg-surface text-fg"
 }`}
            >
              {mobileMenuOpen ? (
                <X className="w-5 h-5" />
              ) : (
                <Menu className="w-5 h-5" />
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Mobile Celestial Full-Screen Overlay Menu */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-40 bg-surface text-fg flex flex-col justify-between p-6 sm:p-8 pt-28 overflow-y-auto animate-in fade-in duration-200">
          {/* Subtle starfield particles */}
          <div className="absolute inset-0 pointer-events-none opacity-40">
            <Sparkles className="absolute top-[12%] right-[10%] w-4 h-4 text-accent" />
            <Sparkles className="absolute bottom-[20%] left-[8%] w-5 h-5 text-accent" />
            <div className="absolute top-1/3 left-1/4 w-1.5 h-1.5 rounded-full bg-fg animate-twinkle" />
            <div className="absolute top-2/3 right-1/4 w-2 h-2 rounded-full bg-fg animate-twinkle" />
          </div>

          <div className="relative z-10 flex flex-col gap-6">
            <div className="font-sans text-xs text-accent tracking-[0.25em] uppercase">
              · NAVIGATION MENU ·
            </div>
            <nav className="flex flex-col gap-5">
              {NAV_LINKS.map((link, idx) => (
                <a
                  key={link.label}
                  href={sectionHref(link.href)}
                  onClick={() => setMobileMenuOpen(false)}
                  className="group flex items-center justify-between font-display text-3xl font-bold border-b border-line pb-3 hover:text-accent transition-colors"
                >
                  <span>{link.label}</span>
                  <span className="font-sans text-xs text-muted group-hover:text-accent">
                    0{idx + 1}
                  </span>
                </a>
              ))}
            </nav>
          </div>

          <div className="relative z-10 pt-8 border-t border-line flex flex-col gap-4">
            <a
              href={PLAN_HREF}
              onClick={() => setMobileMenuOpen(false)}
              className="btn-solid w-full py-4 text-sm font-bold tracking-wider"
            >
              Start Planning Trip
              <ArrowRight className="w-4 h-4 ml-2 inline" />
            </a>
            {viewer ? (
              <form action={signOutAction}>
                <button
                  type="submit"
                  className="btn-outline w-full py-4 text-sm font-bold tracking-wider"
                >
                  <LogOut className="w-4 h-4" />
                  Sign out
                </button>
              </form>
            ) : (
              <a
                href="/login"
                onClick={() => setMobileMenuOpen(false)}
                className="btn-outline w-full py-4 text-sm font-bold tracking-wider"
              >
                Log in
              </a>
            )}
          </div>
        </div>
      )}
    </>
  );
}
