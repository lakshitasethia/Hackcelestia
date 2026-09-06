import type { Metadata } from "next";
import ContentPage, { Section, List } from "@/components/layout/ContentPage";

export const metadata: Metadata = {
  title: "API Documentation",
  description:
    "The Voyage operator API — authentication, inventory and availability, booking, and disruption webhooks. Currently in private preview.",
};

/** Small monospace block for request/response examples. */
function Code({ children }: { children: string }) {
  return (
    <pre className="surface p-4 overflow-x-auto text-xs leading-relaxed text-fg font-mono">
      <code>{children}</code>
    </pre>
  );
}

export default function ApiPage() {
  return (
    <ContentPage
      eyebrow="API Documentation"
      title="Put your inventory on the graph."
      intro="The operator API is how tour operators, DMCs, and transport providers expose live inventory to Voyage and receive bookings back. It is a REST API over HTTPS with JSON payloads."
      updated="23 Aug 2026"
    >
      <Section number="00" heading="Private preview">
        <p>
          The API is in private preview with a limited set of launch partners.
          The resources below describe the surface as it stands; endpoints and
          field names may still change before general availability, and preview
          credentials are issued manually.
        </p>
        <p>
          To request access, get in touch through the operator section of the
          home page or email{" "}
          <a
            href="mailto:api@voyage.travel"
            className="text-fg underline underline-offset-4 hover:text-accent transition-colors"
          >
            api@voyage.travel
          </a>
          .
        </p>
      </Section>

      <Section number="01" heading="Authentication">
        <p>
          Every request carries a bearer token scoped to your operator account.
          Tokens are issued per environment — sandbox inventory never reaches
          live travelers.
        </p>
        <Code>{`curl https://api.voyage.travel/v1/products \\
  -H "Authorization: Bearer $VOYAGE_API_KEY" \\
  -H "Voyage-Version: 2026-08-01"`}</Code>
        <p>
          Pin the API version with the{" "}
          <code className="text-fg">Voyage-Version</code> header. Requests
          without it resolve to the version current when your key was issued.
        </p>
      </Section>

      <Section number="02" heading="Products and availability">
        <p>
          A product is a bookable thing you sell: a room type, a guided
          departure, a transfer. Availability is queried separately so you can
          keep a stable catalog and move rates independently.
        </p>
        <List
          items={[
            <>
              <code className="text-fg">GET /v1/products</code> — list your
              catalog.
            </>,
            <>
              <code className="text-fg">PUT /v1/products/:id</code> — create or
              update a product definition.
            </>,
            <>
              <code className="text-fg">POST /v1/availability/search</code> —
              return rates and remaining capacity for a date range.
            </>,
          ]}
        />
        <Code>{`POST /v1/availability/search

{
  "product_ids": ["prd_amalfi_boat_day"],
  "start": "2026-09-14",
  "end": "2026-09-21",
  "guests": { "adults": 2, "children": 0 }
}`}</Code>
      </Section>

      <Section number="03" heading="Bookings">
        <p>
          Bookings are two-phase: Voyage holds capacity while a traveler
          completes checkout, then confirms or releases it. Holds expire
          automatically, so a dropped checkout never strands your inventory.
        </p>
        <List
          items={[
            <>
              <code className="text-fg">POST /v1/holds</code> — reserve capacity
              for a short window.
            </>,
            <>
              <code className="text-fg">POST /v1/bookings</code> — confirm a hold
              into a booking.
            </>,
            <>
              <code className="text-fg">DELETE /v1/bookings/:id</code> — cancel,
              subject to the policy on the product.
            </>,
          ]}
        />
        <p>
          Send an <code className="text-fg">Idempotency-Key</code> on every write.
          Retries with the same key return the original result rather than
          double-booking.
        </p>
      </Section>

      <Section number="04" heading="Disruption webhooks">
        <p>
          This is the part that makes adaptive re-routing work. When a traveler
          is delayed into or out of one of your slots, we tell you — and when you
          cannot deliver, you tell us, and the itinerary re-solves around it.
        </p>
        <Code>{`POST https://your-endpoint.example/voyage

{
  "type": "itinerary.disrupted",
  "booking_id": "bkg_8f21c",
  "cause": "inbound_flight_delay",
  "original_slot": "2026-09-15T09:00:00+02:00",
  "proposed_slot": "2026-09-15T14:30:00+02:00",
  "respond_by": "2026-09-15T07:45:00+02:00"
}`}</Code>
        <p>
          Webhooks are signed with an HMAC-SHA256 signature in the{" "}
          <code className="text-fg">Voyage-Signature</code> header. Verify it
          before acting on the payload. Delivery retries with exponential backoff
          for 24 hours.
        </p>
      </Section>

      <Section number="05" heading="Errors and limits">
        <p>
          Errors return a conventional HTTP status with a machine-readable{" "}
          <code className="text-fg">code</code> and a human-readable{" "}
          <code className="text-fg">message</code>. Rate limits are 1,000
          requests per minute per key; availability search is metered separately
          at 5,000 per minute.
        </p>
        <Code>{`{
  "error": {
    "code": "availability_conflict",
    "message": "Capacity for prd_amalfi_boat_day on 2026-09-15 is exhausted.",
    "request_id": "req_01J9Z2"
  }
}`}</Code>
        <p>
          Quote the <code className="text-fg">request_id</code> when you contact
          support — it pins the exact call in our logs.
        </p>
      </Section>
    </ContentPage>
  );
}
