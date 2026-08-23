import type { Metadata } from "next";
import ContentPage, { Section, List } from "@/components/layout/ContentPage";

export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "The agreement between you and Voyage: what the platform does, what it does not promise, how pricing and cancellations work, and where liability sits.",
};

export default function TermsPage() {
  return (
    <ContentPage
      eyebrow="Terms of Service"
      title="The deal between you and Voyage."
      intro="Voyage sits between you and the people who actually run your trip. These terms set out what that means in practice — what we are responsible for, and what stays with the supplier."
      updated="23 Aug 2026"
    >
      <Section number="01" heading="What Voyage is">
        <p>
          Voyage is a planning and booking platform. We let you assemble an
          itinerary from real inventory, price it live at supplier rates, and
          book it in one checkout. We are not the hotel, airline, guide, or
          transport operator — those are independent businesses, and your stay,
          flight, or tour is delivered under their terms.
        </p>
        <p>
          Where a supplier&apos;s terms conflict with these, the supplier&apos;s
          terms govern the service they provide, and these terms govern your use
          of the platform.
        </p>
      </Section>

      <Section number="02" heading="Pricing">
        <p>
          Voyage shows direct supplier rates with an itemized breakdown. We do
          not add opaque package markups. Prices update live as you change your
          itinerary, and the total shown at checkout is the total you pay.
        </p>
        <p>
          Rates and availability are set by suppliers and can move until a
          booking is confirmed. If a price changes between the moment you build
          an itinerary and the moment you confirm it, you will see the new price
          before payment — never after.
        </p>
      </Section>

      <Section number="03" heading="Bookings and changes">
        <p>
          A booking is confirmed when you receive a reservation voucher. Before
          then, nothing is held. Each component of your itinerary carries its
          own change and cancellation policy, shown against that component at
          checkout.
        </p>
        <List
          items={[
            "Changes you make yourself are subject to the affected supplier's policy and any difference in rate.",
            "Refunds are processed to the original payment method once the supplier releases them.",
            "Where a supplier cancels, we will find and offer alternatives before defaulting to a refund.",
          ]}
        />
      </Section>

      <Section number="04" heading="Adaptive re-routing">
        <p>
          Voyage monitors your itinerary and reschedules around disruption
          automatically where it can. This is a best-effort service that depends
          on live supplier availability. It does not guarantee that an
          alternative exists, and it does not replace travel insurance.
        </p>
        <p>
          You can turn automatic re-routing off, in which case we will notify you
          of disruption and wait for your instruction instead of acting.
        </p>
      </Section>

      <Section number="05" heading="Your responsibilities">
        <List
          items={[
            "Give accurate traveler details — names that match travel documents, and reachable contact details.",
            "Hold the passports, visas, and vaccinations your route requires. Voyage flags common requirements but cannot confirm your eligibility to enter a country.",
            "Use the platform lawfully, and do not scrape, resell, or attempt to disrupt it.",
          ]}
        />
      </Section>

      <Section number="06" heading="Liability">
        <p>
          We are responsible for the platform: for booking what you asked us to
          book, charging what we showed you, and handling your data as described
          in our privacy policy. Where we get that wrong, we will put it right.
        </p>
        <p>
          We are not liable for the conduct or quality of independent suppliers,
          nor for losses outside anyone&apos;s control — weather, strikes,
          closures, or civil disruption. Nothing here limits liability that
          cannot be limited by law.
        </p>
      </Section>

      <Section number="07" heading="Ending the agreement">
        <p>
          You can close your account at any time; bookings already confirmed
          stand under their own terms. We may suspend access for misuse, fraud,
          or non-payment, and will explain why when we do.
        </p>
      </Section>
    </ContentPage>
  );
}
