import type { Config } from "tailwindcss";

/**
 * Palette sampled directly from sondaven.com/en — a strict two-tone system:
 *   #2C2824  warm dark brown  (dominant background)
 *   #A89474  warm tan         (dominant text, and the alternate background)
 *   #FFFFFF  white            (rare highlight only)
 *
 * The site works by inverting those two as you scroll. No orange anywhere.
 */
const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        /* Semantic tokens driven by ScrollEffects — guarantees contrast in
           every scroll theme, so text can never render invisible. */
        bg: "var(--bg-scroll)",
        fg: "var(--fg-scroll)",
        muted: "var(--fg-muted-scroll)",
        line: "var(--line-scroll)",
        accent: "var(--accent-scroll)",
        surface: "var(--surface-scroll)",

        /* Raw two-tone palette */
        tan: {
          300: "#CBBCA1",
          400: "#B9A88C",
          500: "#A89474", // Son Daven tan
          600: "#8F7C5F",
          700: "#6E5F49",
        },
        umber: {
          600: "#3A342E",
          700: "#2C2824", // Son Daven dark brown
          800: "#211E1A",
          900: "#171512",
          950: "#0D0C0A",
        },
      },
      fontFamily: {
        /* Son Daven runs one superfamily (KTF Metro Roman + Blueline).
           Archivo is the closest freely-licensed geometric grotesque. */
        sans: ["var(--font-sans)", "Archivo", "Helvetica Neue", "system-ui", "sans-serif"],
        display: ["var(--font-sans)", "Archivo", "Helvetica Neue", "system-ui", "sans-serif"],
      },
      fontSize: {
        /* Son Daven display runs 114px at -0.064em tracking, 0.91 leading. */
        "display-xl": ["clamp(3.25rem, 10vw, 8.5rem)", { lineHeight: "0.91", letterSpacing: "-0.064em" }],
        "display-lg": ["clamp(2.5rem, 7vw, 6rem)", { lineHeight: "0.92", letterSpacing: "-0.055em" }],
        "display-md": ["clamp(2rem, 4.5vw, 3.75rem)", { lineHeight: "0.95", letterSpacing: "-0.045em" }],
        "display-sm": ["clamp(1.5rem, 2.8vw, 2.25rem)", { lineHeight: "1.0", letterSpacing: "-0.035em" }],
        /* Labels: Son Daven uses 14–24px uppercase at +1.9px (~0.08em) */
        "label": ["0.875rem", { lineHeight: "1.35", letterSpacing: "0.08em" }],
        "label-lg": ["1.125rem", { lineHeight: "1.3", letterSpacing: "0.08em" }],
        /* Body sized up so it reads without strain */
        "body": ["1.0625rem", { lineHeight: "1.6" }],
        "body-lg": ["clamp(1.125rem, 1.4vw, 1.375rem)", { lineHeight: "1.55" }],
      },
      letterSpacing: {
        label: "0.08em",
        wide2: "0.2em",
      },
      transitionTimingFunction: {
        editorial: "cubic-bezier(0.22, 1, 0.36, 1)",
      },
    },
  },
  plugins: [],
};
export default config;
