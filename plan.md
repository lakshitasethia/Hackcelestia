# PS-7 Landing Page — Build Spec (Phase 1)

Product: **Personalized Dynamic Tour Planning & Tour Operations Platform** (HackCelestia PS-7)
Scope of this doc: the **public landing page only** — the pre-login/pre-app marketing entry point. Not the itinerary builder, not the operator dashboard (those come in later phases).

---

## 0. Design Direction (read this before building anything)

Two ingredients, not blended evenly:

1. **Base layer — warm hospitality.** Real travel photography, warm color palette (terracotta/coral, sand, teal, warm white), generous imagery. This carries ~90% of the page.
2. **Accent layer — celestial/"Celestia" motif.** Used only in specific, deliberate moments: the loader, the custom cursor, the journey/itinerary visualization, and dark-mode section transitions. NOT a literal space background across the whole page (no stars-everywhere, no planets). The celestial idea shows up as a *constellation/connected-path metaphor* for a trip, not as sci-fi decoration.

Visual system borrows from:
- **Component style**: bold black (or dark charcoal) borders on cards/buttons, solid offset drop-shadows (no blur) — e.g. `box-shadow: 4px 4px 0 #111` — a neubrutalist look that's fast to build and reads as confident/modern.
- **Typography pairing**: large serif or high-contrast display font for headlines, paired with a small-caps tracked-out sans for labels/eyebrows (e.g. "CURATED COLLECTION" style labels).
- **Photography**: full-bleed, real destination/activity photos as the dominant visual content in cards and section backgrounds — not illustrations, not stock-icon grids.

### Color palette
- **Primary warm accent**: coral/terracotta (`#E85D3A`-ish)
- **Secondary warm accent**: sand/cream (`#F4E9DC`-ish) — main light background
- **Cool accent (sparingly)**: deep teal (`#1F5F5B`-ish) — for contrast blocks, secondary buttons
- **Celestial accent (loader/cursor/dark sections only)**: near-black navy (`#0B0B14`-ish) background with a warm gold/coral glow (not blue/purple — keep it warm so it still feels "hospitality," like a warm night sky, not a tech/crypto night sky)
- **Ink**: near-black (`#141414`) for text and borders, not pure `#000`
- Keep it to these ~6 colors total. No gradients except the deliberate loader/celestial moments.

### Typography
- Display/headline font: a serif with character (e.g. a high-contrast editorial serif) for big statement lines
- UI/body font: a clean grotesque sans, bold weight for buttons/labels
- Small-caps, letter-spaced labels (`eyebrow` text) above every section heading, e.g. "· DISCOVER ·"

### Cursor (custom, desktop only)
- Default arrow replaced with a small glowing dot (warm coral/gold, soft blur) that trails the mouse with slight easing lag (not instant snap).
- On hover over any clickable element (buttons, cards, nav links): dot expands into a thin ring/halo, or morphs to show a small arrow/plus icon inside it.
- Build as a fixed `div` moved via `transform: translate3d(x, y, 0)` (never `top/left`, for perf), `pointer-events: none` on the cursor element, `cursor: none` on `<body>`.
- Detect touch/coarse-pointer devices (`@media (hover: hover) and (pointer: fine)`) and fall back to the normal system cursor there — do not force it on mobile.

### Loader (first visit only, ~1.2–1.5s max)
- Full-screen near-black background with a sparse animated starfield (small twinkling dots + a few larger 4-point sparkle stars).
- Center: 4–5 dots representing trip elements (a plane icon, a hotel pin, an activity marker, a compass) that connect one-by-one with thin glowing coral/gold lines as the page loads — this is a constellation forming, and it doubles as the progress indicator (no generic spinner).
- Below the constellation: one line of small-caps tracked text that cycles through 2–3 phrases as loading progresses:
  - "CHARTING YOUR COURSE"
  - "ALIGNING YOUR STARS"
  - "MAPPING YOUR JOURNEY"
- On complete: the constellation lines converge to a single point, then a quick cross-fade (not a slow cinematic wipe) into the real hero section — a warm destination photo fading in is the payoff, performing the pivot from "celestial metaphor" to "actual warm travel product."
- Only show this full sequence on cold/first load. Any in-app navigation afterward uses a lightweight skeleton/shimmer loader, not this sequence again.

---

## 1. Navbar (sticky, all pages)

**Layout**: logo left, nav links center-left or center, CTA buttons right. Transparent background over the hero, transitions to solid warm-white background with a bottom border once user scrolls past hero (~80px).

**Left**: Logo/wordmark (product name — placeholder: "WAYPOINT" or similar; treat as a text logo for now, styled like Encrova's stacked wordmark with a small tagline underneath, e.g. "PERSONALIZED TOUR PLANNING")

**Center nav links**:
- Discover (destinations/experiences)
- How It Works
- For Operators (secondary audience — tour companies)
- Pricing (or "Plans")

**Right**:
- "Log In" (text link)
- "Start Planning" (primary CTA button, coral fill, hard-shadow style, always visible)

**Behavior**:
- Sticky on scroll, background fades in
- Nav links get the custom-cursor hover ring on hover
- Mobile: collapses to a hamburger that opens a full-screen dark (celestial-accent) overlay menu with large stacked links — this is one of the acceptable places to use the starfield/dark treatment again, as a bridge, not overuse

---

## 2. Hero Section

**Content**:
- Small pill/badge above headline: "Skip the fixed package." (small-caps or badge style, like the "Peer-to-peer file protocol..." pill pattern)
- Large serif headline, 2–3 lines, statement-style (not a generic tagline):
  - "Your trip. Your rules. Still handled." — or similar 3-beat structure like the reference sites used ("Access granted. Access gone. Zero messages sent.")
- Subheadline (1–2 sentences, plain sans): explain the core value — build a custom tour from real components (hotels, activities, transport), see live pricing, and let the plan adapt automatically if something changes.
- Two CTA buttons side by side: primary "Start Planning" (coral, hard-shadow), secondary "See How It Works" (outline style)
- Background: full-bleed warm travel photography (coastline, mountains, or a city street — real photo, not illustration) with a subtle overlay for text legibility
- Below the fold-line of the hero: a floating "product mockup" card (like the macOS-window-chrome mockups seen in reference sites) showing a preview of the itinerary builder UI — gives an immediate "this is a real functioning tool" signal

**Scroll effect**: on scroll start, hero text and mockup card do a slight parallax (text moves slower than background image) — subtle, not heavy-handed.

---

## 3. Trust / Ticker Strip

Thin dark strip directly under the hero (or integrated into navbar top edge), auto-scrolling marquee ticker with short status/feature callouts, e.g.:
- "✦ REAL-TIME PRICING" · "✦ 10,000+ CURATED EXPERIENCES" · "✦ INSTANT ITINERARY UPDATES" · "✦ BUILT FOR HACKCELESTIA 2026"

(This is a cheap, high-impact detail — continuously scrolling text, low build cost, reads as "live product.")

---

## 4. "How It Works" — Journey Strip

This section visualizes the product's core lifecycle (Discover → Personalize → Plan → Price → Book → Adapt — condensed from the full 11-stage journey to the 6 most demo-relevant stages).

**Layout**: horizontal stepper/timeline, 6 nodes connected by a line (this is your first "constellation" callback — same connected-dot visual language as the loader, now used functionally).
- Each node: number + icon + short label + 1-line description
- On scroll into view, nodes light up / connect sequentially (animate the connecting line drawing left-to-right as the section enters viewport)

**Content per step** (placeholder copy, refine later):
1. **Discover** — Browse destinations and experiences matched to your interests
2. **Personalize** — Set your dates, budget, and travel style
3. **Plan** — Build your day-by-day itinerary, swap and compare components
4. **Price** — Watch your total update live as you customize
5. **Book** — Confirm and lock in your trip
6. **Adapt** — If something changes, we automatically re-route your plan

---

## 5. Feature Showcase (traveler side)

3–4 large editorial-style feature blocks, alternating image-left/text-right and image-right/text-left (same pattern as the snami reference: photo + serif heading + short paragraph + underlined arrow link), each on an alternating warm/light background:

1. **Build your own itinerary** — drag-and-drop day-by-day planning, real photo of someone planning on a laptop/phone
2. **Compare before you commit** — side-by-side hotel/activity comparison, photo of two accommodation options
3. **Live, transparent pricing** — cost updates as you customize, no hidden fees
4. **Adapt on the fly (flagship feature)** — this block gets special treatment: instead of a plain photo, show the "constellation" itinerary-dependency visualization — a day's plan as connected nodes, with one node shown flagged/highlighted (e.g. "Flight delayed") and dashed lines to the 2–3 affected downstream nodes, illustrating automatic re-routing. This is your differentiator — give it the most visual weight on the page.

Each block ends with a small arrow-link ("Learn more →") using the same hover-arrow micro-interaction pattern.

---

## 6. Destination / Experience Carousel

Photography-led card carousel (per the snami/sondaven "curated collection" pattern):
- Section eyebrow label: "· CURATED COLLECTION ·"
- Heading: "Where will you go?"
- Horizontally scrollable row of destination cards (image + destination name + short descriptor + starting price), numbered pagination style ("01 / 06") instead of dots, with left/right circular arrow controls
- Each card has a hover effect: image scales up slightly (`scale(1.03)`), a coral border appears, and a "View" label fades in over the image following the custom cursor pattern

---

## 7. For Operators (secondary audience teaser)

Short, single-screen section — not as deep as the traveler content, just enough to signal the platform's two-sided nature (per the PS-7 spec, which explicitly asks for an operator/back-office system too):
- Dark (celestial-accent) background — second acceptable use of the dark/starfield treatment, framed as "the operations side of the sky"
- Heading: "Running tours? We handle the operations."
- 3 short stat/feature chips (same bordered-chip style as Encrova's pipeline nodes): "Centralized bookings," "Vendor & schedule management," "Real-time change tracking"
- One CTA: "Explore Operator Tools →"

---

## 8. Social Proof / Stats Strip

Simple stat row (mocked numbers are fine for a hackathon prototype, keep believable):
- "500+ Destinations" · "50,000+ Trips Planned" · "98% On-Time Adaptation" · "24/7 Live Support"
Numbers count up (0 → target) when scrolled into view.

---

## 9. Final CTA Section

Full-width, bold, high-contrast block (coral or dark background):
- Large serif statement: "Stop settling for someone else's itinerary."
- Subtext: one line reinforcing the pitch
- Single large primary CTA button: "Start Planning Your Trip"
- Optional secondary photo collage/grid in the background at low opacity

---

## 10. Footer

- Left: logo + one-line tagline + small social icon row (bordered square icons, matching card style)
- Columns: "Product" (Discover, How It Works, Pricing), "Company" (About, For Operators, Contact), "Legal" (Privacy, Terms)
- Bottom bar: copyright + "Built for HackCelestia 2026"
- Background: dark/celestial (third and final acceptable use of the starfield treatment — bookend the page the way it opened in the loader)

---

## 11. Global Interaction Rules (apply everywhere)

- **Buttons**: solid fill (coral primary / outline secondary), bold black border, hard offset shadow, shadow shrinks and button shifts down-right slightly on `:active` press (tactile feedback)
- **Cards**: black border, hard shadow, on hover the shadow grows slightly and the card lifts (`translateY(-2px)`)
- **Section headings**: always preceded by a small-caps eyebrow label
- **Scroll reveals**: content fades up (`opacity 0→1`, `translateY(20px→0)`) as sections enter viewport — subtle, consistent, same easing/duration everywhere (don't vary animation style section to section, that reads as inconsistent rather than dynamic)
- **Custom cursor** active on all interactive elements site-wide, falls back to system cursor on touch devices
- **Only 3 places** use the dark celestial/starfield treatment: the loader, the "For Operators" section, and the footer. Everything else stays on the warm light palette. Do not scatter starfields throughout.

---

## 12. Assets Needed Before Build

- 6–10 real (or high-quality stock) travel photos: coastline, mountain trail, city street, boutique hotel exterior, hotel room interior, local food/market, group activity, sunset/landscape
- Product name/logo (placeholder text wordmark acceptable for Phase 1)
- Icon set for: plane, hotel, activity pin, compass, calendar, price tag (simple line icons, consistent stroke weight)

---

## 13. Out of Scope for This Phase

- Itinerary builder screen (drag-and-drop day planner) — Phase 3
- Live booking flow — Phase 4
- Operator dashboard (full) — Phase 5
- Real Google Places/Maps integration — wired in once traveler-side screens exist
- Auth/login screens
