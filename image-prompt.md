# Image Generation Brief — WAYPOINT Landing Page

Copy everything below the line into Gemini.

---

You are generating photography for an existing, finished landing page called **WAYPOINT** (a luxury dynamic tour-planning platform). The site's design, CSS, and layout are **already complete and approved**. Your job is **only** to produce image files.

## HARD CONSTRAINTS — READ FIRST

1. **Do NOT modify any CSS, Tailwind config, `className` values, component structure, JSX, or layout.** Not one line. The styling is final.
2. **Do NOT create new components, wrappers, or `<div>`s.** Do not "improve" anything.
3. **Do NOT change image dimensions, `fill`, `sizes`, `object-cover`, or any prop.**
4. The **only** file edit permitted is swapping the `src=""` string on the 13 lines listed in the "Placement" table at the end — and only after the image files exist. If you are only generating images, make **zero** code edits.
5. Output must be **JPG**, sRGB, quality ~85, no transparency.
6. **No text, no logos, no watermarks, no borders, no frames, no collages** inside any generated image. One clean photograph per file.

## ART DIRECTION — this is the important part

The site runs a strict **two-tone palette** and every photo must feel native to it:

- `#2C2824` — warm dark brown (near-black)
- `#A89474` — warm tan / khaki
- White only as a rare highlight

Photos sit directly against these colours, so they must be **warm, earthy, and desaturated**. Think faded editorial travel film, not stock photography.

**DO:**
- Golden hour, late afternoon, or overcast warm light
- Sand, stone, clay, terracotta, olive, bronze, oatmeal, dust, weathered wood
- Muted, low-saturation, slightly lifted blacks — a soft matte film look
- Fine natural film grain
- Generous negative space and calm composition (text often sits over these)
- Architecture, landscape, interiors, textures, distant/anonymous figures

**DO NOT:**
- Bright saturated blue skies — desaturate any sky toward warm grey/tan
- Any orange, coral, or amber accent (the client explicitly rejected orange)
- Teal, cyan, magenta, neon, or heavy colour grading
- HDR, over-sharpening, heavy vignettes, lens flare
- Close-up faces, posed models looking at camera, or crowds
- Cluttered or busy compositions

**Global style suffix — append to every prompt:**
> warm desaturated earthy film photography, muted tan and dark brown tonality, soft natural light, fine grain, matte lifted blacks, calm negative space, editorial travel magazine, no text, no logos, no people looking at camera

---

## THE 13 IMAGES

Save all files to: **`public/images/`** (create the folder if it does not exist).

### 1. Hero background — `public/images/hero-coastline.jpg`
**2400 × 1400px (landscape)**
A sweeping Mediterranean cliffside coastline at golden hour, seen from above. Pale stone terraces and villas stepping down toward a calm sea. The sea and sky must read warm grey-tan, **not blue**. Very calm and wide; the centre must stay visually quiet because large headline text sits on top of it. Shot wide, slightly hazy, distant.

### 2. Feature — itinerary building — `public/images/feature-itinerary-builder.jpg`
**1600 × 1000px (landscape)**
Overhead view of a warm wooden table: an open notebook, a paper map, a coffee cup, a pair of hands mid-planning (hands only, no face). Warm lamp light, deep brown shadows. Feels tactile and considered, like trip planning by hand.

### 3. Comparison option A — `public/images/compare-suite.jpg`
**800 × 600px (landscape)**
Interior of a luxury cliffside suite: linen bed, arched white-plaster window opening onto a warm hazy sea view. Soft daylight, oatmeal and stone tones, minimal furnishing.

### 4. Comparison option B — `public/images/compare-cave-hotel.jpg`
**800 × 600px (landscape)**
Interior of a boutique cave hotel: curved carved-stone walls, warm recessed lighting, low bed with natural linen. Earthy, intimate, sculptural. Clearly a *different* character to image 3.

### 5–10. Destination cards
**All 1200 × 950px (landscape).** These appear as cards in a row and must feel like a consistent set — same grade, same warmth, same distance.

| File | Subject |
|---|---|
| `public/images/dest-amalfi-capri.jpg` | Amalfi Coast, Italy — pastel cliffside village above a warm hazy sea, lemon terraces, stone stairs |
| `public/images/dest-kyoto-fuji.jpg` | Kyoto, Japan — bamboo grove path or wooden temple eaves in warm morning mist; muted greens pushed toward olive |
| `public/images/dest-zermatt-alps.jpg` | Swiss Alps — Matterhorn ridgeline at warm dawn, dark timber chalet in foreground; snow rendered warm cream, not blue-white |
| `public/images/dest-santorini-cyclades.jpg` | Santorini, Greece — whitewashed cubic architecture and caldera at dusk, warm shadows; avoid the classic blue domes |
| `public/images/dest-banff-louise.jpg` | Banff, Canada — glacial lake and pine forest under warm overcast light; desaturate the turquoise water toward muted sage/stone |
| `public/images/dest-serengeti-zanzibar.jpg` | Serengeti, Tanzania — golden savannah plain, lone acacia tree, dust haze at low sun |

### 11–13. Final CTA background collage
**All 800 × 1200px (PORTRAIT / vertical).**
These render at **20% opacity with a luminosity blend**, so they become near-monochrome background *texture* behind large text. Prioritise **strong simple shapes and clear tonal contrast** over detail — fine detail will be invisible.

| File | Subject |
|---|---|
| `public/images/cta-coast.jpg` | Empty shoreline, long diagonal of surf meeting sand, shot from above |
| `public/images/cta-city.jpg` | Old European street, tall narrow building facades receding upward |
| `public/images/cta-mountain.jpg` | Bold mountain ridge silhouette layered in atmospheric haze |

---

## PLACEMENT — the only code edits allowed

After the files exist, replace **only the URL string** on these exact lines. Change nothing else on the line, and nothing else in the file.

Note the two different shapes:
- `HeroSection.tsx`, `FeatureShowcase.tsx`, `FinalCTA.tsx` use a JSX prop → `src="..."`
- `DestinationCarousel.tsx` lines are entries in a data array → `image: "..."`

Keep whichever key is already on the line; only the quoted URL changes.

| # | File | Line | Key on that line | New value |
|---|---|---|---|---|
| 1 | `src/components/sections/HeroSection.tsx` | 24 | `src=` | `/images/hero-coastline.jpg` |
| 2 | `src/components/sections/FeatureShowcase.tsx` | 32 | `src=` | `/images/feature-itinerary-builder.jpg` |
| 3 | `src/components/sections/FeatureShowcase.tsx` | 104 | `src=` | `/images/compare-suite.jpg` |
| 4 | `src/components/sections/FeatureShowcase.tsx` | 125 | `src=` | `/images/compare-cave-hotel.jpg` |
| 5 | `src/components/sections/DestinationCarousel.tsx` | 16 | `image:` | `/images/dest-amalfi-capri.jpg` |
| 6 | `src/components/sections/DestinationCarousel.tsx` | 27 | `image:` | `/images/dest-kyoto-fuji.jpg` |
| 7 | `src/components/sections/DestinationCarousel.tsx` | 38 | `image:` | `/images/dest-zermatt-alps.jpg` |
| 8 | `src/components/sections/DestinationCarousel.tsx` | 49 | `image:` | `/images/dest-santorini-cyclades.jpg` |
| 9 | `src/components/sections/DestinationCarousel.tsx` | 60 | `image:` | `/images/dest-banff-louise.jpg` |
| 10 | `src/components/sections/DestinationCarousel.tsx` | 71 | `image:` | `/images/dest-serengeti-zanzibar.jpg` |
| 11 | `src/components/sections/FinalCTA.tsx` | 14 | `src=` | `/images/cta-coast.jpg` |
| 12 | `src/components/sections/FinalCTA.tsx` | 22 | `src=` | `/images/cta-city.jpg` |
| 13 | `src/components/sections/FinalCTA.tsx` | 30 | `src=` | `/images/cta-mountain.jpg` |

Example of the *only* kind of change permitted:

```diff
- src="https://images.unsplash.com/photo-1533105079780-92b9be482077?q=80&w=2000&auto=format&fit=crop"
+ src="/images/hero-coastline.jpg"
```

Do not touch `alt`, `fill`, `priority`, `className`, or `sizes`. Do not reformat the file.

**Note:** local `/images/...` paths need no `next.config.mjs` change — leave that file alone too.
