import Navbar from "@/components/layout/Navbar";
import { getViewer, firstName } from "@/lib/auth/session";
import HeroSection from "@/components/sections/HeroSection";
import TrustTicker from "@/components/sections/TrustTicker";
import JourneyStrip from "@/components/sections/JourneyStrip";
import FeatureShowcase from "@/components/sections/FeatureShowcase";
import DestinationCarousel from "@/components/sections/DestinationCarousel";
import OperatorTeaser from "@/components/sections/OperatorTeaser";
import SocialProofStats from "@/components/sections/SocialProofStats";
import PricingSection from "@/components/sections/PricingSection";
import FinalCTA from "@/components/sections/FinalCTA";
import Footer from "@/components/layout/Footer";

/** Reading the session cookie makes this page dynamic, which is the price of
 *  a header that knows who is looking at it. Everything below the header is
 *  identical for everyone, so nothing else changes. */
export default async function Home() {
  const viewer = await getViewer();

  return (
    <main className="min-h-screen bg-surface text-fg selection:bg-fg selection:text-bg">
      {/* Sticky Header */}
      <Navbar viewer={viewer ? { name: firstName(viewer) } : null} />

      {/* 1. Hero with interactive Itinerary Builder UI Preview */}
      <HeroSection />

      {/* 2. Real-time Status Marquee Ticker */}
      <TrustTicker />

      {/* 3. 6-Step Constellation Journey Strip */}
      <JourneyStrip />

      {/* 4. Editorial Feature Showcase & Flagship Disruption Simulator */}
      <FeatureShowcase />

      {/* 5. Curated Destination Carousel with Numbered Pagination */}
      <DestinationCarousel />

      {/* 6. Operator Platform Teaser (Celestial Theme) */}
      <OperatorTeaser />

      {/* 7. Social Proof & Live Metrics Count-up */}
      <SocialProofStats />

      {/* 8. Transparent Pricing & Plans */}
      <PricingSection />

      {/* 9. Final High-Contrast Action Banner */}
      <FinalCTA />

      {/* 10. Dark Celestial Footer */}
      <Footer />
    </main>
  );
}
