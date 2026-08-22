import type { Metadata } from "next";
import { Archivo, Saira } from "next/font/google";
import "./globals.css";
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

export const metadata: Metadata = {
  title: "VOYAGE — Personalized Dynamic Tour Planning Platform",
  description:
    "Build your custom itinerary with real-time pricing, component customization, and automatic mid-trip adaptation.",
  keywords: [
    "dynamic tour planning",
    "personalized travel itinerary",
    "tour operations",
    "real-time travel pricing",
    "adaptive itinerary",
  ],
  authors: [{ name: "Voyage Team" }],
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
