import type { Metadata } from "next";
import { Archivo } from "next/font/google";
import "./globals.css";
import ConstellationLoader from "@/components/ui/ConstellationLoader";
import ScrollEffects from "@/components/ui/ScrollEffects";

/**
 * Son Daven runs a single superfamily (KTF Metro Roman + KTF Metro Blueline),
 * which is commercially licensed. Archivo is the closest freely-licensed
 * geometric grotesque and covers both the heavy tight display sizes and the
 * tracked uppercase labels.
 */
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
    "Skip the fixed package. Build your custom itinerary with real-time pricing, component customization, and automatic mid-trip adaptation. Built for HackCelestia 2026.",
  keywords: [
    "dynamic tour planning",
    "personalized travel itinerary",
    "tour operations",
    "HackCelestia 2026",
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
    <html lang="en" className={archivo.variable}>
      <body className="antialiased">
        <ConstellationLoader />
        <ScrollEffects />
        {children}
      </body>
    </html>
  );
}
