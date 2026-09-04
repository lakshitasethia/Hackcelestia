import type { Metadata } from "next";
import { Archivo, Saira } from "next/font/google";
import "./globals.css";
import { siteUrl as resolveSiteUrl } from "@/lib/site-url";
import ConstellationLoader from "@/components/ui/ConstellationLoader";
import ScrollEffects from "@/components/ui/ScrollEffects";

/**
 * Display + labels: KTF Metro Blueline (see globals.css @font-face), falling
 * back to Saira — a wide, squarish grotesque that stands in for Blueline's
 * Eurostile-adjacent signage character until the font files are added.
 *
 * Body copy stays on Archivo: Blueline is a signage face and gets unreadable
 * at paragraph sizes.
 */
const saira = Saira({
  subsets: ["latin"],
  variable: "--font-display-fallback",
  display: "swap",
  weight: ["300", "400", "500", "600", "700"],
});

const archivo = Archivo({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
  weight: ["300", "400", "500", "600", "700"],
});

export const viewport = {
  width: "device-width",
  initialScale: 1,
};

const SITE_NAME = "VOYAGE";
const TITLE = "VOYAGE — Personalized Dynamic Tour Planning Platform";
const DESCRIPTION =
  "Build your custom itinerary from real hotels, transport and guides — priced live at supplier rates, and re-routed automatically when weather or delays hit mid-trip.";

/**
 * `metadataBase` resolves the relative icon/OG paths to absolute URLs, which
 * crawlers and chat unfurlers require. Set NEXT_PUBLIC_SITE_URL in the host's
 * env once the domain is known; the Vercel-provided URL is used otherwise, and
 * localhost only as a last resort in development.
 */
const siteUrl = resolveSiteUrl();

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: TITLE,
    template: `%s — ${SITE_NAME}`,
  },
  description: DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: [
    "dynamic tour planning",
    "personalized travel itinerary",
    "tour operations",
    "real-time travel pricing",
    "adaptive itinerary",
  ],
  authors: [{ name: "Voyage Team" }],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: TITLE,
    description: DESCRIPTION,
    url: "/",
    locale: "en_US",
    // opengraph-image.jpg in this directory is picked up automatically.
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large" },
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${archivo.variable} ${saira.variable}`}>
      <body className="antialiased">
        <ConstellationLoader />
        <ScrollEffects />
        {children}
      </body>
    </html>
  );
}
