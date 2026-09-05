# Waypoint — Tech Stack

Project: **Waypoint** — Personalized Dynamic Tour Planning & Tour Operations Platform (HackCelestia PS-7)
This doc defines the full stack. Read alongside `plan.md` (landing page build spec) before writing any code.

---

## Frontend

- **Next.js 14 (App Router) + TypeScript** — file-based routing, SSR for fast first paint on the landing page, and the framework most AI codegen tools produce the cleanest output in.
- **Tailwind CSS** — utility classes map directly onto the neubrutalist card/button system in `plan.md` (bold borders, hard offset shadows, no blur). Keep a small, consistent set of design tokens (colors, spacing, shadow values) defined once in `tailwind.config` — don't invent one-off values per component.
- **shadcn/ui** — unstyled, accessible primitives (dialogs, dropdowns, date pickers, tabs) restyled to match the design system. Use for structural components; don't hand-roll things shadcn already solves.
- **Framer Motion** — scroll fade-ups, hover states, button press feedback, custom cursor trailing/expand behavior.
- **GSAP + ScrollTrigger** — reserved specifically for choreographed, timeline-based scroll animation: the loader's constellation-drawing sequence, and the "How It Works" journey strip's line-drawing-in-as-you-scroll effect. Use Framer Motion for simple element-level animation, GSAP for anything that scrubs against scroll position or plays as a multi-step timeline.
- **lucide-react** — line icon set (plane, hotel, compass, calendar, price tag).
- **next/image** — required for all photography; no raw `<img>` tags.

## Backend / Data

- **Supabase** — Postgres + Auth + Storage + Realtime.
  - Core tables (Phase 2+, not needed for the landing page): `users`, `trips`, `itinerary_items`, `destinations`, `activities`, `hotels`, `bookings`, `vendors`, `operators`, `price_snapshots`
  - **Realtime** powers the live "Adapt" disruption re-routing demo.
  - **Edge Functions** (Deno) for anything that must not run client-side: proxying Google API calls (key hiding), pricing logic, re-routing logic.

## External APIs

- **Google Maps JavaScript API** — interactive map with pinned points of interest.
- **Google Places API** — real destination/activity search, autocomplete, place photos and details.
- **Google Distance Matrix / Directions API** — travel time between itinerary stops (explicitly required by the PS-7 spec).
- **OpenWeatherMap API** — real weather data to drive the "Adapt" disruption demo instead of hardcoding a fake delay.

## State & Data-fetching (Phase 2+)

- **Zustand** — client state for the itinerary builder (day-by-day trip state, drag order). Minimal boilerplate.
- **TanStack Query (React Query)** — caching/sync layer over Supabase reads.

## Drag-and-drop (Phase 3)

- **dnd-kit** — itinerary day/activity reordering.

## Deployment

- **Vercel** — Next.js hosting, instant preview URLs per push, trivial custom domain.
- **Supabase Cloud** — free tier for backend.
- **GitHub** — version control, connected to Vercel auto-deploy.

## Division of Labor

- **Gemini**: all landing page UI, component styling, animation — scoped by `plan.md`.
- **Claude (this session)**: Supabase schema, Edge Functions, API integration/proxying, itinerary-builder state logic, Adapt re-routing logic.

## Phase 1 Scope Reminder

Phase 1 is the **landing page only**. No auth, no itinerary builder, no booking flow, no operator dashboard, no real Supabase wiring yet — those come in later phases per `plan.md`'s "Out of Scope" section. Keep Phase 1 a static (or lightly interactive) Next.js + Tailwind + Framer Motion + GSAP build; don't pull in Supabase/Zustand/dnd-kit until the phase that actually needs them.
