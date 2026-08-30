"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUpRight, Compass, Radio, LayoutGrid } from "lucide-react";

/**
 * Navigation for the product surfaces, distinct from the marketing Navbar.
 *
 * The marketing nav points at sections of the landing page, which say nothing
 * useful once you are inside a trip. What matters here is moving between the
 * three lenses on the same data — a disruption is one event seen three ways,
 * and the demo walks all three, so switching has to be one click.
 *
 * There is no auth yet, so this shows every surface to everyone. When sign-in
 * lands, the list gets filtered by the viewer's role.
 */

/** `ready: false` keeps a surface out of the nav until it exists — a dead link
 *  in the middle of a demo is worse than a missing one. All three are built
 *  now; the flag stays because the next one will need it. */
const SURFACES = [
  { label: "Traveler", href: "/app/trip", icon: Compass, match: "/trip", ready: true },
  { label: "Operations", href: "/ops", icon: LayoutGrid, match: "/ops", ready: true },
  { label: "Field", href: "/field", icon: Radio, match: "/field", ready: true },
];

export default function AppNav() {
  const pathname = usePathname();

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-surface border-b border-line">
      <div className="max-w-[110rem] mx-auto px-5 sm:px-8 lg:px-12 h-16 flex items-center justify-between gap-6">
        <Link href="/app" className="flex items-center gap-3 group shrink-0">
          <div className="w-8 h-8 border border-line bg-fg text-bg flex items-center justify-center font-display font-black">
            V
          </div>
          <span className="font-display font-extrabold text-lg tracking-tight text-fg hidden sm:block">
            VOYAGE
          </span>
        </Link>

        <nav className="flex items-center gap-1 sm:gap-2 min-w-0">
          {SURFACES.filter((s) => s.ready).map(({ label, href, icon: Icon, match }) => {
            const active = pathname.startsWith(match);
            return (
              <Link
                key={label}
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-2 px-3 sm:px-4 py-2 border font-sans text-xs uppercase tracking-wider font-bold transition-colors ${
                  active
                    ? "border-fg bg-fg text-bg"
                    : "border-line text-muted hover:text-fg hover:border-fg"
                }`}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span className="hidden sm:inline">{label}</span>
              </Link>
            );
          })}
        </nav>

        <Link
          href="/"
          className="shrink-0 font-sans text-xs uppercase tracking-wider text-muted hover:text-accent transition-colors items-center gap-1 hidden md:flex"
        >
          Site
          <ArrowUpRight className="w-3.5 h-3.5" />
        </Link>
      </div>
    </header>
  );
}
