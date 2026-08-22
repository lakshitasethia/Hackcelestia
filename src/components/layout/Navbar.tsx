"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Menu, X, Compass, ArrowRight, Sparkles } from "lucide-react";

export default function Navbar() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      if (window.scrollY > 60) {
        setIsScrolled(true);
      } else {
        setIsScrolled(false);
      }
    };

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

  const navLinks = [
    { label: "Discover", href: "#destinations" },
    { label: "How It Works", href: "#how-it-works" },
    { label: "Features", href: "#features" },
    { label: "For Operators", href: "#for-operators" },
    { label: "Pricing", href: "#pricing" },
  ];

  return (
    <>
      <header
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
 isScrolled
 ? "bg-surface backdrop-blur-md border-b border-line shadow-sm py-3.5"
 : "bg-gradient-to-b from-black/60 via-black/20 to-transparent py-5"
 }`}
      >
        <div className="max-w-[110rem] mx-auto px-5 sm:px-8 lg:px-12 flex items-center justify-between">
          {/* Logo / Wordmark */}
          <Link
            href="/"
            className="flex items-center gap-3 group focus:outline-none"
          >
            <div
              className={`w-9 h-9 border border-line flex items-center justify-center font-display font-black text-lg transition-transform duration-200 group-hover:scale-105 ${
 isScrolled
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
          </Link>

          {/* Desktop Center Nav Links */}
          <nav className="hidden md:flex items-center gap-7 lg:gap-9">
            {navLinks.map((link) => (
              <a
                key={link.label}
                href={link.href}
                className={`font-sans text-xs uppercase tracking-wider font-bold transition-colors duration-150 relative py-1 hover:text-accent ${
 isScrolled ? "text-fg" : "text-fg hover:text-accent"
 }`}
              >
                {link.label}
              </a>
            ))}
          </nav>

          {/* Desktop Right CTAs */}
          <div className="hidden md:flex items-center gap-4">
            <a
              href="#pricing"
              className={`font-sans text-xs uppercase tracking-wider font-bold transition-colors py-2 px-3 hover:text-accent ${
 isScrolled ? "text-fg" : "text-fg hover:text-accent"
 }`}
            >
              Log In
            </a>
            <a
              href="#features"
              className="btn-solid py-2.5 px-5 text-xs tracking-wider"
            >
              <span>Start Planning</span>
              <ArrowRight className="w-3.5 h-3.5 ml-1.5 inline" />
            </a>
          </div>

          {/* Mobile Menu Trigger */}
          <div className="flex md:hidden items-center gap-3">
            <a
              href="#features"
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
              {navLinks.map((link, idx) => (
                <a
                  key={link.label}
                  href={link.href}
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
              href="#features"
              onClick={() => setMobileMenuOpen(false)}
              className="btn-solid w-full py-4 text-sm font-bold tracking-wider"
            >
              Start Planning Trip
              <ArrowRight className="w-4 h-4 ml-2 inline" />
            </a>
          </div>
        </div>
      )}
    </>
  );
}
