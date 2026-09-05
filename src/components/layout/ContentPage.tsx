import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import Navbar from "@/components/layout/Navbar";
import { getViewer, firstName } from "@/lib/auth/session";
import Footer from "@/components/layout/Footer";

/**
 * Shared shell for the standing pages linked from the footer — privacy, terms,
 * security, API. They share the marketing chrome but drop the scroll-theme
 * inversion: these are read top to bottom, so the palette stays put.
 */
export default async function ContentPage({
  eyebrow,
  title,
  intro,
  updated,
  children,
}: {
  eyebrow: string;
  title: string;
  intro: string;
  updated: string;
  children: React.ReactNode;
}) {
  const viewer = await getViewer();

  return (
    <main
      data-scroll-theme="dark"
      className="min-h-screen bg-surface text-fg selection:bg-fg selection:text-bg"
    >
      <Navbar viewer={viewer ? { name: firstName(viewer) } : null} />

      <article className="max-w-[110rem] mx-auto px-5 sm:px-8 lg:px-12 pt-36 sm:pt-44 pb-20">
        <header className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-16 items-end pb-12 border-b border-line">
          <div className="lg:col-span-8">
            <span className="eyebrow">· {eyebrow} ·</span>
            <h1 className="font-display text-display-lg font-semibold uppercase text-fg text-balance">
              {title}
            </h1>
            <p className="mt-6 text-body-lg text-muted max-w-2xl">{intro}</p>
          </div>

          <div className="lg:col-span-4 lg:pl-10 lg:border-l border-line">
            <span className="block font-display uppercase text-label tracking-label text-accent">
              Last updated
            </span>
            <span className="mt-2 block font-display text-2xl font-semibold uppercase tracking-tight text-fg">
              {updated}
            </span>
            <p className="mt-4 text-sm text-muted leading-relaxed">
              Waypoint is pre-launch. This document describes how the platform is
              built to operate and will be revised before it handles live
              traveler bookings.
            </p>
          </div>
        </header>

        <div className="mt-14 grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-16">
          <div className="lg:col-span-8 lg:col-start-1 max-w-3xl flex flex-col gap-10">
            {children}
          </div>
        </div>

        <div className="mt-20 pt-8 border-t border-line">
          <Link href="/" className="link-underline">
            <ArrowLeft className="w-4 h-4" />
            <span>Back to Waypoint</span>
          </Link>
        </div>
      </article>

      <Footer />
    </main>
  );
}

/** One numbered section of a standing document. */
export function Section({
  number,
  heading,
  children,
}: {
  number: string;
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-line pt-6 first:border-t-0 first:pt-0">
      <div className="flex items-baseline gap-4">
        <span className="font-sans text-xs font-bold uppercase tracking-wider text-accent">
          {number}
        </span>
        <h2 className="font-display text-display-sm font-semibold uppercase text-fg">
          {heading}
        </h2>
      </div>
      <div className="mt-4 flex flex-col gap-4 text-muted leading-relaxed">
        {children}
      </div>
    </section>
  );
}

/** Bulleted list styled to match the body copy. */
export function List({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="flex flex-col gap-2.5">
      {items.map((item, idx) => (
        <li key={idx} className="flex gap-3">
          <span aria-hidden className="text-accent mt-0.5">
            ·
          </span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}
