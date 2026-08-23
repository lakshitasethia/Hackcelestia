import type { Metadata } from "next";
import ContentPage, { Section, List } from "@/components/layout/ContentPage";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "What Voyage collects when you plan a trip, why each piece is needed, who it is shared with, and the control you keep over it.",
};

export default function PrivacyPage() {
  return (
    <ContentPage
      eyebrow="Privacy Policy"
      title="What we hold, and why we hold it."
      intro="Planning a trip means telling us where you want to go, when, and with whom. This page sets out exactly what that data is used for — and what it is never used for."
      updated="23 Aug 2026"
    >
      <Section number="01" heading="What we collect">
        <p>
          Voyage collects three kinds of information, and nothing beyond what a
          booking actually requires:
        </p>
        <List
          items={[
            <>
              <strong className="text-fg">Trip details</strong> — destinations,
              dates, guest count, comfort tier, budget, and any preferences you
              set (dietary needs, pace, mobility requirements, transfer
              preferences).
            </>,
            <>
              <strong className="text-fg">Traveler details</strong> — the names,
              contact details, and document information an operator or airline
              needs to hold a reservation in your name.
            </>,
            <>
              <strong className="text-fg">Usage data</strong> — which itineraries
              you built and abandoned, and basic device and error telemetry, used
              to fix bugs and improve the planner.
            </>,
          ]}
        />
        <p>
          Payment card details are handled by our payment processor and are never
          stored on Voyage servers.
        </p>
      </Section>

      <Section number="02" heading="Why we hold it">
        <p>
          Trip and traveler details exist to place and maintain your bookings —
          including the adaptive re-routing the platform is built around. When a
          delay or cancellation hits, Voyage needs your live itinerary and
          contact details to find an alternative and confirm it with the
          supplier on your behalf.
        </p>
        <p>
          Usage data is aggregated. We use it to understand which parts of the
          planner are confusing, not to profile you.
        </p>
      </Section>

      <Section number="03" heading="Who it is shared with">
        <p>
          Voyage is a direct-to-supplier platform, so your details reach the
          parties who actually deliver the trip and no one else:
        </p>
        <List
          items={[
            "Hotels, tour operators, guides, and transport providers on your itinerary — limited to what that specific booking requires.",
            "Our payment processor, for the transaction itself.",
            "Infrastructure providers that host the platform, under contract and bound to the same restrictions.",
            "Authorities, where a booking legally requires it (border and accommodation registration rules vary by country).",
          ]}
        />
        <p>
          We do not sell your data, and we do not share it with advertisers or
          data brokers.
        </p>
      </Section>

      <Section number="04" heading="How long we keep it">
        <p>
          Draft itineraries you never book are deleted after 12 months of
          inactivity. Completed booking records are retained for 7 years, which
          is the period tax and consumer-protection rules require for travel
          transactions. Usage telemetry is retained in aggregate for 24 months.
        </p>
      </Section>

      <Section number="05" heading="Your control">
        <p>
          You can request a copy of everything we hold on you, correct anything
          inaccurate, or ask for deletion of any data we are not legally required
          to retain. You can also withdraw consent for optional processing
          without losing access to bookings you have already made.
        </p>
        <p>
          Requests go to{" "}
          <a
            href="mailto:privacy@voyage.travel"
            className="text-fg underline underline-offset-4 hover:text-accent transition-colors"
          >
            privacy@voyage.travel
          </a>{" "}
          and are answered within 30 days.
        </p>
      </Section>

      <Section number="06" heading="Changes to this policy">
        <p>
          If this policy changes in a way that affects how your data is used, we
          will say so directly rather than quietly updating the date at the top
          of the page. Material changes are announced to account holders before
          they take effect.
        </p>
      </Section>
    </ContentPage>
  );
}
