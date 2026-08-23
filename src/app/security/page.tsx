import type { Metadata } from "next";
import ContentPage, { Section, List } from "@/components/layout/ContentPage";

export const metadata: Metadata = {
  title: "Traveler Security",
  description:
    "How Voyage protects traveler data and bookings — encryption, access control, payment handling, supplier vetting, and how to report a vulnerability.",
};

export default function SecurityPage() {
  return (
    <ContentPage
      eyebrow="Traveler Security"
      title="Protecting the trip and the data behind it."
      intro="A travel platform holds two things worth protecting: your identity documents and your whereabouts. Here is how both are handled, and how to tell us if we have got something wrong."
      updated="23 Aug 2026"
    >
      <Section number="01" heading="Data in transit and at rest">
        <p>
          All traffic to Voyage runs over TLS 1.3. Traveler records, itinerary
          data, and document details are encrypted at rest with AES-256, and
          encryption keys are managed separately from the systems that read
          them.
        </p>
      </Section>

      <Section number="02" heading="Payment handling">
        <p>
          Card details are captured by a PCI-DSS compliant processor and never
          touch Voyage servers. We store a token that lets us charge or refund a
          booking; we cannot read your card number, and neither can our
          suppliers.
        </p>
      </Section>

      <Section number="03" heading="Access control">
        <p>
          Access to traveler data is least-privilege and audited. Support staff
          see only the booking they are actively helping with, engineers work
          against anonymized data by default, and every production access is
          logged with a reason.
        </p>
        <List
          items={[
            "Multi-factor authentication is mandatory for all internal accounts.",
            "Production access is time-boxed and expires automatically.",
            "Access logs are retained and reviewed independently of the team being logged.",
          ]}
        />
      </Section>

      <Section number="04" heading="Supplier vetting">
        <p>
          Operators on the platform are verified before they can receive
          bookings — legal entity, licensing where the destination requires it,
          and insurance. Suppliers receive only the traveler details their
          specific booking needs, and their access is revoked when the trip
          completes.
        </p>
      </Section>

      <Section number="05" heading="While you are travelling">
        <p>
          Your live location is never tracked. Adaptive re-routing works from
          your itinerary and from supplier disruption feeds — flight status,
          weather, closures — not from your device. Notifications go to the
          contact details on the booking, and you choose whether a companion is
          copied.
        </p>
      </Section>

      <Section number="06" heading="Reporting a vulnerability">
        <p>
          If you find a security issue, tell us before you tell anyone else and
          we will work it through with you. Send details to{" "}
          <a
            href="mailto:security@voyage.travel"
            className="text-fg underline underline-offset-4 hover:text-accent transition-colors"
          >
            security@voyage.travel
          </a>
          . We acknowledge reports within two business days.
        </p>
        <p>
          We will not pursue legal action against researchers who report in good
          faith, stay within the scope of their own test accounts, and give us
          reasonable time to fix the issue before disclosing it.
        </p>
      </Section>
    </ContentPage>
  );
}
