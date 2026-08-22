# Fonts

## KTF Metro Blueline (display + labels)

Free from Kyiv Type Foundry — free for Ukrainians, donation requested elsewhere:
https://www.kyivtypefoundry.com/projects/kyiv-metro-fonts

Download the Kyiv Metro Fonts package and drop the Blueline files here:

    public/fonts/KTFMetroBlueline.woff2   <- preferred
    public/fonts/KTFMetroBlueline.woff    <- optional fallback

The `@font-face` rule in `src/app/globals.css` already points at these paths.
Nothing else needs changing — the moment the files exist, the site picks them
up. Until then it falls back to Saira, which is metrically similar.

If you only get an .otf/.ttf, convert it (smaller + better browser support):
    npx @fontsource/cli   # or use https://transfonter.org
