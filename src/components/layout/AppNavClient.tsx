"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUpRight, Compass, Radio, LayoutGrid, LogOut, Search } from "lucide-react";
import { signOutAction } from "@/app/login/actions";

/**
 * Navigation for the product surfaces, distinct from the marketing Navbar.
 *
 * The marketing nav points at sections of the landing page, which say nothing
 * useful once you are inside a trip. What matters here is moving between the
 * three lenses on the same data — a disruption is one event seen three ways,
 * and the demo walks all three, so switching has to be one click.
 *
 * The list is filtered by role now, which it deliberately was not before. While
 * every read went through the service-role client, hiding `/ops` from a
 * traveler would have removed a link without removing the access behind it —
 * theatre, and a lie about what the app enforces. Reads go through RLS today,
 * so the nav and the database finally agree: a traveler who types `/ops`
 * reaches a board with nothing on it, and not showing them the link is
 * honesty rather than a fig leaf.
 *
 * Signed out, everything shows. That path only renders when AUTH_ENFORCED is
 * false — the demo escape hatch, where there are no roles to filter by.
 *
 * The presentational half of AppNav. `AppNav` itself is the server component
 * that reads the session and renders this.
 */

/** `ready: false` keeps a surface out of the nav until it exists — a dead link
 *  in the middle of a demo is worse than a missing one. All three are built
 *  now; the flag stays because the next one will need it. */
const SURFACES = [
  {
    // Discover, the first stage in the brief. Ahead of the itinerary in the
    // nav because it is ahead of it in the journey: you look before you book.
    label: "Explore",
    href: "/explore",
    icon: Search,
    match: "/explore",
    ready: true,
    roles: ["traveler", "operator", "coordinator"],
  },
  {
    label: "Traveler",
    href: "/app/trip",
    icon: Compass,
    match: "/trip",
    ready: true,
    // An operator opens a group's itinerary constantly; a coordinator works
    // from the run sheet and has no use for the booking view.
    roles: ["traveler", "operator"],
  },
  {
    label: "Operations",
    href: "/ops",
    icon: LayoutGrid,
    match: "/ops",
    ready: true,
    roles: ["operator"],
  },
  {
    label: "Field",
    href: "/field",
    icon: Radio,
    match: "/field",
    ready: true,
    // The operator keeps this because on a bad morning they are the one
    // checking what the guide has reported.
    roles: ["coordinator", "operator"],
  },
];

export default function AppNavClient({
  viewer,
}: {
  viewer: { name: string; role: string } | null;
}) {
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
          {SURFACES.filter(
            (s) => s.ready && (!viewer || s.roles.includes(viewer.role))
          ).map(({ label, href, icon: Icon, match }) => {
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

        <div className="shrink-0 flex items-center gap-4">
          {viewer && (
            <span className="hidden lg:flex items-baseline gap-2 font-sans text-xs uppercase tracking-wider">
              <span className="text-fg font-bold">{viewer.name}</span>
              <span className="text-muted">{viewer.role}</span>
            </span>
          )}

          <Link
            href="/"
            className="font-sans text-xs uppercase tracking-wider text-muted hover:text-accent transition-colors items-center gap-1 hidden md:flex"
          >
            Site
            <ArrowUpRight className="w-3.5 h-3.5" />
          </Link>

          {viewer ? (
            <form action={signOutAction}>
              <button
                type="submit"
                title="Sign out"
                className="flex items-center gap-1.5 font-sans text-xs uppercase tracking-wider text-muted hover:text-accent transition-colors"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Out</span>
              </button>
            </form>
          ) : (
            <Link
              href="/login"
              className="flex items-center gap-1.5 font-sans text-xs uppercase tracking-wider text-fg hover:text-accent transition-colors"
            >
              Log in
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
