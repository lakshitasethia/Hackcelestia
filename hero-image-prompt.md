# Hero Image Brief — WAYPOINT cinematic opening shot

Copy everything below the line into Gemini.

---

You are generating **one** photograph for the opening shot of a luxury travel
platform called **WAYPOINT**. The site's design, CSS, and layout are already
finished and approved. Your job is **only** to produce this one image file.

## HARD CONSTRAINTS — READ FIRST

1. **Do NOT modify any CSS, Tailwind config, `className` values, component
   structure, JSX, or layout.** Not one line. Nothing else on the site is to be
   touched.
2. **Do NOT create components, wrappers, or new files** other than the image.
3. **Do NOT change any image props** (`fill`, `sizes`, `priority`, `alt`).
4. The **only** permitted file edit is one `src` string, described at the end —
   and only after the image file exists.
5. Output: **JPG, 3200 × 1800px (16:9), sRGB, quality ~88.** No transparency.
6. **No text, no logos, no watermarks, no borders, no frames, no collage.** One
   clean photograph.

## THIS IMAGE HAS AN UNUSUAL JOB — READ CAREFULLY

It is not a static background. On page load it fills the entire screen, and as
the visitor scrolls it **shrinks smoothly down to a small centred panel about
38% of its original size**, like a camera pulling back. It must therefore work
at **two very different scales at once**:

- **Full screen:** large headline type sits over the upper-middle. That area
  must stay calm and uncluttered, or the words become unreadable.
- **Small panel:** the whole composition is visible at roughly a third the size.
  The subject must still read instantly when small.

**What this means for the composition:**

- Build around **one clear, bold subject** with a strong silhouette. Fussy,
  evenly-detailed scenes turn to mush when shrunk.
- Keep the **centre and upper-middle relatively open** — sky, haze, water, or
  soft empty space where the headline lands.
- Put the visual weight **low and to one side** (lower-left or lower-right),
  so the composition still feels balanced when it becomes a small rectangle.
- **Strong tonal separation** between subject and background. Depth should come
  from light and atmosphere, not from fine texture.
- **No important detail near the edges** — the frame is cropped at some viewport
  sizes.

## ART DIRECTION

The site runs a strict **two-tone palette** and the photo must feel native to it:

- `#2C2824` — warm dark brown (near-black)
- `#A89474` — warm tan / khaki

The photo sits behind a warm dark veil that lifts as it shrinks, so it must be
**warm, earthy, desaturated, and slightly dark to begin with**. Think faded
editorial travel film, not bright stock photography.

**DO:**
- Golden hour, dawn haze, or warm overcast light
- Stone, sand, clay, terracotta, olive, bronze, oatmeal, weathered timber
- Muted low-saturation colour with soft, lifted blacks — a matte film look
- Real atmospheric depth: mist, haze, layered distance
- Fine natural film grain
- A calm, wide, unhurried feeling

**DO NOT:**
- Bright saturated blue skies — push any sky toward warm grey, dust, or pale tan
- Any orange, coral, or amber accent (explicitly rejected by the client)
- Teal, cyan, magenta, neon, or heavy colour grading
- HDR, over-sharpening, heavy vignette, lens flare, tilt-shift
- Close-up faces, posed models looking at camera, crowds, or vehicles
- Busy, cluttered, or evenly detailed scenes

## THE SHOT

> A vast Mediterranean coastline at first light, seen from high on a cliff
> road. A single ancient stone village clings to the headland on the **right
> third** of the frame, its pale terraces stacked down toward the water and
> catching the first warm light. The rest of the frame opens into a calm,
> glassy sea and layered ridgelines dissolving into warm dawn haze toward the
> left. The sky is pale, warm, and almost colourless — dust and bone, not blue.
> A few tiny boats sit far out on the water, small enough to read as texture.
> The village silhouette is unmistakable even at a glance; everything else is
> soft, atmospheric, and quiet. Shot wide on a long lens from a distance, warm
> desaturated film stock, fine grain, matte lifted blacks, generous open space
> across the upper-left where a headline will sit.

**Style suffix to append:**

> warm desaturated earthy film photography, muted tan and dark brown tonality,
> pale hazy warm sky, soft dawn light, fine grain, matte lifted blacks, strong
> simple silhouette, calm negative space upper-left, editorial travel magazine,
> no text, no logos, no people

## SAVE AS

    public/images/hero_travel_bg.jpg

Overwrite the existing file. Keeping the same filename means **no code change is
needed at all** — the site picks it up immediately.

If you save under a different name instead, then the **only** permitted edit is
line 71 of `src/components/sections/HeroSection.tsx`:

```diff
- src="/images/hero_travel_bg.jpg"
+ src="/images/<your-filename>.jpg"
```

Do not touch `alt`, `fill`, `priority`, `className`, or `sizes`. Do not reformat
the file. Do not change anything else in the project.
