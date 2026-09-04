import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowUpRight } from "lucide-react";
import AuthForm from "@/components/auth/AuthForm";
import { getViewer } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sign in",
  description:
    "Sign in to Voyage — the itinerary, the operations board and the field run sheet, on one trip.",
  robots: { index: false, follow: false },
};

/**
 * The way in.
 *
 * A returning user does not see this page at all: if the cookie the middleware
 * just refreshed still resolves to a real user, they go straight where they
 * were headed. That check runs here rather than only in the middleware because
 * `/login` is deliberately *not* a guarded route — the guard sends people
 * here, so it cannot also be what turns them around.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: { next?: string; error?: string };
}) {
  const raw = searchParams.next ?? "";
  const next = raw.startsWith("/") && !raw.startsWith("//") ? raw : "/app";

  const viewer = await getViewer();
  if (viewer) redirect(next);

  return (
    <main
      data-scroll-theme="dark"
      className="min-h-screen bg-bg text-fg selection:bg-fg selection:text-bg flex flex-col"
    >
      {/* Deliberately not AppNav: the product nav points at three surfaces this
          visitor cannot reach yet, and offering them is a dead end. */}
      <header className="border-b border-line">
        <div className="max-w-[110rem] mx-auto px-5 sm:px-8 lg:px-12 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3 group">
            <div className="w-8 h-8 border border-line bg-fg text-bg flex items-center justify-center font-display font-black">
              V
            </div>
            <span className="font-display font-extrabold text-lg tracking-tight text-fg">
              VOYAGE
            </span>
          </Link>
          <Link
            href="/"
            className="font-sans text-xs uppercase tracking-wider text-muted hover:text-accent transition-colors flex items-center gap-1"
          >
            Back to site
            <ArrowUpRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </header>

      <div className="flex-1 max-w-[110rem] w-full mx-auto px-5 sm:px-8 lg:px-12 py-16 sm:py-24">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-14 lg:gap-24 items-center">
          {/* The pitch, restated small. Somebody arriving at a login screen from
              a shared link may never have seen the landing page. */}
          <div className="max-w-xl">
            <span className="eyebrow">· One trip, three lenses ·</span>
            <h1 className="font-display text-display-lg font-semibold uppercase text-fg text-balance">
              Pick up where the trip is.
            </h1>
            <p className="mt-6 text-body-lg text-muted">
              Your itinerary, the operations board and the guide on the ground
              are the same trip seen from three sides. Signing in decides which
              side you land on.
            </p>

            <dl className="mt-12 border-t border-line">
              {[
                [
                  "Traveler",
                  "Your plan, live costs, and Vela — who can change it with your say-so.",
                ],
                [
                  "Operator",
                  "Every group, vendor and movement, and every disruption waiting on a decision.",
                ],
                [
                  "Coordinator",
                  "Today and tomorrow on a phone. Confirm a stop, or flag one.",
                ],
              ].map(([role, blurb]) => (
                <div
                  key={role}
                  className="grid grid-cols-[8rem_1fr] gap-4 py-4 border-b border-line"
                >
                  <dt className="font-display uppercase text-label tracking-label text-accent">
                    {role}
                  </dt>
                  <dd className="text-sm text-muted leading-relaxed">{blurb}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="w-full max-w-md lg:justify-self-end">
            <AuthForm next={next} initialError={searchParams.error} />
          </div>
        </div>
      </div>

      <footer className="border-t border-line">
        <div className="max-w-[110rem] mx-auto px-5 sm:px-8 lg:px-12 py-6 flex flex-wrap gap-x-8 gap-y-2 font-sans text-xs uppercase tracking-wider text-muted">
          <span>Voyage — HackCelestia PS-7</span>
          <Link href="/privacy" className="hover:text-accent transition-colors">
            Privacy
          </Link>
          <Link href="/terms" className="hover:text-accent transition-colors">
            Terms
          </Link>
          <Link href="/security" className="hover:text-accent transition-colors">
            Security
          </Link>
        </div>
      </footer>
    </main>
  );
}
