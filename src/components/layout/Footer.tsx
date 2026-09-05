"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Sparkles } from "lucide-react";
import { XIcon, InstagramIcon, LinkedInIcon, GitHubIcon } from "@/components/ui/BrandIcons";

/** `href: null` means the channel does not exist yet. */
const SOCIALS: { Icon: typeof XIcon; label: string; href: string | null }[] = [
  { Icon: XIcon, label: "X", href: null },
  { Icon: InstagramIcon, label: "Instagram", href: null },
  { Icon: LinkedInIcon, label: "LinkedIn", href: null },
  {
    Icon: GitHubIcon,
    label: "GitHub",
    href: "https://github.com/lakshitasethia/Hackcelestia",
  },
];

const STANDARDS_LINKS = [
  { label: "Privacy Policy", href: "/privacy" },
  { label: "Terms of Service", href: "/terms" },
  { label: "Traveler Security", href: "/security" },
  { label: "API Documentation", href: "/api-docs" },
];

export default function Footer() {
  // Same reasoning as the navbar: section anchors only resolve on the home page.
  const pathname = usePathname();
  const isHome = pathname === "/";
  const sectionHref = (hash: string) => (isHome ? hash : `/${hash}`);

  return (
    <footer data-scroll-theme="dark" className="pt-20 pb-12 relative overflow-hidden">
      {/* Background Starfield (Final Bookend) */}
      <div className="absolute inset-0 pointer-events-none opacity-30">
        <Sparkles className="absolute top-[20%] left-[10%] w-4 h-4 text-accent animate-pulse" />
        <Sparkles className="absolute bottom-[30%] right-[12%] w-4 h-4 text-accent animate-pulse" />
        <div className="absolute top-1/3 right-1/4 w-1.5 h-1.5 rounded-full bg-fg animate-twinkle" />
        <div className="absolute bottom-1/4 left-1/3 w-2 h-2 rounded-full bg-fg animate-twinkle" />
      </div>

      <div className="max-w-[110rem] mx-auto px-5 sm:px-8 lg:px-12 relative z-10">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-12 pb-16 border-b border-line">
          {/* Brand Info Left */}
          <div className="md:col-span-5 flex flex-col justify-between">
            <div>
              {/* Stacked Wordmark */}
              <a href={isHome ? "#top" : "/"} aria-label={isHome ? "WAYPOINT — back to top" : "WAYPOINT — home"} className="flex items-center gap-3 group mb-4">
                <div className="w-10 h-10 border border-line bg-fg text-bg flex items-center justify-center font-display font-black text-xl">
                  W
                </div>
                <div className="flex flex-col">
                  <span className="font-display font-extrabold text-2xl tracking-tight text-fg">
                    WAYPOINT
                  </span>
                  <span className="font-sans text-xs uppercase tracking-[0.25em] font-semibold text-accent">
                    Personalized Tour Planning
                  </span>
                </div>
              </a>

              <p className="text-sm text-muted max-w-sm leading-relaxed font-medium">
                The next-generation dynamic itinerary planning & operations platform. Built to empower travelers with modular flexibility and tour operators with intelligent automation.
              </p>
            </div>

            {/* Social row — official brand marks, see BrandIcons.tsx.
                GitHub is a real link. The other three have no accounts behind
                them yet, so they lift on hover like everything else here but
                keep a "coming soon" title and no pointer cursor — greying them
                out read as broken, and faking a link that goes nowhere is
                worse than saying it is not there yet. */}
            <div className="flex items-center gap-3 mt-8">
              {SOCIALS.map(({ Icon, label, href }) => {
                const shared =
                  "w-10 h-10 border border-line bg-surface text-muted flex items-center justify-center " +
                  "transition-colors duration-200 hover:text-accent hover:border-accent";

                return href ? (
                  <a
                    key={label}
                    href={href}
                    target="_blank"
                    rel="noreferrer noopener"
                    aria-label={label}
                    title={label}
                    className={shared}
                  >
                    <Icon className="w-[18px] h-[18px]" />
                  </a>
                ) : (
                  <span
                    key={label}
                    aria-label={`${label} — coming soon`}
                    title={`${label} — coming soon`}
                    className={`${shared} cursor-default`}
                  >
                    <Icon className="w-[18px] h-[18px]" />
                  </span>
                );
              })}
            </div>
          </div>

          {/* Links Columns Right */}
          <div className="md:col-span-7 grid grid-cols-2 sm:grid-cols-3 gap-8">
            {/* Column 1: Product */}
            <div>
              <span className="font-sans text-xs uppercase tracking-[0.2em] font-bold text-accent block mb-4">
                Product
              </span>
              <ul className="space-y-2.5 font-sans text-xs">
                <li>
                  <a href={sectionHref("#destinations")} className="text-muted hover:text-accent transition-colors">
                    Discover Catalog
                  </a>
                </li>
                <li>
                  <a href={sectionHref("#how-it-works")} className="text-muted hover:text-accent transition-colors">
                    How It Works
                  </a>
                </li>
                <li>
                  <a href={sectionHref("#features")} className="text-muted hover:text-accent transition-colors">
                    Live Pricing Engine
                  </a>
                </li>
                <li>
                  <a href={sectionHref("#features")} className="text-muted hover:text-accent transition-colors">
                    Adaptive Sentinel
                  </a>
                </li>
                <li>
                  <a href={sectionHref("#pricing")} className="text-muted hover:text-accent transition-colors">
                    Pricing & Tiers
                  </a>
                </li>
              </ul>
            </div>

            {/* Column 2: Operators & Company */}
            <div>
              <span className="font-sans text-xs uppercase tracking-[0.2em] font-bold text-accent block mb-4">
                Platform
              </span>
              <ul className="space-y-2.5 font-sans text-xs">
                <li>
                  <a href={sectionHref("#for-operators")} className="text-muted hover:text-accent transition-colors">
                    For Tour Operators
                  </a>
                </li>
                <li>
                  <a href={sectionHref("#for-operators")} className="text-muted hover:text-accent transition-colors">
                    DMC Back Office
                  </a>
                </li>
                <li>
                  <a href={sectionHref("#for-operators")} className="text-muted hover:text-accent transition-colors">
                    Vendor Dispatch API
                  </a>
                </li>
                <li>
                  <a href={sectionHref("#for-operators")} className="text-muted hover:text-accent transition-colors">
                    Partner Network
                  </a>
                </li>
              </ul>
            </div>

            {/* Column 3: Legal & Standards */}
            <div>
              <span className="font-sans text-xs uppercase tracking-[0.2em] font-bold text-accent block mb-4">
                Standards
              </span>
              <ul className="space-y-2.5 font-sans text-xs">
                {STANDARDS_LINKS.map(({ label, href }) => (
                  <li key={href}>
                    <Link
                      href={href}
                      className="text-muted hover:text-accent transition-colors"
                    >
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="pt-8 flex flex-col sm:flex-row items-center justify-between gap-4 font-sans text-xs text-muted">
          <div className="flex items-center gap-2">
            <span>© 2026 WAYPOINT Inc. All rights reserved.</span>
          </div>

        </div>
      </div>
    </footer>
  );
}
